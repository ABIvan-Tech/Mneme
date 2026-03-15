import type { Database, Statement } from "better-sqlite3";

import type { AuditLogEntry, MemoryFacet, SelfMemoryRow, SelfProfile } from "./domain.js";

export interface CreateSelfMemoryInput {
  id: string;
  title: string | null;
  content: string;
  facet: MemoryFacet;
  salience: number;
  source: string | null;
  tags: string;
  pinned: number;
  canonical_key: string | null;
  embedding: Buffer | null;
  access_count?: number;
  last_accessed_at?: number | null;
  created_at: number;
  updated_at: number;
}

export interface UpdateSelfMemoryInput {
  title?: string | null;
  content?: string;
  facet?: MemoryFacet;
  salience?: number;
  source?: string | null;
  tags?: string;
  pinned?: number;
  canonical_key?: string | null;
  embedding?: Buffer | null;
  access_count?: number;
  last_accessed_at?: number | null;
  updated_at: number;
}

export interface MemoryQueryOptions {
  facet?: MemoryFacet;
  pinnedOnly?: boolean;
}

export interface SearchSelfMemoryOptions extends MemoryQueryOptions {
  limit: number;
  queryEmbedding?: Buffer;
}

export type SearchMode = "fts" | "like" | "hybrid" | "vector";

function calculateCosineSimilarity(a: Buffer, b: Buffer): number {
  const floatsA = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  const floatsB = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < floatsA.length; i++) {
    const valA = floatsA[i];
    const valB = floatsB[i];
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function buildFtsQuery(query: string): string | null {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const normalized = [...new Set(tokens.map((token) => token.toLowerCase()))];

  if (normalized.length === 0) {
    return null;
  }

  return normalized.map((token) => `${token}*`).join(" AND ");
}

function makeExclusionClause(excludeIds: string[]): { clause: string; params: string[] } {
  if (excludeIds.length === 0) {
    return { clause: "", params: [] };
  }

  const placeholders = excludeIds.map(() => "?").join(", ");
  return {
    clause: ` AND id NOT IN (${placeholders})`,
    params: excludeIds,
  };
}

export class SelfMemoryRepository {
  // Cached prepared statements for hot-path queries
  private readonly stmts: {
    findById: Statement;
    findByCanonicalKey: Statement;
    insertMemory: Statement;
    softDelete: Statement;
    getProfile: Statement;
    countByFacet: Statement;
    countPinned: Statement;
    exportMemories: Statement;
    listAnchors: Statement;
    memoryCount: Statement;
    dbPageCount: Statement;
    dbPageSize: Statement;
    insertAuditLog: Statement;
    listAuditLogs: Statement;
    recordAccess: Statement;
    purgeDeletedMemories: Statement;
    findLowestScoringMemory: Statement;
  };

  constructor(private readonly db: Database) {
    this.stmts = {
      findById: db.prepare(
        `SELECT * FROM self_memory WHERE id = ? AND deleted_at IS NULL`,
      ),
      findByCanonicalKey: db.prepare(
        `SELECT * FROM self_memory WHERE canonical_key = ? AND deleted_at IS NULL`,
      ),
      insertMemory: db.prepare(
        `INSERT INTO self_memory (
          id, title, content, facet, salience, source, tags,
          pinned, canonical_key, embedding, access_count, last_accessed_at, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ),
      softDelete: db.prepare(
        `UPDATE self_memory SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
      ),
      getProfile: db.prepare(
        `SELECT * FROM self_profile WHERE id = 'self'`,
      ),
      countByFacet: db.prepare(
        `SELECT facet, COUNT(*) AS count FROM self_memory WHERE deleted_at IS NULL GROUP BY facet`,
      ),
      countPinned: db.prepare(
        `SELECT COUNT(*) AS count FROM self_memory WHERE deleted_at IS NULL AND pinned = 1`,
      ),
      exportMemories: db.prepare(
        `SELECT * FROM self_memory WHERE deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC`,
      ),
      listAnchors: db.prepare(
        `SELECT * FROM self_memory
         WHERE deleted_at IS NULL AND pinned = 1
         ORDER BY salience DESC, updated_at DESC
         LIMIT ?`,
      ),
      memoryCount: db.prepare(
        `SELECT COUNT(*) AS count FROM self_memory WHERE deleted_at IS NULL`,
      ),
      dbPageCount: db.prepare(`PRAGMA page_count`),
      dbPageSize: db.prepare(`PRAGMA page_size`),
      insertAuditLog: db.prepare(
        `INSERT INTO audit_log (action, target_type, target_id, summary, created_at) VALUES (?, ?, ?, ?, ?)`
      ),
      listAuditLogs: db.prepare(
        `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?`
      ),
      recordAccess: db.prepare(
        `UPDATE self_memory SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?`
      ),
      purgeDeletedMemories: db.prepare(
        `DELETE FROM self_memory WHERE deleted_at IS NOT NULL AND deleted_at < ?`
      ),
      findLowestScoringMemory: db.prepare(
        `SELECT * FROM self_memory 
         WHERE deleted_at IS NULL AND facet = ? AND pinned = 0
         ORDER BY (salience * MAX(0.3, 1.0 - ((unixepoch() * 1000 - updated_at) / 7776000000.0)) * (1.0 + (COALESCE(access_count, 0) * 0.05))) ASC
         LIMIT 1`
      ),
    };
  }

  public transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  public recordAccess(ids: string[], timestamp: number): void {
    if (ids.length === 0) return;
    const stmt = this.stmts.recordAccess;
    this.db.transaction(() => {
      for (const id of ids) {
        stmt.run(timestamp, id);
      }
    })();
  }

  public createMemory(input: CreateSelfMemoryInput): SelfMemoryRow {
    this.stmts.insertMemory.run(
      input.id,
      input.title,
      input.content,
      input.facet,
      input.salience,
      input.source,
      input.tags,
      input.pinned,
      input.canonical_key,
      input.embedding,
      input.access_count ?? 0,
      input.last_accessed_at ?? null,
      input.created_at,
      input.updated_at,
    );

    return this.findMemoryById(input.id) as SelfMemoryRow;
  }

  public findMemoryById(id: string): SelfMemoryRow | undefined {
    return this.stmts.findById.get(id) as SelfMemoryRow | undefined;
  }

  public findMemoryByCanonicalKey(canonicalKey: string): SelfMemoryRow | undefined {
    return this.stmts.findByCanonicalKey.get(canonicalKey) as SelfMemoryRow | undefined;
  }

  public listRecent(limit: number, options: MemoryQueryOptions = {}): SelfMemoryRow[] {
    const conditions = ["deleted_at IS NULL"];
    const params: Array<number | string> = [];

    if (options.facet) {
      conditions.push("facet = ?");
      params.push(options.facet);
    }

    if (options.pinnedOnly) {
      conditions.push("pinned = 1");
    }

    params.push(limit);

    return this.db.prepare(
      `SELECT * FROM self_memory
       WHERE ${conditions.join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT ?`,
    ).all(...params) as SelfMemoryRow[];
  }

  public listAnchors(limit: number): SelfMemoryRow[] {
    return this.stmts.listAnchors.all(limit) as SelfMemoryRow[];
  }

  public findSimilarDuplicate(embedding: Buffer, facet: string, threshold: number = 0.92): SelfMemoryRow | undefined {
    const rows = this.db.prepare(
      `SELECT * FROM self_memory WHERE deleted_at IS NULL AND facet = ? AND embedding IS NOT NULL`
    ).all(facet) as SelfMemoryRow[];

    let bestMem: SelfMemoryRow | undefined = undefined;
    let bestScore = -1;

    for (const row of rows) {
      if (!row.embedding) continue;
      const score = calculateCosineSimilarity(embedding, row.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestMem = row;
      }
    }

    if (bestScore >= threshold) {
      return bestMem;
    }
    return undefined;
  }

  public listSnapshotCandidates(limit: number, excludeIds: string[] = []): SelfMemoryRow[] {
    const exclusion = makeExclusionClause(excludeIds);

    return this.db.prepare(
      `SELECT * FROM self_memory
       WHERE deleted_at IS NULL${exclusion.clause}
       ORDER BY 
         pinned DESC, 
         salience * MAX(0.3, 1.0 - ((unixepoch() * 1000 - updated_at) / 7776000000.0)) * (1.0 + (COALESCE(access_count, 0) * 0.05)) DESC, 
         updated_at DESC
       LIMIT ?`,
    ).all(...exclusion.params, limit) as SelfMemoryRow[];
  }

  private searchMemoriesByVector(queryEmbedding: Buffer, options: SearchSelfMemoryOptions): { row: SelfMemoryRow, score: number }[] {
    const conditions = ["deleted_at IS NULL", "embedding IS NOT NULL"];
    const params: Array<number | string> = [];

    if (options.facet) {
      conditions.push("facet = ?");
      params.push(options.facet);
    }

    if (options.pinnedOnly) {
      conditions.push("pinned = 1");
    }

    const rows = this.db.prepare(
      `SELECT * FROM self_memory WHERE ${conditions.join(" AND ")}`
    ).all(...params) as SelfMemoryRow[];

    const scored = rows.map((row) => ({
      row,
      score: calculateCosineSimilarity(queryEmbedding, row.embedding as Buffer),
    }));

    return scored.sort((a, b) => b.score - a.score);
  }

  public searchMemories(query: string, options: SearchSelfMemoryOptions): { rows: SelfMemoryRow[]; mode: SearchMode } {
    const ftsQuery = buildFtsQuery(query);
    let ftsRows: SelfMemoryRow[] = [];
    let isFtsValid = false;

    if (ftsQuery) {
      const facetClause = options.facet ? "AND m.facet = ?" : "";
      const pinnedClause = options.pinnedOnly ? "AND m.pinned = 1" : "";
      const params: Array<number | string> = [ftsQuery];

      if (options.facet) {
        params.push(options.facet);
      }

      params.push(options.limit * 2); // Get more candidates for potential RRF

      try {
        ftsRows = this.db.prepare(
          `SELECT m.*
           FROM self_memory_fts
           JOIN self_memory m ON m.rowid = self_memory_fts.rowid
           WHERE self_memory_fts MATCH ?
             AND m.deleted_at IS NULL
             ${facetClause}
             ${pinnedClause}
           ORDER BY bm25(self_memory_fts, 4.0, 1.0, 2.0)
           LIMIT ?`,
        ).all(...params) as SelfMemoryRow[];
        isFtsValid = true;
      } catch {
        // FTS invalid (e.g., malformed syntax)
      }
    }

    if (options.queryEmbedding) {
      const vectorResults = this.searchMemoriesByVector(options.queryEmbedding, options);
      const vectorCandidates = vectorResults.slice(0, options.limit * 2).map(r => r.row);
      
      if (!isFtsValid || ftsRows.length === 0) {
        return {
          rows: vectorCandidates.slice(0, options.limit),
          mode: "vector",
        };
      }

      // We have both FTS and vector results, apply Reciprocal Rank Fusion (RRF)
      const K = 60;
      const scores = new Map<string, { row: SelfMemoryRow, score: number }>();

      ftsRows.forEach((row, index) => {
        const rrfScore = 1 / (K + index + 1);
        scores.set(row.id, { row, score: rrfScore });
      });

      vectorCandidates.forEach((row, index) => {
        const rrfScore = 1 / (K + index + 1);
        const existing = scores.get(row.id);
        if (existing) {
          existing.score += rrfScore;
        } else {
          scores.set(row.id, { row, score: rrfScore });
        }
      });

      const hybridRows = Array.from(scores.values())
        .map(entry => {
          let finalScore = entry.score;
          if (entry.row.pinned === 1) {
            finalScore += 2.0; // Boost pinned
          }
          finalScore += (entry.row.salience * 0.1); // Tie break with salience
          return { row: entry.row, score: finalScore };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, options.limit)
        .map(entry => entry.row);

      return { rows: hybridRows, mode: "hybrid" };
    }

    if (isFtsValid && ftsRows.length > 0) {
      return {
        rows: ftsRows.slice(0, options.limit),
        mode: "fts"
      };
    }

    return {
      rows: this.searchMemoriesByLike(query, options),
      mode: "like",
    };
  }

  private searchMemoriesByLike(query: string, options: SearchSelfMemoryOptions): SelfMemoryRow[] {
    const pattern = `%${query.trim().toLowerCase()}%`;
    const conditions = [
      "deleted_at IS NULL",
      "(LOWER(COALESCE(title, '')) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(COALESCE(canonical_key, '')) LIKE ?)",
    ];
    const params: Array<number | string> = [pattern, pattern, pattern, pattern];

    if (options.facet) {
      conditions.push("facet = ?");
      params.push(options.facet);
    }

    if (options.pinnedOnly) {
      conditions.push("pinned = 1");
    }

    params.push(pattern, pattern, pattern, pattern, options.limit);

    return this.db.prepare(
      `SELECT *
       FROM self_memory
       WHERE ${conditions.join(" AND ")}
       ORDER BY
         pinned DESC,
         CASE
           WHEN LOWER(COALESCE(title, '')) LIKE ? THEN 4
           WHEN LOWER(COALESCE(canonical_key, '')) LIKE ? THEN 3
           WHEN LOWER(content) LIKE ? THEN 2
           WHEN LOWER(tags) LIKE ? THEN 1
           ELSE 0
         END DESC,
         salience * MAX(0.3, 1.0 - ((unixepoch() * 1000 - updated_at) / 7776000000.0)) * (1.0 + (COALESCE(access_count, 0) * 0.05)) DESC,
         updated_at DESC
       LIMIT ?`,
    ).all(...params) as SelfMemoryRow[];
  }

  public updateMemory(id: string, input: UpdateSelfMemoryInput): SelfMemoryRow | undefined {
    const assignments: string[] = ["updated_at = ?"];
    const params: Array<string | number | null | Buffer> = [input.updated_at];

    if (Object.prototype.hasOwnProperty.call(input, "title")) {
      assignments.push("title = ?");
      params.push(input.title ?? null);
    }

    if (typeof input.content === "string") {
      assignments.push("content = ?");
      params.push(input.content);
    }

    if (typeof input.facet === "string") {
      assignments.push("facet = ?");
      params.push(input.facet);
    }

    if (typeof input.salience === "number") {
      assignments.push("salience = ?");
      params.push(input.salience);
    }

    if (Object.prototype.hasOwnProperty.call(input, "source")) {
      assignments.push("source = ?");
      params.push(input.source ?? null);
    }

    if (typeof input.tags === "string") {
      assignments.push("tags = ?");
      params.push(input.tags);
    }

    if (typeof input.pinned === "number") {
      assignments.push("pinned = ?");
      params.push(input.pinned);
    }

    if (Object.prototype.hasOwnProperty.call(input, "canonical_key")) {
      assignments.push("canonical_key = ?");
      params.push(input.canonical_key ?? null);
    }

    // Fix: embedding was defined in UpdateSelfMemoryInput but never written to SQL.
    // This caused stale vectors to persist when content was updated via canonical_key.
    if (Object.prototype.hasOwnProperty.call(input, "embedding")) {
      assignments.push("embedding = ?");
      params.push(input.embedding ?? null);
    }

    params.push(id);

    this.db.prepare(
      `UPDATE self_memory
       SET ${assignments.join(", ")}
       WHERE id = ? AND deleted_at IS NULL`,
    ).run(...params);

    return this.findMemoryById(id);
  }

  public softDeleteMemory(id: string, deletedAt: number): number {
    const result = this.stmts.softDelete.run(deletedAt, id);
    return result.changes;
  }

  public getProfile(): SelfProfile {
    return this.stmts.getProfile.get() as SelfProfile;
  }

  public saveProfile(profile: SelfProfile): SelfProfile {
    this.db.prepare(
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        self_name = excluded.self_name,
        core_identity = excluded.core_identity,
        communication_style = excluded.communication_style,
        relational_style = excluded.relational_style,
        empathy_style = excluded.empathy_style,
        core_values = excluded.core_values,
        boundaries = excluded.boundaries,
        self_narrative = excluded.self_narrative,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at`,
    ).run(
      profile.id,
      profile.self_name,
      profile.core_identity,
      profile.communication_style,
      profile.relational_style,
      profile.empathy_style,
      profile.core_values,
      profile.boundaries,
      profile.self_narrative,
      profile.created_at,
      profile.updated_at,
    );

    return this.getProfile();
  }

  public countByFacet(): Record<string, number> {
    const rows = this.stmts.countByFacet.all() as Array<{ facet: string; count: number }>;

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.facet] = row.count;
    }

    return result;
  }

  public countPinned(): number {
    const row = this.stmts.countPinned.get() as { count: number };
    return row.count;
  }

  public totalMemoryCount(): number {
    const row = this.stmts.memoryCount.get() as { count: number };
    return row.count;
  }

  public dbSizeBytes(): number {
    const pageCount = (this.stmts.dbPageCount.get() as { page_count: number }).page_count;
    const pageSize = (this.stmts.dbPageSize.get() as { page_size: number }).page_size;
    return pageCount * pageSize;
  }

  public exportMemories(): SelfMemoryRow[] {
    return this.stmts.exportMemories.all() as SelfMemoryRow[];
  }

  public insertAuditLog(log: Omit<AuditLogEntry, "id">): void {
    this.stmts.insertAuditLog.run(
      log.action,
      log.target_type,
      log.target_id,
      log.summary,
      log.created_at
    );
  }

  public listAuditLogs(limit: number): AuditLogEntry[] {
    return this.stmts.listAuditLogs.all(limit) as AuditLogEntry[];
  }

  public purgeDeletedMemories(olderThanMs: number): number {
    const result = this.stmts.purgeDeletedMemories.run(olderThanMs);
    return result.changes;
  }

  public findLowestScoringMemory(facet: string): SelfMemoryRow | undefined {
    return this.stmts.findLowestScoringMemory.get(facet) as SelfMemoryRow | undefined;
  }

  public listByFacet(facet: string): SelfMemoryRow[] {
    return this.db.prepare(
      `SELECT * FROM self_memory WHERE deleted_at IS NULL AND facet = ? ORDER BY pinned DESC, updated_at DESC`
    ).all(facet) as SelfMemoryRow[];
  }
}
