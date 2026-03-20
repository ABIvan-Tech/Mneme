import os from "node:os";
import path from "node:path";
import { z } from "zod";

import type { LogLevel } from "./logger.js";

const LOG_LEVEL_SCHEMA = z.enum(["debug", "info", "warn", "error"]);

const ENV_SCHEMA = z.object({
  SQLITE_PATH: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  MCP_AUTH_TOKEN: z.string().optional(),
  SELF_SNAPSHOT_LIMIT: z.string().optional(),
  MAX_CONTENT_LENGTH: z.string().optional(),
  MAX_PROFILE_FIELD_LENGTH: z.string().optional(),
  MAX_MEMORIES_PER_FACET: z.string().optional(),
  VECTOR_SIMILARITY_THRESHOLD: z.string().optional(),
  RRF_K: z.string().optional(),
  SALIENCE_DECAY_DAYS: z.string().optional(),
});

export interface AppConfig {
  sqlitePath: string;
  logLevel: LogLevel;
  mcpAuthToken?: string;
  snapshotLimit: number;
  maxContentLength: number;
  maxProfileFieldLength: number;
  maxMemoriesPerFacet: number;
  vectorSimilarityThreshold: number;
  rrfK: number;
  salienceDecayDays: number;
}

function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
}

function parsePositiveFloat(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
}

function getDefaultDatabasePath(): string {
  const home = os.homedir();
  const appName = "mnemo-self";

  switch (process.platform) {
    case "win32":
      return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), appName, "self-memory.db");
    case "darwin":
      return path.join(home, "Library", "Application Support", appName, "self-memory.db");
    default:
      // Linux and others (following XDG spec loosely)
      return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), appName, "self-memory.db");
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<AppConfig> = {}): AppConfig {
  const parsed = ENV_SCHEMA.parse(env);

  return {
    sqlitePath: overrides.sqlitePath || parsed.SQLITE_PATH?.trim() || getDefaultDatabasePath(),
    logLevel: overrides.logLevel || LOG_LEVEL_SCHEMA.parse(parsed.LOG_LEVEL?.trim() || "info"),
    mcpAuthToken: overrides.mcpAuthToken || parsed.MCP_AUTH_TOKEN?.trim() || undefined,
    snapshotLimit: overrides.snapshotLimit || parsePositiveInt(parsed.SELF_SNAPSHOT_LIMIT, 12),
    maxContentLength: overrides.maxContentLength || parsePositiveInt(parsed.MAX_CONTENT_LENGTH, 10_000),
    maxProfileFieldLength: overrides.maxProfileFieldLength || parsePositiveInt(parsed.MAX_PROFILE_FIELD_LENGTH, 5_000),
    maxMemoriesPerFacet: overrides.maxMemoriesPerFacet || parsePositiveInt(parsed.MAX_MEMORIES_PER_FACET, 500),
    vectorSimilarityThreshold: overrides.vectorSimilarityThreshold || parsePositiveFloat(parsed.VECTOR_SIMILARITY_THRESHOLD, 0.92),
    rrfK: overrides.rrfK || parsePositiveInt(parsed.RRF_K, 60),
    salienceDecayDays: overrides.salienceDecayDays || parsePositiveInt(parsed.SALIENCE_DECAY_DAYS, 90),
  };
}
