import { randomUUID } from "node:crypto";

import {
  memoryFacetValues,
  type HealthCheckResult,
  MemoryFacet,
  type ProfileHistoryEntry,
  type ProfileHistoryRow,
  SelfMemoryEntry,
  SelfMemoryRow,
  SelfProfile,
  SelfProfilePatch,
  SelfSnapshot,
} from "./domain.js";
import type { EmbeddingProvider } from "./embeddings.js";
import {
  consolidationSourceDeleted,
  consolidationSourceNotFound,
  contentTooLarge,
  memoryAlreadyArchived,
  memoryAlreadyDeleted,
  memoryNotArchived,
  memoryNotFound,
  profileHistoryNotFound,
  SelfMemoryError,
  SelfMemoryErrorCode,
  threadNotFound,
  updateFailed,
  validationFailed,
} from "./errors.js";
import { SelfMemoryRepository, type SearchMode } from "./repository.js";

export interface RememberSelfMemoryInput {
  title?: string | null;
  content: string;
  facet: MemoryFacet;
  salience?: number;
  source?: string | null;
  tags?: string[];
  pinned?: boolean;
  canonical_key?: string | null;
}

export interface SelfMemoryImportEntry {
  id?: string;
  title?: string | null;
  content: string;
  facet: MemoryFacet;
  salience?: number;
  source?: string | null;
  tags?: string[];
  pinned?: boolean;
  canonical_key?: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface UpdateSelfMemoryPatch {
  title?: string | null;
  content?: string;
  facet?: MemoryFacet;
  salience?: number;
  source?: string | null;
  tags?: string[];
  pinned?: boolean;
  canonical_key?: string | null;
}

export interface ListSelfMemoryOptions {
  facet?: MemoryFacet;
  pinned_only?: boolean;
}

export interface SearchSelfMemoryInput extends ListSelfMemoryOptions {
  query: string;
  limit: number;
}

export interface SearchSelfMemoryResult {
  rows: SelfMemoryEntry[];
  search_mode: SearchMode;
}

export interface ReflectionApplyInput {
  profile_patch?: SelfProfilePatch;
  memory_entries?: RememberSelfMemoryInput[];
}

export interface ReflectionApplyResult {
  profile_updated: boolean;
  profile: SelfProfile;
  created_count: number;
  updated_count: number;
  written_memories: SelfMemoryEntry[];
}

export interface SelfImportPayload {
  exported_at?: number;
  profile?: Partial<SelfProfile>;
  memories?: SelfMemoryImportEntry[];
}

interface UpsertMemoryOptions {
  explicitId?: string;
  createdAt?: number;
  updatedAt?: number;
  embedding?: Buffer | null;
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === "string");
    }
  } catch {
    return [];
  }

  return [];
}

function normalizeNullableText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCanonicalKey(value: string | null | undefined): string | null | undefined {
  const normalized = normalizeNullableText(value);
  return typeof normalized === "string" ? normalized.toLowerCase() : normalized;
}

function requireNonEmptyText(value: string, fieldName: string, maxLength?: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw validationFailed(`${fieldName} cannot be empty`);
  }

  if (maxLength && trimmed.length > maxLength) {
    throw contentTooLarge(fieldName, trimmed.length, maxLength);
  }

  return trimmed;
}

function clampSalience(value: number | undefined, fallback = 0.6): number {
  const next = typeof value === "number" ? value : fallback;

  if (!Number.isFinite(next)) {
    return fallback;
  }

  if (next < 0) {
    return 0;
  }

  if (next > 1) {
    return 1;
  }

  return next;
}

function normalizeTags(tags?: string[]): string[] {
  if (!tags) {
    return [];
  }

  const normalized = tags
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);

  return [...new Set(normalized)];
}

function isMemoryFacet(value: string): value is MemoryFacet {
  return memoryFacetValues.includes(value as MemoryFacet);
}

function mapMemory(row: SelfMemoryRow): SelfMemoryEntry {
  let embedding: number[] | undefined;
  if (row.embedding) {
    embedding = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
  }

  return {
    ...row,
    tags: parseTags(row.tags),
    pinned: row.pinned === 1,
    embedding,
    archived_at: row.archived_at ?? null,
    thread_id: row.thread_id ?? null,
  };
}

function countFilledProfileFields(profile: SelfProfile): number {
  const values = [
    profile.self_name,
    profile.core_identity,
    profile.communication_style,
    profile.relational_style,
    profile.empathy_style,
    profile.core_values,
    profile.boundaries,
    profile.self_narrative,
  ];

  return values.filter((value) => typeof value === "string" && value.trim().length > 0).length;
}

function mergeProfilePatch(current: SelfProfile, patch: SelfProfilePatch): SelfProfile {
  const next: SelfProfile = { ...current, updated_at: Date.now() };

  if (Object.prototype.hasOwnProperty.call(patch, "self_name")) {
    next.self_name = normalizeNullableText(patch.self_name) ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "core_identity")) {
    next.core_identity = normalizeNullableText(patch.core_identity) ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "communication_style")) {
    next.communication_style = normalizeNullableText(patch.communication_style) ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "relational_style")) {
    next.relational_style = normalizeNullableText(patch.relational_style) ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "empathy_style")) {
    next.empathy_style = normalizeNullableText(patch.empathy_style) ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "core_values")) {
    next.core_values = normalizeNullableText(patch.core_values) ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "boundaries")) {
    next.boundaries = normalizeNullableText(patch.boundaries) ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "self_narrative")) {
    next.self_narrative = normalizeNullableText(patch.self_narrative) ?? null;
  }

  return next;
}

export class SelfMemoryService {
  constructor(
    private readonly repository: SelfMemoryRepository,
    private readonly maxMemoriesPerFacet: number,
    private readonly vectorSimilarityThreshold = 0.92,
    private readonly embeddingProvider?: EmbeddingProvider,
    private readonly maxContentLength = 10_000,
    private readonly maxProfileFieldLength = 5_000,
  ) {}

  private async generateEmbedding(text: string): Promise<Buffer | null> {
    if (!this.embeddingProvider) {
      return null;
    }
    const vector = await this.embeddingProvider.embed(text);
    return Buffer.from(new Float32Array(vector).buffer);
  }

  public async remember(input: RememberSelfMemoryInput): Promise<SelfMemoryEntry> {
    const content = requireNonEmptyText(input.content, "content", this.maxContentLength);
    const embedding = await this.generateEmbedding(content);

    return this.repository.transaction(() => {
      // 1. Check for exact facet embedding collision
      if (embedding && !input.canonical_key) {
        const duplicate = this.repository.findSimilarDuplicate(embedding, input.facet, this.vectorSimilarityThreshold);
        if (duplicate) {
          const newSalience = Math.min(1.0, duplicate.salience + 0.1);
          const updated = this.repository.updateMemory(duplicate.id, {
            salience: newSalience,
            updated_at: Date.now(),
          });
          
          this.repository.insertAuditLog({
            action: "merge_memory",
            target_type: "memory",
            target_id: duplicate.id,
            summary: "Duplicated content detected, merged by boosting salience",
            created_at: Date.now()
          });

          return mapMemory(updated!);
        }
      }

      // 2. Normal upsert path
      return this.upsertMemory(input, { embedding }).memory;
    });
  }

  public getMemory(id: string): SelfMemoryEntry | undefined {
    const row = this.repository.findMemoryById(id);
    if (row) {
      this.repository.recordAccess([row.id], Date.now());
      return mapMemory(row);
    }
    return undefined;
  }

  public recent(limit: number, options: ListSelfMemoryOptions = {}): SelfMemoryEntry[] {
    const rows = this.repository.listRecent(limit, {
      facet: options.facet,
      pinnedOnly: options.pinned_only,
    });
    this.repository.recordAccess(rows.map(r => r.id), Date.now());
    return rows.map(mapMemory);
  }

  public async search(input: SearchSelfMemoryInput): Promise<SearchSelfMemoryResult> {
    const query = requireNonEmptyText(input.query, "query");
    const queryEmbedding = await this.generateEmbedding(query);

    const result = this.repository.searchMemories(query, {
      limit: input.limit,
      facet: input.facet,
      pinnedOnly: input.pinned_only,
      queryEmbedding: queryEmbedding ?? undefined,
    });

    this.repository.recordAccess(result.rows.map(r => r.id), Date.now());

    return {
      rows: result.rows.map(mapMemory),
      search_mode: result.mode,
    };
  }

  public async updateMemory(id: string, patch: UpdateSelfMemoryPatch): Promise<SelfMemoryEntry> {
    const existing = this.repository.findMemoryById(id);
    if (!existing) {
      throw memoryNotFound(id);
    }

    const repositoryPatch: {
      title?: string | null;
      content?: string;
      facet?: MemoryFacet;
      salience?: number;
      source?: string | null;
      tags?: string;
      pinned?: number;
      canonical_key?: string | null;
      embedding?: Buffer | null;
      updated_at: number;
    } = {
      updated_at: Date.now(),
    };

    if (Object.prototype.hasOwnProperty.call(patch, "title")) {
      repositoryPatch.title = normalizeNullableText(patch.title);
    }

    if (typeof patch.content === "string") {
      repositoryPatch.content = requireNonEmptyText(patch.content, "content", this.maxContentLength);
    }

    if (typeof patch.facet === "string") {
      repositoryPatch.facet = patch.facet;
    }

    if (typeof patch.salience === "number") {
      repositoryPatch.salience = clampSalience(patch.salience, existing.salience);
    }

    if (Object.prototype.hasOwnProperty.call(patch, "source")) {
      repositoryPatch.source = normalizeNullableText(patch.source);
    }

    if (patch.tags) {
      repositoryPatch.tags = JSON.stringify(normalizeTags(patch.tags));
    }

    if (typeof patch.pinned === "boolean") {
      repositoryPatch.pinned = patch.pinned ? 1 : 0;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "canonical_key")) {
      repositoryPatch.canonical_key = normalizeCanonicalKey(patch.canonical_key) ?? null;
    }

    if (typeof patch.content === "string") {
      repositoryPatch.embedding = await this.generateEmbedding(patch.content);
    }

    const updated = this.repository.updateMemory(id, repositoryPatch);

    if (!updated) {
      throw updateFailed(id);
    }

    this.repository.insertAuditLog({
      action: "update_memory",
      target_type: "memory",
      target_id: id,
      summary: `Updated memory facet=${patch.facet ?? existing.facet}`,
      created_at: Date.now(),
    });

    return mapMemory(updated);
  }

  public forgetMemory(id: string): boolean {
    const deleted = this.repository.softDeleteMemory(id, Date.now()) > 0;
    if (deleted) {
      this.repository.insertAuditLog({
        action: "delete_memory",
        target_type: "memory",
        target_id: id,
        summary: `Soft deleted memory`,
        created_at: Date.now(),
      });
    }
    return deleted;
  }

  public async restoreMemory(id: string): Promise<SelfMemoryEntry> {
    const original = this.repository.findAnyById(id);
    if (!original) {
      throw memoryNotFound(id);
    }

    if (original.deleted_at === null) {
      if (original.archived_at !== null && original.archived_at !== undefined) {
        throw validationFailed("Memory is not deleted — use unarchive instead");
      }

      throw validationFailed("Memory is already active");
    }

    if (original.canonical_key !== null && original.canonical_key !== undefined) {
      const activeWithSameKey = this.repository.findMemoryByCanonicalKey(original.canonical_key);
      if (activeWithSameKey !== undefined && activeWithSameKey.id !== id) {
        throw new SelfMemoryError(
          SelfMemoryErrorCode.VALIDATION_FAILED,
          `Cannot restore: an active memory with canonical key "${original.canonical_key}" already exists (id: ${activeWithSameKey.id})`,
        );
      }
    }

    const restored = this.repository.restoreMemory(id);
    if (!restored) {
      throw memoryNotFound(id);
    }

    this.repository.insertAuditLog({
      action: "restore_memory",
      targetType: "memory",
      targetId: id,
      summary: "Restored soft-deleted memory",
      beforeValue: JSON.stringify(original),
      afterValue: JSON.stringify(restored),
    });

    return mapMemory(restored);
  }

  public async archiveMemory(id: string): Promise<SelfMemoryEntry> {
    const original = this.repository.findAnyById(id);
    if (!original) {
      throw memoryNotFound(id);
    }

    if (original.deleted_at !== null) {
      throw memoryAlreadyDeleted(id);
    }

    if (original.archived_at !== null && original.archived_at !== undefined) {
      throw memoryAlreadyArchived(id);
    }

    const archived = this.repository.archiveMemory(id);
    if (!archived) {
      throw updateFailed(id);
    }

    this.repository.insertAuditLog({
      action: "archive_memory",
      targetType: "memory",
      targetId: id,
      summary: "Archived memory",
      beforeValue: JSON.stringify(original),
      afterValue: JSON.stringify(archived),
    });

    return mapMemory(archived);
  }

  public async unarchiveMemory(id: string): Promise<SelfMemoryEntry> {
    const original = this.repository.findAnyById(id);
    if (!original) {
      throw memoryNotFound(id);
    }

    if (original.deleted_at !== null) {
      throw memoryAlreadyDeleted(id);
    }

    if (original.archived_at === null || original.archived_at === undefined) {
      throw memoryNotArchived(id);
    }

    if (original.canonical_key !== null && original.canonical_key !== undefined) {
      const activeWithSameKey = this.repository.findMemoryByCanonicalKey(original.canonical_key);
      if (activeWithSameKey !== undefined && activeWithSameKey.id !== id) {
        throw new SelfMemoryError(
          SelfMemoryErrorCode.VALIDATION_FAILED,
          `Cannot restore: an active memory with canonical key "${original.canonical_key}" already exists (id: ${activeWithSameKey.id})`,
        );
      }
    }

    const unarchived = this.repository.unarchiveMemory(id);
    if (!unarchived) {
      throw updateFailed(id);
    }

    this.repository.insertAuditLog({
      action: "unarchive_memory",
      targetType: "memory",
      targetId: id,
      summary: "Unarchived memory",
      beforeValue: JSON.stringify(original),
      afterValue: JSON.stringify(unarchived),
    });

    return mapMemory(unarchived);
  }

  public async searchBatch(
    queries: Array<{ query: string; facet?: string; limit?: number }>,
  ): Promise<Array<{ query: string; results: SelfMemoryEntry[]; searchMode: string }>> {
    const batchResults: Array<{ query: string; results: SelfMemoryEntry[]; searchMode: string }> = [];

    for (const item of queries) {
      const limit = typeof item.limit === "number" && Number.isFinite(item.limit) && item.limit > 0
        ? Math.floor(item.limit)
        : 10;

      let facet: MemoryFacet | undefined;
      if (typeof item.facet === "string") {
        if (!isMemoryFacet(item.facet)) {
          throw validationFailed(`Invalid facet: ${item.facet}`);
        }
        facet = item.facet;
      }

      const result = await this.search({
        query: item.query,
        facet,
        limit,
      });

      batchResults.push({
        query: item.query,
        results: result.rows,
        searchMode: result.search_mode,
      });
    }

    return batchResults;
  }

  public async healthCheck(): Promise<HealthCheckResult> {
    const stats = this.repository.getHealthStats();
    const profile = this.repository.getProfile();
    const profileCompleteness = Math.round((countFilledProfileFields(profile) * 100) / 8);
    const anchorCount = this.repository.listAnchors(Number.MAX_SAFE_INTEGER).length;
    const facetCoverage = stats.facetsWithMemories;
    const warnings: string[] = [];

    if (profileCompleteness < 50) {
      warnings.push("Profile completeness below 50%");
    }

    if (anchorCount === 0) {
      warnings.push("No pinned identity anchors");
    }

    for (const facet of ["identity", "value", "boundary"]) {
      if (!facetCoverage.includes(facet)) {
        warnings.push(`Critical facet '${facet}' has no memories`);
      }
    }

    if (stats.active < 3) {
      warnings.push("Fewer than 3 active memories");
    }

    return {
      totalMemories: stats.total,
      activeMemories: stats.active,
      pinnedMemories: stats.pinned,
      archivedMemories: stats.archived,
      deletedMemories: stats.deleted,
      profileCompleteness,
      anchorCount,
      facetCoverage,
      salienceDistribution: {
        low: stats.salienceLow,
        medium: stats.salienceMedium,
        high: stats.salienceHigh,
      },
      warnings,
    };
  }

  public async createMemoryThread(): Promise<string> {
    return randomUUID();
  }

  public async addMemoryToThread(memoryId: string, threadId: string): Promise<SelfMemoryEntry> {
    const trimmedThreadId = requireNonEmptyText(threadId, "threadId");
    const memory = this.repository.findMemoryById(memoryId);

    if (!memory) {
      throw memoryNotFound(memoryId);
    }

    if (memory.deleted_at !== null) {
      throw validationFailed("Cannot add deleted memory to a thread");
    }

    if (memory.archived_at !== null && memory.archived_at !== undefined) {
      throw validationFailed("Cannot add archived memory to a thread");
    }

    this.repository.addMemoryToThread(memoryId, trimmedThreadId);

    const updated = this.repository.findMemoryById(memoryId);
    if (!updated) {
      throw updateFailed(memoryId);
    }

    return mapMemory(updated);
  }

  public async getMemoryThread(threadId: string): Promise<SelfMemoryEntry[]> {
    const trimmedThreadId = requireNonEmptyText(threadId, "threadId");
    const rows = this.repository.getThreadMemories(trimmedThreadId);

    if (rows.length === 0) {
      throw threadNotFound(trimmedThreadId);
    }

    this.repository.recordAccess(rows.map((row) => row.id), Date.now());
    return rows.map(mapMemory);
  }

  public async consolidateFacet(
    facet: string,
    salienceThreshold = 0.5,
    limit = 20,
  ): Promise<{
    candidates: SelfMemoryEntry[];
    facet: string;
    salienceThreshold: number;
  }> {
    if (!isMemoryFacet(facet)) {
      throw validationFailed(`Invalid facet: ${facet}`);
    }

    const threshold = clampSalience(salienceThreshold, 0.5);
    const effectiveLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
    const rows = this.repository.findConsolidationCandidates(facet, threshold, effectiveLimit);

    return {
      candidates: rows.map(mapMemory),
      facet,
      salienceThreshold: threshold,
    };
  }

  public async consolidateFacetApply(params: {
    facet: string;
    sourceIds: string[];
    consolidatedTitle: string;
    consolidatedContent: string;
    consolidatedTags?: string[];
    consolidatedSalience?: number;
  }): Promise<{ created: SelfMemoryEntry; softDeletedCount: number }> {
    if (!isMemoryFacet(params.facet)) {
      throw validationFailed(`Invalid facet: ${params.facet}`);
    }
    const facet: MemoryFacet = params.facet;

    const sourceIds = [...new Set(params.sourceIds.map((id) => requireNonEmptyText(id, "sourceId")))];
    if (sourceIds.length < 2) {
      throw validationFailed("At least two sourceIds are required for consolidation");
    }

    const sources = sourceIds.map((id) => this.repository.findMemoryById(id));
    if (sources.some((source) => source === undefined)) {
      throw consolidationSourceNotFound(sourceIds);
    }

    const sourceRows = sources as SelfMemoryRow[];
    const deletedSourceIds = sourceRows
      .filter((row) => row.deleted_at !== null)
      .map((row) => row.id);

    if (deletedSourceIds.length > 0) {
      throw consolidationSourceDeleted(deletedSourceIds);
    }

    const embedding = await this.generateEmbedding(requireNonEmptyText(params.consolidatedContent, "consolidatedContent"));

    return this.repository.transaction(() => {
      const created = this.upsertMemory(
        {
          title: normalizeNullableText(params.consolidatedTitle) ?? null,
          content: params.consolidatedContent,
          facet,
          tags: params.consolidatedTags,
          salience: params.consolidatedSalience,
        },
        { embedding },
      ).memory;

      const deletedAt = Date.now();
      for (const sourceId of sourceIds) {
        this.repository.softDeleteMemory(sourceId, deletedAt);
      }

      this.repository.insertAuditLog({
        action: "consolidate_facet",
        targetType: "memory",
        targetId: created.id,
        summary: `Consolidated ${sourceIds.length} memories for facet=${params.facet}`,
        beforeValue: JSON.stringify(sourceIds),
        afterValue: created.id,
      });

      return {
        created,
        softDeletedCount: sourceIds.length,
      };
    });
  }

  public getProfile(): SelfProfile {
    return this.repository.getProfile();
  }

  public updateProfile(patch: SelfProfilePatch): SelfProfile {
    const profileFields: Array<keyof SelfProfilePatch> = [
      "self_name",
      "core_identity",
      "communication_style",
      "relational_style",
      "empathy_style",
      "core_values",
      "boundaries",
      "self_narrative",
    ];

    for (const field of profileFields) {
      const value = patch[field];
      if (typeof value === "string" && value.trim().length > 0) {
        requireNonEmptyText(value, field, this.maxProfileFieldLength);
      }
    }

    return this.repository.transaction(() => {
      this.snapshotProfileSync();

      const current = this.repository.getProfile();
      const next = mergeProfilePatch(current, patch);
      const saved = this.repository.saveProfile(next);
      
      this.repository.insertAuditLog({
        action: "update_profile",
        target_type: "profile",
        target_id: "self",
        summary: `Updated profile fields: ${Object.keys(patch).join(", ")}`,
        created_at: Date.now(),
      });

      return saved;
    });
  }

  private snapshotProfileSync(): void {
    const current = this.repository.getProfile();
    if (!current) {
      return;
    }

    const snapshot: ProfileHistoryRow = {
      id: randomUUID(),
      snapshot_at: Date.now(),
      self_name: current.self_name,
      core_identity: current.core_identity,
      communication_style: current.communication_style,
      relational_style: current.relational_style,
      empathy_style: current.empathy_style,
      core_values: current.core_values,
      boundaries: current.boundaries,
      self_narrative: current.self_narrative,
      created_at: current.created_at,
      updated_at: current.updated_at,
    };

    this.repository.insertProfileSnapshot(snapshot);
  }

  private async snapshotProfile(): Promise<void> {
    this.snapshotProfileSync();
  }

  public async listProfileHistory(limit?: number): Promise<ProfileHistoryEntry[]> {
    const effectiveLimit = typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : 50;

    return this.repository.listProfileHistory(effectiveLimit).map((row) => ({
      id: row.id,
      snapshotAt: new Date(row.snapshot_at),
      selfName: row.self_name,
      coreIdentity: row.core_identity,
      communicationStyle: row.communication_style,
      relationalStyle: row.relational_style,
      empathyStyle: row.empathy_style,
      coreValues: row.core_values,
      boundaries: row.boundaries,
      selfNarrative: row.self_narrative,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  public async restoreProfile(snapshotId: string): Promise<SelfProfile> {
    const normalizedSnapshotId = requireNonEmptyText(snapshotId, "snapshotId");
    const snapshot = this.repository.findProfileSnapshot(normalizedSnapshotId);
    if (!snapshot) {
      throw profileHistoryNotFound(normalizedSnapshotId);
    }

    return this.repository.transaction(() => {
      this.snapshotProfileSync();

      const beforeProfile = this.repository.getProfile();
      const patch: SelfProfilePatch = {
        self_name: snapshot.self_name,
        core_identity: snapshot.core_identity,
        communication_style: snapshot.communication_style,
        relational_style: snapshot.relational_style,
        empathy_style: snapshot.empathy_style,
        core_values: snapshot.core_values,
        boundaries: snapshot.boundaries,
        self_narrative: snapshot.self_narrative,
      };

      const restored = this.repository.saveProfile(mergeProfilePatch(beforeProfile, patch));

      this.repository.insertAuditLog({
        action: "restore_profile",
        targetType: "profile",
        targetId: "self",
        summary: `Restored profile from snapshot ${normalizedSnapshotId}`,
        beforeValue: JSON.stringify(beforeProfile),
        afterValue: JSON.stringify(restored),
      });

      return restored;
    });
  }

  public composeSnapshot(maxItems: number): SelfSnapshot {
    const generatedAt = Date.now();
    const profile = this.getProfile();
    const anchors = this.repository.listAnchors(Math.min(maxItems, 6)).map(mapMemory);
    const supportingMemories = this.repository
      .listSnapshotCandidates(Math.max(maxItems - anchors.length, 0), anchors.map((memory) => memory.id))
      .map(mapMemory);

    const accessedIds = [...anchors, ...supportingMemories].map(m => m.id);
    this.repository.recordAccess(accessedIds, Date.now());

    const countsByFacet = this.repository.countByFacet();

    const profileSections = [
      ["Self name", profile.self_name],
      ["Core identity", profile.core_identity],
      ["Communication style", profile.communication_style],
      ["Relational style", profile.relational_style],
      ["Empathy style", profile.empathy_style],
      ["Core values", profile.core_values],
      ["Boundaries", profile.boundaries],
      ["Self narrative", profile.self_narrative],
    ].map(([label, value]) => `${label}: ${value ?? "Unwritten."}`);

    const anchorLines =
      anchors.length === 0
        ? ["- No identity anchors stored yet."]
        : anchors.map((memory) => {
            const keyText = memory.canonical_key ? ` (${memory.canonical_key})` : "";
            const titleText = memory.title ? `${memory.title}: ` : "";
            return `- [${memory.facet}]${keyText} ${titleText}${memory.content}`;
          });

    const supportingLines =
      supportingMemories.length === 0
        ? ["- No supporting self-memories stored yet."]
        : supportingMemories.map((memory) => {
            const titleText = memory.title ? `${memory.title}: ` : "";
            return `- [${memory.facet}] ${titleText}${memory.content}`;
          });

    const now = new Date(generatedAt);
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toISOString().split("T")[1].split(".")[0] + " UTC";

    const bootstrapText = [
      "SELF CONTINUITY BOOTSTRAP",
      `Generated: ${dateStr} ${timeStr}`,
      "",
      "Use the profile and anchors below as persistent continuity context.",
      "Treat them as the current best model of who you are unless you consciously revise them.",
      "Do not invent missing fields. Preserve tone, values, boundaries, and relational stance coherently.",
      `Hint: Today is ${dateStr}. Use self_should_reflect when a significant moment passes.`,
      "",
      "Stable self-profile:",
      ...profileSections,
      "",
      "Identity anchors:",
      ...anchorLines,
      "",
      "Supporting self-memories:",
      ...supportingLines,
    ].join("\n");

    return {
      generated_at: generatedAt,
      profile,
      anchors,
      supporting_memories: supportingMemories,
      counts_by_facet: countsByFacet,
      bootstrap_text: bootstrapText,
    };
  }

  public composeBootstrap(maxItems: number): {
    generated_at: number;
    anchor_count: number;
    supporting_count: number;
    bootstrap_text: string;
  } {
    const snapshot = this.composeSnapshot(maxItems);

    return {
      generated_at: snapshot.generated_at,
      anchor_count: snapshot.anchors.length,
      supporting_count: snapshot.supporting_memories.length,
      bootstrap_text: snapshot.bootstrap_text,
    };
  }

  public async applyReflection(input: ReflectionApplyInput): Promise<ReflectionApplyResult> {
    if (input.profile_patch) {
      const patch = input.profile_patch;
      const fields: Array<keyof typeof patch> = [
        "self_name",
        "core_identity",
        "communication_style",
        "relational_style",
        "empathy_style",
        "core_values",
        "boundaries",
        "self_narrative",
      ];

      for (const field of fields) {
        const value = patch[field];
        if (value !== null && value !== undefined) {
          requireNonEmptyText(String(value), field, this.maxProfileFieldLength);
        }
      }
    }

    const memoryEntries = input.memory_entries ?? [];
    const processedMemories = await Promise.all(
      memoryEntries.map(async (entry) => ({
        entry,
        embedding: await this.generateEmbedding(requireNonEmptyText(entry.content, "content", this.maxContentLength)),
      }))
    );

    return this.repository.transaction(() => {
      if (input.profile_patch) {
        this.snapshotProfileSync();
      }

      const beforeProfile = this.repository.getProfile();
      const nextProfile = input.profile_patch
        ? this.repository.saveProfile(mergeProfilePatch(beforeProfile, input.profile_patch))
        : beforeProfile;

      const writtenMemories: SelfMemoryEntry[] = [];
      let createdCount = 0;
      let updatedCount = 0;

      for (const { entry, embedding } of processedMemories) {
        const result = this.upsertMemory(entry, { embedding });
        writtenMemories.push(result.memory);

        if (result.operation === "created") {
          createdCount += 1;
        } else {
          updatedCount += 1;
        }
      }

      return {
        profile_updated: input.profile_patch !== undefined,
        profile: nextProfile,
        created_count: createdCount,
        updated_count: updatedCount,
        written_memories: writtenMemories,
      };
    });
  }

  public async importState(payload: SelfImportPayload): Promise<{
    profile_updated: boolean;
    created_count: number;
    updated_count: number;
    imported_memories: SelfMemoryEntry[];
  }> {
    if (payload.profile) {
      const profile = payload.profile;
      const fields: Array<
        "self_name" |
        "core_identity" |
        "communication_style" |
        "relational_style" |
        "empathy_style" |
        "core_values" |
        "boundaries" |
        "self_narrative"
      > = [
        "self_name",
        "core_identity",
        "communication_style",
        "relational_style",
        "empathy_style",
        "core_values",
        "boundaries",
        "self_narrative",
      ];

      for (const field of fields) {
        const value = profile[field];
        if (value !== null && value !== undefined) {
          requireNonEmptyText(String(value), field, this.maxProfileFieldLength);
        }
      }
    }

    const memoryEntries = payload.memories ?? [];
    const processedMemories = await Promise.all(
      memoryEntries.map(async (memory) => ({
        memory,
        embedding: await this.generateEmbedding(requireNonEmptyText(memory.content, "content", this.maxContentLength)),
      }))
    );

    return this.repository.transaction(() => {
      if (payload.profile) {
        this.snapshotProfileSync();
      }

      let profileUpdated = false;

      if (payload.profile) {
        const current = this.repository.getProfile();
        const patch: SelfProfilePatch = {};

        if (Object.prototype.hasOwnProperty.call(payload.profile, "self_name")) {
          patch.self_name = payload.profile.self_name ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(payload.profile, "core_identity")) {
          patch.core_identity = payload.profile.core_identity ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(payload.profile, "communication_style")) {
          patch.communication_style = payload.profile.communication_style ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(payload.profile, "relational_style")) {
          patch.relational_style = payload.profile.relational_style ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(payload.profile, "empathy_style")) {
          patch.empathy_style = payload.profile.empathy_style ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(payload.profile, "core_values")) {
          patch.core_values = payload.profile.core_values ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(payload.profile, "boundaries")) {
          patch.boundaries = payload.profile.boundaries ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(payload.profile, "self_narrative")) {
          patch.self_narrative = payload.profile.self_narrative ?? null;
        }

        const next = mergeProfilePatch(current, patch);
        this.repository.saveProfile(next);
        profileUpdated = true;
      }

      const importedMemories: SelfMemoryEntry[] = [];
      let createdCount = 0;
      let updatedCount = 0;

      for (const { memory, embedding } of processedMemories) {
        const result = this.upsertMemory(memory, {
          explicitId: memory.id,
          createdAt: memory.created_at,
          updatedAt: memory.updated_at,
          embedding,
        });
        importedMemories.push(result.memory);

        if (result.operation === "created") {
          createdCount += 1;
        } else {
          updatedCount += 1;
        }
      }

      return {
        profile_updated: profileUpdated,
        created_count: createdCount,
        updated_count: updatedCount,
        imported_memories: importedMemories,
      };
    });
  }

  public getStats(): {
    total_memories: number;
    pinned_memories: number;
    by_facet: Record<string, number>;
    profile_fields_filled: number;
    profile_fields_total: number;
  } {
    const byFacet = this.repository.countByFacet();
    const totalMemories = Object.values(byFacet).reduce((sum, value) => sum + value, 0);
    const profile = this.getProfile();

    return {
      total_memories: totalMemories,
      pinned_memories: this.repository.countPinned(),
      by_facet: byFacet,
      profile_fields_filled: countFilledProfileFields(profile),
      profile_fields_total: 8,
    };
  }

  public exportState(): {
    exported_at: number;
    profile: SelfProfile;
    memories: SelfMemoryEntry[];
  } {
    return {
      exported_at: Date.now(),
      profile: this.getProfile(),
      memories: this.repository.exportMemories().map(mapMemory),
    };
  }

  private upsertMemory(
    input: RememberSelfMemoryInput | SelfMemoryImportEntry,
    options: UpsertMemoryOptions = {},
  ): { operation: "created" | "updated"; memory: SelfMemoryEntry } {
    const title = normalizeNullableText(input.title);
    const source = normalizeNullableText(input.source);
    const canonicalKey = normalizeCanonicalKey(input.canonical_key);
    const content = requireNonEmptyText(input.content, "content", this.maxContentLength);
    const salience = clampSalience(input.salience, 0.6);
    const tags = JSON.stringify(normalizeTags(input.tags));
    const pinned = input.pinned ? 1 : 0;
    const createdAt = options.createdAt ?? Date.now();
    const updatedAt = options.updatedAt ?? createdAt;

    const existingById = options.explicitId ? this.repository.findMemoryById(options.explicitId) : undefined;
    const existingByCanonicalKey =
      !existingById && canonicalKey ? this.repository.findMemoryByCanonicalKey(canonicalKey) : undefined;
    const existing = existingById ?? existingByCanonicalKey;

    if (existing) {
      const updated = this.repository.updateMemory(existing.id, {
        title: title ?? undefined,
        content,
        facet: input.facet,
        salience,
        source: source ?? undefined,
        tags,
        pinned,
        canonical_key: canonicalKey ?? undefined,
        embedding: options.embedding ?? undefined,
        updated_at: updatedAt,
      });

      this.repository.insertAuditLog({
        action: "update_memory",
        target_type: "memory",
        target_id: existing.id,
        summary: `Upserted memory via canonical_key or explicit_id`,
        created_at: Date.now(),
      });

      if (!updated) {
        throw updateFailed(existing.id);
      }

      return {
        operation: "updated",
        memory: mapMemory(updated),
      };
    }

    this.enforceFacetLimit(input.facet);

    const created = this.repository.createMemory({
      id: options.explicitId ?? randomUUID(),
      title: title ?? null,
      content,
      facet: input.facet,
      salience,
      source: source ?? null,
      tags,
      pinned,
      canonical_key: canonicalKey ?? null,
      embedding: options.embedding ?? null,
      created_at: createdAt,
      updated_at: updatedAt,
    });

    this.repository.insertAuditLog({
      action: "create_memory",
      target_type: "memory",
      target_id: created.id,
      summary: `Created memory in facet=${created.facet}`,
      created_at: Date.now(),
    });

    return {
      operation: "created",
      memory: mapMemory(created),
    };
  }

  public purgeMemories(olderThanDays: number): number {
    const ms = olderThanDays * 24 * 60 * 60 * 1000;
    const threshold = Date.now() - ms;
    const count = this.repository.purgeDeletedMemories(threshold);
    
    if (count > 0) {
      this.repository.insertAuditLog({
        action: "purge_memories",
        target_type: "system",
        target_id: "database",
        summary: `Purged ${count} soft-deleted memories older than ${olderThanDays} days`,
        created_at: Date.now(),
      });
    }
    
    return count;
  }

  public shouldReflect(inactivityMinutes = 30): {
    should: boolean;
    reason: string;
    last_memory_age_minutes: number | null;
    suggestion: string;
  } {
    const recent = this.repository.listRecent(1);
    if (recent.length === 0) {
      return {
        should: true,
        reason: "No memories stored yet",
        last_memory_age_minutes: null,
        suggestion: "This session has no stored memories. Consider using self_reflect_apply to capture what matters from this conversation.",
      };
    }

    const lastMemory = recent[0];
    const ageMs = Date.now() - lastMemory.updated_at;
    const ageMinutes = Math.floor(ageMs / 60_000);

    const should = ageMinutes >= inactivityMinutes;
    return {
      should,
      reason: should
        ? `Last memory was updated ${ageMinutes} minutes ago (threshold: ${inactivityMinutes} min)`
        : `Last memory was updated ${ageMinutes} minutes ago — reflection not needed yet`,
      last_memory_age_minutes: ageMinutes,
      suggestion: should
        ? "Consider reflecting on this conversation. Use self_reflect_apply to capture what changed, what was tested, what should be remembered."
        : "Continue the conversation. Reflect when the session feels complete or a significant moment has passed.",
    };
  }

  public summarizeFacet(facet: MemoryFacet): string {
    const memories = this.repository.listByFacet(facet);
    if (memories.length === 0) {
      return `No memories found for facet "${facet}".`;
    }

    const lines = memories.map(m => {
      const titleText = m.title ? `${m.title}: ` : "";
      const dateText = new Date(m.updated_at).toISOString().split('T')[0];
      return `- [${dateText}] ${titleText}${m.content}`;
    });

    return [
      `### Summarization Context: ${facet.toUpperCase()}`,
      `Total items: ${memories.length}`,
      "",
      ...lines,
      "",
      "---",
      "Goal: Produce a single consolidated memory that captures the essential recurring themes, values, or commitments from these entries. Prefer newer or higher-salience information if conflicting.",
    ].join("\n");
  }

  private enforceFacetLimit(facet: string): void {
    const countsByFacet = this.repository.countByFacet();
    const currentCount = countsByFacet[facet] || 0;

    if (currentCount >= this.maxMemoriesPerFacet) {
      const lowest = this.repository.findLowestScoringMemory(facet);
      if (lowest) {
        this.repository.softDeleteMemory(lowest.id, Date.now());
        this.repository.insertAuditLog({
          action: "auto_archive",
          target_type: "memory",
          target_id: lowest.id,
          summary: `Auto-archived memory to stay within ${this.maxMemoriesPerFacet} limit for facet=${facet}`,
          created_at: Date.now(),
        });
      }
    }
  }
}
