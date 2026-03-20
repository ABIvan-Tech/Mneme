import type { Database } from "better-sqlite3";

import type { Logger } from "./logger.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `-- Initial schema is handled by db.ts initializeDatabase.
          -- This migration exists only to set the baseline version.`,
  },
  {
    version: 2,
    name: "add_audit_log",
    sql: `
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        summary TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);
    `,
  },
  {
    version: 3,
    name: "add_embeddings",
    sql: `
      ALTER TABLE self_memory ADD COLUMN embedding BLOB;
    `,
  },
  {
    version: 4,
    name: "add_access_tracking",
    sql: `
      ALTER TABLE self_memory ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE self_memory ADD COLUMN last_accessed_at INTEGER;
    `,
  },
  {
    version: 5,
    name: "add_memory_lifecycle_and_threading",
    sql: `
      ALTER TABLE self_memory ADD COLUMN thread_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_self_memory_archived_at ON self_memory(archived_at);
      CREATE INDEX IF NOT EXISTS idx_self_memory_thread_id ON self_memory(thread_id);
      CREATE INDEX IF NOT EXISTS idx_self_memory_active ON self_memory(deleted_at, archived_at, facet, salience);
    `,
  },
  {
    version: 6,
    name: "add_audit_log_before_after_values",
    sql: `
      ALTER TABLE audit_log ADD COLUMN before_value TEXT;
      ALTER TABLE audit_log ADD COLUMN after_value TEXT;
    `,
  },
  {
    version: 7,
    name: "add_profile_history",
    sql: `
      CREATE TABLE IF NOT EXISTS profile_history (
        id TEXT NOT NULL PRIMARY KEY,
        snapshot_at INTEGER NOT NULL,
        self_name TEXT,
        core_identity TEXT,
        communication_style TEXT,
        relational_style TEXT,
        empathy_style TEXT,
        core_values TEXT,
        boundaries TEXT,
        self_narrative TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_profile_history_snapshot_at ON profile_history(snapshot_at DESC);
    `,
  },
  {
    version: 8,
    name: "fix_canonical_key_active_unique_index_for_archived",
    sql: `
      DROP INDEX IF EXISTS idx_self_memory_canonical_key_active;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_self_memory_canonical_key_active
        ON self_memory(canonical_key)
        WHERE canonical_key IS NOT NULL
          AND deleted_at IS NULL
          AND archived_at IS NULL;
    `,
  },
];

function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

function getAppliedVersions(db: Database): Set<number> {
  const rows = db.prepare(
    `SELECT version FROM schema_migrations ORDER BY version`,
  ).all() as Array<{ version: number }>;

  return new Set(rows.map((row) => row.version));
}

export function runMigrations(db: Database, logger: Logger): { applied: number; current_version: number } {
  ensureMigrationsTable(db);

  const applied = getAppliedVersions(db);
  const pending = MIGRATIONS.filter((migration) => !applied.has(migration.version));
  let appliedCount = 0;

  for (const migration of pending) {
    logger.info("Applying migration", {
      version: migration.version,
      name: migration.name,
    });

    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
      ).run(migration.version, migration.name, Date.now());
    })();

    appliedCount += 1;
  }

  const maxVersion = MIGRATIONS.length > 0
    ? Math.max(...MIGRATIONS.map((migration) => migration.version))
    : 0;

  if (appliedCount > 0) {
    logger.info("Migrations complete", {
      applied_count: appliedCount,
      current_version: maxVersion,
    });
  }

  return { applied: appliedCount, current_version: maxVersion };
}

export function getMigrations(): readonly Migration[] {
  return MIGRATIONS;
}
