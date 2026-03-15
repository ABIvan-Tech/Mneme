#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import type { Database } from "better-sqlite3";
import { parseArgs } from "node:util";

import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { XenovaEmbeddingProvider } from "./embeddings.xenova.js";
import { createLogger, type Logger, type LogLevel } from "./logger.js";
import { runMigrations } from "./migrations.js";
import { SelfMemoryRepository } from "./repository.js";
import { createServer } from "./server.js";
import { SelfMemoryService } from "./service.js";

function setupGracefulShutdown(db: Database, logger: Logger): void {
  const shutdown = (signal: string) => () => {
    logger.info("Received shutdown signal", { signal });

    try {
      db.close();
      logger.info("SQLite connection closed");
    } catch (error: unknown) {
      logger.error("Failed to close SQLite connection", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    process.exit(0);
  };

  process.on("SIGINT", shutdown("SIGINT"));
  process.on("SIGTERM", shutdown("SIGTERM"));
}

function runStartupDiagnostics(
  repository: SelfMemoryRepository,
  logger: Logger,
): void {
  try {
    const profile = repository.getProfile();
    if (!profile) {
      logger.warn("Startup diagnostic: self_profile singleton is missing");
    }

    const memoryCount = repository.totalMemoryCount();
    const dbSize = repository.dbSizeBytes();
    const pinnedCount = repository.countPinned();
    const facetCounts = repository.countByFacet();

    logger.info("Startup diagnostics passed", {
      memory_count: memoryCount,
      pinned_count: pinnedCount,
      facet_counts: facetCounts,
      db_size_bytes: dbSize,
    });

    const DB_SIZE_WARN_BYTES = 100 * 1024 * 1024; // 100 MB
    if (dbSize > DB_SIZE_WARN_BYTES) {
      logger.warn("Database size exceeds warning threshold", {
        db_size_bytes: dbSize,
        threshold_bytes: DB_SIZE_WARN_BYTES,
      });
    }
  } catch (error: unknown) {
    logger.error("Startup diagnostics failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      "sqlite-path": { type: "string" },
      "log-level": { type: "string" },
      "snapshot-limit": { type: "string" },
      transport: { type: "string", default: "stdio" },
      port: { type: "string", default: "3000" },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`
Mnemo Self-Memory MCP Server v${process.env.npm_package_version || "0.3.0"}

Usage:
  npx mnemo-self [options]

Options:
  -h, --help            Show this help message
  -v, --version         Show version
  --sqlite-path <path>  Path to SQLite database file
  --log-level <level>   Log level (debug, info, warn, error)
  --snapshot-limit <n>  Max items in continuity snapshot
  --transport <type>    stdio | sse (default: stdio)
  --port <number>       Port for SSE transport (default: 3000)

Environment Variables:
  SQLITE_PATH           Path to SQLite database file
  LOG_LEVEL             Log level (debug, info, warn, error)
  EMBEDDING_PROVIDER    local | openai | none
    `);
    process.exit(0);
  }

  if (values.version) {
    console.log("0.3.0");
    process.exit(0);
  }

  const overrides: Partial<import("./config.js").AppConfig> = {};
  if (values["sqlite-path"]) overrides.sqlitePath = String(values["sqlite-path"]);
  if (values["log-level"]) overrides.logLevel = String(values["log-level"]) as LogLevel;
  if (values["snapshot-limit"]) overrides.snapshotLimit = Number.parseInt(String(values["snapshot-limit"]), 10);

  const config = loadConfig(process.env, overrides);
  const logger = createLogger(config.logLevel, {
    service: "mnemo-self",
    component: "bootstrap",
  });

  const db = openDatabase(config.sqlitePath);
  runMigrations(db, logger);
  const repository = new SelfMemoryRepository(db);
  const embeddingProvider = new XenovaEmbeddingProvider("Xenova/all-MiniLM-L6-v2", logger);
  const service = new SelfMemoryService(repository, config.maxMemoriesPerFacet, embeddingProvider);

  runStartupDiagnostics(repository, logger);

  const mcpServer = createServer(config, service, repository);

  if (values.transport === "sse") {
    const port = Number.parseInt(String(values.port), 10);
    const app = express();
    
    let transport: SSEServerTransport | undefined;

    app.get("/sse", async (req, res) => {
      transport = new SSEServerTransport("/message", res);
      await mcpServer.connect(transport);
    });

    app.post("/message", async (req, res) => {
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(400).send("Not connected");
      }
    });

    app.listen(port, () => {
      logger.info("Self-memory MCP server started (SSE)", {
        port,
        url: `http://localhost:${port}/sse`,
      });
    });
  } else {
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    
    logger.info("Self-memory MCP server started (Stdio)", {
      sqlitePath: config.sqlitePath,
      snapshotLimit: config.snapshotLimit,
    });
  }

  setupGracefulShutdown(db, logger);
}

void main().catch((error: unknown) => {
  const logger = createLogger("error", {
    service: "mnemo-self",
    component: "bootstrap",
  });

  logger.error("Fatal startup error", {
    error: error instanceof Error ? error.message : String(error),
  });

  process.exitCode = 1;
});
