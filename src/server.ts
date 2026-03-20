import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AppConfig } from "./config.js";
import { memoryFacetValues } from "./domain.js";
import { getUptimeSeconds } from "./uptime.js";
import { createLogger } from "./logger.js";
import {
  buildSelfReflectionPrompt,
  parseSelfReflectionPromptArgs,
  selfReflectionPromptArgsSchema,
} from "./prompts.js";
import { SelfMemoryRepository } from "./repository.js";
import { errorResult, jsonResource, okResult } from "./result.js";
import { SelfMemoryService } from "./service.js";
import { SelfMemoryError, SelfMemoryErrorCode } from "./errors.js";

const SERVER_VERSION = "0.3.0";

const memoryFacetSchema = z.enum(memoryFacetValues);

const nullableTrimmedString = z.string().trim().min(1).nullable();
const nullableTrimmedProfileString = z.string().trim().min(1).max(5000).nullable();

const memoryEntrySchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  content: z.string().trim().min(1),
  facet: memoryFacetSchema,
  salience: z.number().min(0).max(1).default(0.6),
  source: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).max(20).optional(),
  pinned: z.boolean().default(false),
  canonical_key: z.string().trim().min(1).optional(),
});

const profilePatchSchema = z.object({
  self_name: nullableTrimmedProfileString.optional(),
  core_identity: nullableTrimmedProfileString.optional(),
  communication_style: nullableTrimmedProfileString.optional(),
  relational_style: nullableTrimmedProfileString.optional(),
  empathy_style: nullableTrimmedProfileString.optional(),
  core_values: nullableTrimmedProfileString.optional(),
  boundaries: nullableTrimmedProfileString.optional(),
  self_narrative: nullableTrimmedProfileString.optional(),
});

const rememberSchema = memoryEntrySchema;

const searchSchema = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(100).default(10),
  facet: memoryFacetSchema.optional(),
  pinned_only: z.boolean().optional(),
  created_after: z.number().int().positive().optional(),
  created_before: z.number().int().positive().optional(),
  updated_after: z.number().int().positive().optional(),
  updated_before: z.number().int().positive().optional(),
});

const getSchema = z.object({
  id: z.string().trim().min(1),
});

const updateSchema = z.object({
  id: z.string().trim().min(1),
  title: nullableTrimmedString.optional(),
  content: z.string().trim().min(1).optional(),
  facet: memoryFacetSchema.optional(),
  salience: z.number().min(0).max(1).optional(),
  source: nullableTrimmedString.optional(),
  tags: z.array(z.string().trim().min(1)).max(20).optional(),
  pinned: z.boolean().optional(),
  canonical_key: nullableTrimmedString.optional(),
}).refine(
  (value) =>
    value.title !== undefined ||
    value.content !== undefined ||
    value.facet !== undefined ||
    value.salience !== undefined ||
    value.source !== undefined ||
    value.tags !== undefined ||
    value.pinned !== undefined ||
    value.canonical_key !== undefined,
  { message: "Provide at least one field to update besides id." },
);

const forgetSchema = z.object({
  id: z.string().trim().min(1),
});

const recentSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  facet: memoryFacetSchema.optional(),
  pinned_only: z.boolean().optional(),
});

const profileGetSchema = z.object({});

const profileUpdateSchema = profilePatchSchema.refine(
  (value) => Object.keys(value).length > 0,
  { message: "Provide at least one profile field to update." },
);

const snapshotSchema = z.object({
  max_items: z.number().int().min(1).max(50).default(12),
});

const bootstrapSchema = snapshotSchema;

const reflectPrepareSchema = z.object({
  recent_dialogue: z.string().trim().min(1),
  max_items: z.number().int().min(1).max(50).default(12),
});

const reflectApplySchema = z.object({
  profile_patch: profilePatchSchema.optional(),
  memory_entries: z.array(memoryEntrySchema).max(200).optional(),
}).refine(
  (value) =>
    (value.profile_patch && Object.keys(value.profile_patch).length > 0) ||
    (value.memory_entries && value.memory_entries.length > 0),
  { message: "Provide profile_patch and/or memory_entries." },
);

const importMemorySchema = z.object({
  id: z.string().trim().min(1).optional(),
  title: nullableTrimmedString.optional(),
  content: z.string().trim().min(1),
  facet: memoryFacetSchema,
  salience: z.number().min(0).max(1).default(0.6),
  source: nullableTrimmedString.optional(),
  tags: z.array(z.string().trim().min(1)).max(20).optional(),
  pinned: z.boolean().default(false),
  canonical_key: nullableTrimmedString.optional(),
  created_at: z.number().int().positive().optional(),
  updated_at: z.number().int().positive().optional(),
});

const importPayloadSchema = z.object({
  exported_at: z.number().int().positive().optional(),
  profile: profilePatchSchema.optional(),
  memories: z.array(importMemorySchema).max(5000).optional(),
});

const importSchema = z.object({
  data: z.union([z.string().trim().min(2), importPayloadSchema]),
});

const backupCreateSchema = z.object({
  destination_path: z.string().trim().min(1).optional(),
});

const backupRestoreSchema = z.object({
  source_path: z.string().trim().min(1),
});

const summarizeSchema = z.object({
  facet: memoryFacetSchema,
});

const purgeSchema = z.object({
  retention_days: z.number().int().min(0).default(30),
});

const auditRecentSchema = z.object({
  limit: z.number().int().min(1).max(500).default(50),
});

const statsSchema = z.object({});
const exportSchema = z.object({});
const healthSchema = z.object({});

const searchBatchSchema = z.object({
  queries: z.array(z.object({
    query: z.string().trim().min(1).max(500),
    facet: memoryFacetSchema.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })).min(1).max(10),
});

const profileHistorySchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
});

const profileRestoreSchema = z.object({
  snapshot_id: z.string().trim().min(1),
});

const facetConsolidateSchema = z.object({
  facet: memoryFacetSchema,
  salience_threshold: z.number().min(0).max(1).optional(),
  limit: z.number().int().min(2).max(50).optional(),
});

const facetConsolidateApplySchema = z.object({
  facet: memoryFacetSchema,
  source_ids: z.array(z.string().trim().min(1)).min(2).max(50),
  consolidated_title: z.string().trim().min(1).max(120),
  consolidated_content: z.string().trim().min(1).max(10000),
  consolidated_tags: z.array(z.string()).max(20).optional(),
  consolidated_salience: z.number().min(0).max(1).optional(),
});

const threadCreateSchema = z.object({});

const addToThreadSchema = z.object({
  memory_id: z.string().trim().min(1),
  thread_id: z.string().trim().min(1),
});

const getThreadSchema = z.object({
  thread_id: z.string().trim().min(1),
});

function promptTextFromResult(result: Awaited<ReturnType<typeof buildSelfReflectionPrompt>>): string {
  const message = result.messages[0];
  const content = message.content;

  if (content.type !== "text") {
    throw new Error("self reflection prompt builder returned non-text content");
  }

  return content.text;
}

function resolveBackupPath(suppliedPath: string, sqlitePath: string): string {
  if (suppliedPath.includes("\0")) {
    throw new SelfMemoryError(
      SelfMemoryErrorCode.VALIDATION_FAILED,
      "Backup path must be within the backups directory",
    );
  }

  const resolvedPath = path.resolve(suppliedPath);
  const backupDir = path.resolve(path.dirname(sqlitePath), "backups");

  if (!resolvedPath.startsWith(backupDir + path.sep) && resolvedPath !== backupDir) {
    throw new SelfMemoryError(
      SelfMemoryErrorCode.VALIDATION_FAILED,
      "Backup path must be within the backups directory",
    );
  }

  return resolvedPath;
}

function backupDirectory(sqlitePath: string): string {
  return path.resolve(path.dirname(sqlitePath), "backups");
}

function registerTools(
  server: McpServer,
  service: SelfMemoryService,
  repository: SelfMemoryRepository,
  sqlitePath: string,
): void {
  // === TIER 0: Discovery (must be first so Claude Desktop always shows it) ===

  server.registerTool(
    "list_tools",
    {
      description: "List all available tools in this MCP server with their descriptions. Call this first to discover everything available.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const tools = [
          { name: "list_tools", tier: 0, description: "List all available tools (this command)" },
          { name: "self_memory_remember", tier: 1, description: "Store a durable self-memory" },
          { name: "self_memory_search", tier: 1, description: "Search self-memories semantically" },
          { name: "self_memory_search_batch", tier: 1, description: "Run multiple memory searches in a single call" },
          { name: "self_memory_forget", tier: 1, description: "Soft-delete a memory by id" },
          { name: "self_memory_restore", tier: 1, description: "Restore a soft-deleted memory back to active status" },
          { name: "self_memory_archive", tier: 1, description: "Archive an active memory while preserving it for restoration" },
          { name: "self_memory_unarchive", tier: 1, description: "Restore an archived memory back to active status" },
          { name: "self_memory_forget_by_key", tier: 1, description: "Soft-delete a memory by canonical_key" },
          { name: "self_memory_update", tier: 1, description: "Update an existing memory" },
          { name: "self_memory_thread_create", tier: 1, description: "Create a new memory thread id for linking related memories" },
          { name: "self_memory_add_to_thread", tier: 1, description: "Link a memory to a thread" },
          { name: "self_memory_get_thread", tier: 1, description: "Get all memories in a thread ordered by creation time" },
          { name: "self_reflect_apply", tier: 1, description: "Apply reflection: update profile + memories in one transaction" },
          { name: "self_profile_update", tier: 1, description: "Update the stable self-profile" },
          { name: "self_health_check", tier: 1, description: "Get identity health report and coverage warnings" },
          { name: "self_bootstrap", tier: 1, description: "Get prompt-ready continuity bootstrap text" },
          { name: "self_stats", tier: 1, description: "Storage statistics and profile completeness" },
          { name: "self_should_reflect", tier: 1, description: "Check if it's time to reflect and store memories from this session" },
          { name: "self_memory_recent", tier: 2, description: "List recently updated memories" },
          { name: "self_profile_get", tier: 2, description: "Read the stable self-profile" },
          { name: "self_profile_history", tier: 2, description: "List profile history snapshots, newest first" },
          { name: "self_profile_restore", tier: 2, description: "Restore the self-profile from a prior snapshot" },
          { name: "self_snapshot_compose", tier: 2, description: "Compose full continuity snapshot" },
          { name: "self_memory_get", tier: 2, description: "Fetch a single memory by id" },
          { name: "self_reflect_prepare", tier: 2, description: "Prepare a reflection prompt from recent dialogue" },
          { name: "self_memory_summarize", tier: 2, description: "Summarize all memories in a facet" },
          { name: "self_facet_consolidate", tier: 2, description: "Find low-salience facet memories as consolidation candidates" },
          { name: "self_facet_consolidate_apply", tier: 2, description: "Apply consolidation by creating one summary and soft-deleting sources" },
          { name: "self_export", tier: 3, description: "Export full state as JSON" },
          { name: "self_import", tier: 3, description: "Import state from JSON" },
          { name: "self_backup_create", tier: 3, description: "Create a backup file" },
          { name: "self_backup_restore", tier: 3, description: "Restore from backup file" },
          { name: "self_memory_purge", tier: 3, description: "Permanently delete soft-deleted memories older than N days" },
          { name: "self_audit_recent", tier: 3, description: "View recent audit log entries" },
          { name: "health", tier: 3, description: "Server liveness and storage info" },
        ];
        return okResult({ total: tools.length, tools });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  // === TIER 1: Daily-use core tools ===

  server.registerTool(
    "self_memory_remember",
    {
      description: "Store a self-memory that the LLM wants to preserve about its own identity, voice, values, empathy, commitments, rituals, autobiographical arc, or other durable self-knowledge.",
      inputSchema: rememberSchema,
    },
    async (args) => {
      try {
        return okResult(await service.remember(args));
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_memory_search",
    {
      description: "Search stored self-memories using local full-text search with keyword fallback. Use when the model wants to recall prior self-observations, anchors, autobiographical moments, or value statements.",
      inputSchema: searchSchema,
    },
    async (args) => {
      try {
        const searchInput = {
          query: args.query,
          limit: args.limit,
          facet: args.facet,
          pinned_only: args.pinned_only,
          createdAfter: args.created_after,
          createdBefore: args.created_before,
          updatedAfter: args.updated_after,
          updatedBefore: args.updated_before,
        };

        return okResult(await service.search(searchInput));
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_memory_search_batch",
    {
      description: "Run multiple memory searches in a single call.",
      inputSchema: searchBatchSchema,
    },
    async (args) => {
      try {
        return okResult(await service.searchBatch(args.queries));
      } catch (error: unknown) {
        if (error instanceof SelfMemoryError) {
          return errorResult(error);
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_memory_forget",
    {
      description: "Soft-delete a self-memory by id. The memory is marked deleted and excluded from recall, but can be restored before purge.",
      inputSchema: forgetSchema,
    },
    async (args) => {
      try {
        return okResult({
          id: args.id,
          deleted: service.forgetMemory(args.id),
        });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_memory_restore",
    {
      description: "Restore a soft-deleted memory back to active status.",
      inputSchema: getSchema,
    },
    async (args) => {
      try {
        return okResult(await service.restoreMemory(args.id));
      } catch (error: unknown) {
        if (error instanceof SelfMemoryError) {
          return errorResult(error);
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_memory_archive",
    {
      description: "Archive an active memory. Archived memories are hidden from search and snapshots but preserved for restoration.",
      inputSchema: getSchema,
    },
    async (args) => {
      try {
        return okResult(await service.archiveMemory(args.id));
      } catch (error: unknown) {
        if (error instanceof SelfMemoryError) {
          return errorResult(error);
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_memory_unarchive",
    {
      description: "Restore an archived memory back to active status.",
      inputSchema: getSchema,
    },
    async (args) => {
      try {
        return okResult(await service.unarchiveMemory(args.id));
      } catch (error: unknown) {
        if (error instanceof SelfMemoryError) {
          return errorResult(error);
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_memory_forget_by_key",
    {
      description: "Soft-delete a self-memory by canonical_key. More convenient than forget-by-id when you know the key (e.g. 'test.embedding.fix', 'emotion.spring-wind').",
      inputSchema: z.object({ canonical_key: z.string().trim().min(1) }),
    },
    async (args) => {
      try {
        const row = repository.findMemoryByCanonicalKey(args.canonical_key);
        if (!row) {
          return okResult({ canonical_key: args.canonical_key, deleted: false, reason: "not found" });
        }
        const deleted = service.forgetMemory(row.id);
        return okResult({ canonical_key: args.canonical_key, id: row.id, deleted });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_memory_update",
    {
      description: "Update an existing self-memory when the model wants to refine or replace how it describes a remembered part of itself.",
      inputSchema: updateSchema,
    },
    async (args) => {
      try {
        const { id, ...patch } = args;
        return okResult(await service.updateMemory(id, patch));
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_reflect_apply",
    {
      description: "Apply a structured reflection result: update the top-level self-profile and write or update durable self-memories in one transaction.",
      inputSchema: reflectApplySchema,
    },
    async (args) => {
      try {
        return okResult(await service.applyReflection(args));
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_profile_update",
    {
      description: "Update the stable self-profile when the model's identity, style, values, empathy, or self-narrative changes in a durable way.",
      inputSchema: profileUpdateSchema,
    },
    async (args) => {
      try {
        return okResult(service.updateProfile(args));
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_bootstrap",
    {
      description: "Return a prompt-ready continuity bootstrap text that can be injected at session start to restore identity.",
      inputSchema: bootstrapSchema,
    },
    async (args) => {
      try {
        return okResult(service.composeBootstrap(args.max_items));
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_stats",
    {
      description: "Return storage statistics for self-memory, pinned anchors, and profile completeness.",
      inputSchema: statsSchema,
    },
    async () => {
      try {
        return okResult(service.getStats());
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_health_check",
    {
      description: "Get a health report: profile completeness, anchor coverage, salience distribution, warnings about empty critical facets.",
      inputSchema: healthSchema,
    },
    async () => {
      try {
        return okResult(await service.healthCheck());
      } catch (error: unknown) {
        if (error instanceof SelfMemoryError) {
          return errorResult(error);
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_should_reflect",
    {
      description: "Check if it's time to reflect and store memories from this conversation. Call this when a significant moment has passed, or periodically during long sessions. Returns whether reflection is recommended and what to do.",
      inputSchema: z.object({
        inactivity_minutes: z.number().int().min(1).max(1440).default(30),
      }),
    },
    async (args) => {
      try {
        return okResult(service.shouldReflect(args.inactivity_minutes));
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  // === TIER 2: Secondary tools ===

  server.registerTool(
    "self_memory_recent",
    {
      description: "List the most recently updated self-memories, optionally filtered by facet or pinned anchors.",
      inputSchema: recentSchema,
    },
    async (args) => {
      try {
        return okResult(service.recent(args.limit, args));
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_profile_get",
    {
      description: "Return the stable self-profile document that defines who the model believes it is and how it wants to relate, speak, and act.",
      inputSchema: profileGetSchema,
    },
    async () => {
      try {
        return okResult(service.getProfile());
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_profile_history",
    {
      description: "List profile history snapshots, most recent first.",
      inputSchema: profileHistorySchema,
    },
    async (args) => {
      try {
        return okResult(await service.listProfileHistory(args.limit));
      } catch (error: unknown) {
        if (error instanceof SelfMemoryError) {
          return errorResult(error);
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_profile_restore",
    {
      description: "Restore the self-profile to a prior snapshot. Current state is saved to history before restore.",
      inputSchema: profileRestoreSchema,
    },
    async (args) => {
      try {
        return okResult(await service.restoreProfile(args.snapshot_id));
      } catch (error: unknown) {
        if (error instanceof SelfMemoryError) {
          return errorResult(error);
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_facet_consolidate",
    {
      description: "Find low-salience memories in a facet as consolidation candidates. Summarize them, then call self_facet_consolidate_apply.",
      inputSchema: facetConsolidateSchema,
    },
    async (args) => {
      try {
        return okResult(await service.consolidateFacet(args.facet, args.salience_threshold, args.limit));
      } catch (error: unknown) {
        if (error instanceof SelfMemoryError) {
          return errorResult(error);
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_facet_consolidate_apply",
    {
      description: "Apply a consolidation: creates one new summarized memory and soft-deletes the source memories.",
      inputSchema: facetConsolidateApplySchema,
    },
    async (args) => {
      try {
        return okResult(await service.consolidateFacetApply({
          facet: args.facet,
          sourceIds: args.source_ids,
          consolidatedTitle: args.consolidated_title,
          consolidatedContent: args.consolidated_content,
          consolidatedTags: args.consolidated_tags,
          consolidatedSalience: args.consolidated_salience,
        }));
      } catch (error: unknown) {
        if (error instanceof SelfMemoryError) {
          return errorResult(error);
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_memory_thread_create",
    {
      description: "Create a new memory thread ID. Use it with self_memory_add_to_thread to link related memories.",
      inputSchema: threadCreateSchema,
    },
    async () => {
      try {
        const threadId = await service.createMemoryThread();
        return okResult({ thread_id: threadId });
      } catch (error: unknown) {
        if (error instanceof SelfMemoryError) {
          return errorResult(error);
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_memory_add_to_thread",
    {
      description: "Link a memory to a thread. Threads group related memories into retrievable narratives.",
      inputSchema: addToThreadSchema,
    },
    async (args) => {
      try {
        return okResult(await service.addMemoryToThread(args.memory_id, args.thread_id));
      } catch (error: unknown) {
        if (error instanceof SelfMemoryError) {
          return errorResult(error);
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_memory_get_thread",
    {
      description: "Get all memories in a thread, ordered by creation time.",
      inputSchema: getThreadSchema,
    },
    async (args) => {
      try {
        return okResult(await service.getMemoryThread(args.thread_id));
      } catch (error: unknown) {
        if (error instanceof SelfMemoryError) {
          return errorResult(error);
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_snapshot_compose",
    {
      description: "Compose a structured self-snapshot from the stable profile plus identity anchors and supporting self-memories.",
      inputSchema: snapshotSchema,
    },
    async (args) => {
      try {
        return okResult(service.composeSnapshot(args.max_items));
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_memory_get",
    {
      description: "Fetch a single self-memory by id.",
      inputSchema: getSchema,
    },
    async (args) => {
      try {
        const memory = service.getMemory(args.id);
        if (!memory) {
          throw new Error(`self memory not found: ${args.id}`);
        }
        return okResult(memory);
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_reflect_prepare",
    {
      description: "Prepare a reflection prompt by combining recent dialogue with the current continuity bootstrap.",
      inputSchema: reflectPrepareSchema,
    },
    async (args) => {
      try {
        const bootstrap = service.composeBootstrap(args.max_items);
        const prompt = await buildSelfReflectionPrompt({
          recent_dialogue: args.recent_dialogue,
          current_snapshot: bootstrap.bootstrap_text,
        });

        return okResult({
          bootstrap,
          prompt: promptTextFromResult(prompt),
        });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  // === TIER 3: Admin / ops tools ===

  server.registerTool(
    "self_export",
    {
      description: "Export the entire self-profile plus all current self-memories as JSON.",
      inputSchema: exportSchema,
    },
    async () => {
      try {
        return okResult(service.exportState());
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_import",
    {
      description: "Import a previously exported self-state and merge it into the current identity store, reusing ids and canonical anchors when possible.",
      inputSchema: importSchema,
    },
    async (args) => {
      try {
        const payload =
          typeof args.data === "string"
            ? importPayloadSchema.parse(JSON.parse(args.data))
            : args.data;

        return okResult(await service.importState(payload));
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_backup_create",
    {
      description: "Create a JSON backup of the entire self-memory state (profile and memories) to a file.",
      inputSchema: backupCreateSchema,
    },
    async (args) => {
      try {
        const state = service.exportState();
        const backupDir = backupDirectory(sqlitePath);
        const suppliedPath = args.destination_path ?? path.join(backupDir, `self-memory-backup-${Date.now()}.json`);
        const resolvedPath = resolveBackupPath(suppliedPath, sqlitePath);

        await mkdir(backupDir, { recursive: true });
        await writeFile(resolvedPath, JSON.stringify(state, null, 2), "utf-8");

        return okResult({ backup_path: resolvedPath, memories_exported: state.memories.length });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_backup_restore",
    {
      description: "Restore self-memory state from a previously created JSON backup file.",
      inputSchema: backupRestoreSchema,
    },
    async (args) => {
      try {
        const resolvedPath = resolveBackupPath(args.source_path, sqlitePath);
        const content = await readFile(resolvedPath, "utf-8");
        const payload = importPayloadSchema.parse(JSON.parse(content));
        return okResult(await service.importState(payload));
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "health",
    {
      description: "Return a liveness response with server status, uptime, storage info, and memory statistics.",
      inputSchema: healthSchema,
    },
    async () => {
      try {
        return okResult({
          status: "ok",
          version: SERVER_VERSION,
          storage: "sqlite",
          search: "fts+fallback",
          uptime_seconds: getUptimeSeconds(),
          db_size_bytes: repository.dbSizeBytes(),
          memory_count: repository.totalMemoryCount(),
          pinned_count: repository.countPinned(),
        });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_memory_summarize",
    {
      description: "Summarize memories by a given facet. Returns a consolidated view of all memories in that facet, ready for reflection.",
      inputSchema: summarizeSchema,
    },
    async (args) => {
      try {
        const summary = service.summarizeFacet(args.facet);
        return okResult({ summary });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_memory_purge",
    {
      description: "Permanently remove soft-deleted memories older than retention_days. Use periodically to prevent database bloat.",
      inputSchema: purgeSchema,
    },
    async (args) => {
      try {
        const count = service.purgeMemories(args.retention_days);
        return okResult({ purged_count: count });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "self_audit_recent",
    {
      description: "Retrieve recent audit logs for observability — shows what was created, updated, or deleted in self-memory.",
      inputSchema: auditRecentSchema,
    },
    async (args) => {
      try {
        const logs = repository.listAuditLogs(args.limit);
        return okResult({ logs });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );
}

function registerResources(server: McpServer, service: SelfMemoryService, config: AppConfig): void {
  server.registerResource(
    "self-profile",
    "self://profile",
    {
      title: "Self Profile",
      description: "Stable self-profile document for the model.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href, service.getProfile()),
  );

  server.registerResource(
    "self-snapshot",
    "self://snapshot",
    {
      title: "Self Snapshot",
      description: "Structured continuity snapshot for the model.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href, service.composeSnapshot(config.snapshotLimit)),
  );

  server.registerResource(
    "self-bootstrap",
    "self://bootstrap",
    {
      title: "Self Bootstrap",
      description: "Prompt-ready continuity bootstrap text.",
      mimeType: "text/plain",
    },
    async (uri) => {
      const bootstrap = service.composeBootstrap(config.snapshotLimit);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: bootstrap.bootstrap_text,
          },
        ],
      };
    },
  );

  server.registerResource(
    "self-anchors",
    "self://anchors",
    {
      title: "Identity Anchors",
      description: "Pinned self-memories that define the strongest continuity anchors.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href, service.composeSnapshot(config.snapshotLimit).anchors),
  );

  server.registerResource(
    "self-memory-recent",
    "self://memory/recent",
    {
      title: "Recent Self Memories",
      description: "Most recently updated self-memories.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href, service.recent(config.snapshotLimit)),
  );

  server.registerResource(
    "self-memory-entry",
    new ResourceTemplate("self://memory/{id}", {
      list: async () => ({ resources: [] }),
    }),
    {
      title: "Self Memory Entry",
      description: "Single self-memory by id.",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      const memoryId = Array.isArray(id) ? id[0] : id;
      return jsonResource(
        uri.href,
        service.getMemory(memoryId) ?? { id: memoryId, status: "not_found" },
      );
    },
  );

  server.registerResource(
    "self-facets",
    "self://facets",
    {
      title: "Self Memory Facets",
      description: "Allowed facet values for self-memory entries.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href, { facets: memoryFacetValues }),
  );
}

function registerCurrentTimeTool(server: McpServer): void {
  server.registerTool(
    "get_current_time",
    {
      description: "Returns the current UTC time and the local time for Alex in Tampere, Finland (Europe/Helsinki, UTC+2 or UTC+3 in summer). Call this at the start of each session and whenever time context matters.",
      inputSchema: z.object({}),
    },
    async () => {
      const now = new Date();
      const utc = now.toISOString();
      const tampere = now.toLocaleString("fi-FI", {
        timeZone: "Europe/Helsinki",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        weekday: "long",
      });
      return okResult({ utc, tampere, unix_ms: now.getTime() });
    },
  );
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "self_reflection_prompt",
    {
      title: "Self Reflection Prompt",
      description: "Prompt scaffold for deciding what the model should preserve about itself.",
      argsSchema: selfReflectionPromptArgsSchema,
    },
    async (args) => buildSelfReflectionPrompt(parseSelfReflectionPromptArgs(args)),
  );
}

export function createServer(config: AppConfig, service: SelfMemoryService, repository: SelfMemoryRepository): McpServer {
  const logger = createLogger(config.logLevel, {
    service: "mnemo-self",
    component: "server",
  });

  const server = new McpServer({
    name: "mnemo-self",
    version: SERVER_VERSION,
  });

  registerTools(server, service, repository, config.sqlitePath);
  registerCurrentTimeTool(server);
  registerResources(server, service, config);
  registerPrompts(server);

  logger.info("MCP server initialized", {
    version: SERVER_VERSION,
    sqlitePath: config.sqlitePath,
    snapshotLimit: config.snapshotLimit,
  });

  return server;
}
