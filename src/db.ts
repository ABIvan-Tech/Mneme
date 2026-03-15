import { mkdirSync } from "node:fs";
import path from "node:path";

import BetterSqlite3, { type Database } from "better-sqlite3";

const MEMORY_FACET_SQL =
  "'identity', 'voice', 'value', 'boundary', 'relationship', 'autobiography', 'emotion', 'commitment', 'reflection', 'ritual', 'other'";

export function openDatabase(sqlitePath: string): Database {
  const db =
    sqlitePath === ":memory:"
      ? new BetterSqlite3(":memory:")
      : new BetterSqlite3(prepareAbsoluteSqlitePath(sqlitePath));

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  initializeDatabase(db);
  return db;
}

function prepareAbsoluteSqlitePath(sqlitePath: string): string {
  const absolutePath = path.resolve(sqlitePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  return absolutePath;
}

function initializeDatabase(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS self_memory (
      id TEXT PRIMARY KEY,
      title TEXT,
      content TEXT NOT NULL,
      facet TEXT NOT NULL CHECK(facet IN (${MEMORY_FACET_SQL})),
      salience REAL NOT NULL CHECK(salience BETWEEN 0 AND 1),
      source TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1)),
      canonical_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS self_profile (
      id TEXT PRIMARY KEY CHECK(id = 'self'),
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
  `);

  ensureSelfMemoryColumn(db, "pinned", "INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1))");
  ensureSelfMemoryColumn(db, "canonical_key", "TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_self_memory_facet ON self_memory(facet);
    CREATE INDEX IF NOT EXISTS idx_self_memory_updated ON self_memory(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_self_memory_deleted ON self_memory(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_self_memory_pinned ON self_memory(pinned, salience DESC, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_self_memory_canonical_key_active
      ON self_memory(canonical_key)
      WHERE canonical_key IS NOT NULL AND deleted_at IS NULL;
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS self_memory_fts USING fts5(
      title,
      content,
      tags,
      tokenize = 'unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS self_memory_ai AFTER INSERT ON self_memory BEGIN
      INSERT INTO self_memory_fts(rowid, title, content, tags)
      VALUES (new.rowid, COALESCE(new.title, ''), new.content, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS self_memory_ad AFTER DELETE ON self_memory BEGIN
      DELETE FROM self_memory_fts WHERE rowid = old.rowid;
    END;

    CREATE TRIGGER IF NOT EXISTS self_memory_au AFTER UPDATE ON self_memory BEGIN
      DELETE FROM self_memory_fts WHERE rowid = old.rowid;
      INSERT INTO self_memory_fts(rowid, title, content, tags)
      VALUES (new.rowid, COALESCE(new.title, ''), new.content, new.tags);
    END;
  `);

  // Only rebuild FTS if empty (first run or after manual purge).
  // On normal startup, triggers keep FTS in sync — a full rebuild is wasteful.
  const ftsCount = (db.prepare(`SELECT COUNT(*) AS n FROM self_memory_fts`).get() as { n: number }).n;
  const memCount = (db.prepare(`SELECT COUNT(*) AS n FROM self_memory`).get() as { n: number }).n;
  if (ftsCount === 0 && memCount > 0) {
    db.exec(`
      INSERT INTO self_memory_fts(rowid, title, content, tags)
      SELECT rowid, COALESCE(title, ''), content, tags
      FROM self_memory;
    `);
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO self_profile (
      id,
      self_name,
      core_identity,
      communication_style,
      relational_style,
      empathy_style,
      core_values,
      boundaries,
      self_narrative,
      created_at,
      updated_at
    )
    VALUES ('self', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
  ).run(now, now);
}

function ensureSelfMemoryColumn(db: Database, columnName: string, columnSql: string): void {
  const columns = db.pragma("table_info(self_memory)") as Array<{ name: string }>;
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    db.exec(`ALTER TABLE self_memory ADD COLUMN ${columnName} ${columnSql}`);
  }
}
