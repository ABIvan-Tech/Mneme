import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "better-sqlite3";

import { openDatabase } from "./db.js";
import { createLogger } from "./logger.js";
import { runMigrations } from "./migrations.js";

let db: Database;
const logger = createLogger("error"); // Suppress log output during tests

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

describe("runMigrations", () => {
  it("creates schema_migrations table", () => {
    runMigrations(db, logger);

    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`,
    ).all() as Array<{ name: string }>;

    expect(tables).toHaveLength(1);
  });

  it("applies pending migrations", () => {
    const result = runMigrations(db, logger);
    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect(result.current_version).toBeGreaterThanOrEqual(1);
  });

  it("creates audit_log table", () => {
    runMigrations(db, logger);

    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'`,
    ).all() as Array<{ name: string }>;

    expect(tables).toHaveLength(1);
  });

  it("is idempotent — running twice applies nothing the second time", () => {
    const first = runMigrations(db, logger);
    const second = runMigrations(db, logger);

    expect(first.applied).toBeGreaterThanOrEqual(1);
    expect(second.applied).toBe(0);
    expect(second.current_version).toBe(first.current_version);
  });

  it("records applied migrations in schema_migrations", () => {
    runMigrations(db, logger);

    const rows = db.prepare(
      `SELECT version, name FROM schema_migrations ORDER BY version`,
    ).all() as Array<{ version: number; name: string }>;

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.version).toBe(1);
    expect(rows[0]!.name).toBe("initial_schema");
  });
});
