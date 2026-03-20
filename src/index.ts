#!/usr/bin/env node
import crypto from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { type Request, type Response } from "express";
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

function readBearerToken(req: Request): string | undefined {
  const authorization = req.get("authorization");
  if (!authorization) {
    return undefined;
  }

  const [scheme, token] = authorization.split(" ", 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return undefined;
  }

  return token.trim();
}

function readQueryToken(req: Request): string | undefined {
  const value = req.query.token;

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
}

function timingSafeTokenEquals(expected: string, candidate: string): boolean {
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  const candidateHash = crypto.createHash("sha256").update(candidate).digest();
  return crypto.timingSafeEqual(expectedHash, candidateHash);
}

function isSseRequestAuthorized(req: Request, authToken: string): boolean {
  const bearerToken = readBearerToken(req);
  if (bearerToken && timingSafeTokenEquals(authToken, bearerToken)) {
    return true;
  }

  const queryToken = readQueryToken(req);
  if (queryToken && timingSafeTokenEquals(authToken, queryToken)) {
    return true;
  }

  return false;
}

function requireSseAuthorization(req: Request, res: Response, config: import("./config.js").AppConfig): boolean {
  const authToken = config.mcpAuthToken?.trim();
  if (!authToken) {
    return true;
  }

  if (isSseRequestAuthorized(req, authToken)) {
    return true;
  }

  res.status(401).send("Unauthorized");
  return false;
}

function readSessionId(req: Request): string | undefined {
  const value = req.query.sessionId;

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
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
  const repository = new SelfMemoryRepository(db, {
    rrfK: config.rrfK,
    salienceDecayDays: config.salienceDecayDays,
  });
  const embeddingProvider = new XenovaEmbeddingProvider("Xenova/all-MiniLM-L6-v2", logger);
  const service = new SelfMemoryService(
    repository,
    config.maxMemoriesPerFacet,
    config.vectorSimilarityThreshold,
    embeddingProvider,
    config.maxContentLength,
    config.maxProfileFieldLength,
  );

  runStartupDiagnostics(repository, logger);

  if (values.transport === "sse") {
    const port = Number.parseInt(String(values.port), 10);
    const app = express();

    const transports = new Map<string, SSEServerTransport>();

    app.get("/sse", async (req, res) => {
      if (!requireSseAuthorization(req, res, config)) {
        return;
      }

      const transport = new SSEServerTransport("/message", res);
      const sessionId = transport.sessionId;
      transports.set(sessionId, transport);
      res.setHeader("x-mcp-session-id", sessionId);

      transport.onclose = () => {
        transports.delete(sessionId);
      };

      res.on("close", () => {
        transports.delete(sessionId);
      });

      try {
        const sessionServer = createServer(config, service, repository);
        await sessionServer.connect(transport);
      } catch (error: unknown) {
        transports.delete(sessionId);

        logger.error("Failed to establish SSE session", {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });

        if (!res.headersSent) {
          res.status(500).send("Failed to establish SSE session");
        }
      }
    });

    app.post("/message", async (req, res) => {
      if (!requireSseAuthorization(req, res, config)) {
        return;
      }

      const sessionId = readSessionId(req);
      if (!sessionId) {
        res.status(400).send("Missing sessionId");
        return;
      }

      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(400).send("No transport found for sessionId");
        return;
      }

      await transport.handlePostMessage(req, res);
    });

    app.listen(port, () => {
      logger.info("Self-memory MCP server started (SSE)", {
        port,
        url: `http://localhost:${port}/sse`,
      });
    });
  } else {
    const mcpServer = createServer(config, service, repository);
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
