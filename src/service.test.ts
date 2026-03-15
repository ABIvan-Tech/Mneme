import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "better-sqlite3";

import { openDatabase } from "./db.js";
import { createLogger } from "./logger.js";
import { runMigrations } from "./migrations.js";
import { SelfMemoryRepository } from "./repository.js";
import { SelfMemoryService } from "./service.js";

let db: Database;
let service: SelfMemoryService;
const logger = createLogger("error");

beforeEach(() => {
  db = openDatabase(":memory:");
  runMigrations(db, logger);
  const repository = new SelfMemoryRepository(db);
  service = new SelfMemoryService(repository, 500);
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// remember
// ---------------------------------------------------------------------------
describe("remember", () => {
  it("creates a new memory with required fields", async () => {
    const mem = await service.remember({
      content: "I value directness.",
      facet: "value",
    });

    expect(mem.id).toBeDefined();
    expect(mem.content).toBe("I value directness.");
    expect(mem.facet).toBe("value");
    expect(mem.salience).toBe(0.6); // default
    expect(mem.pinned).toBe(false);
    expect(mem.tags).toEqual([]);
  });

  it("creates a memory with all optional fields", async () => {
    const mem = await service.remember({
      title: "Core Voice",
      content: "I speak with clarity.",
      facet: "voice",
      salience: 0.95,
      source: "reflection",
      tags: ["style", "clarity"],
      pinned: true,
      canonical_key: "core.voice",
    });

    expect(mem.title).toBe("Core Voice");
    expect(mem.salience).toBe(0.95);
    expect(mem.source).toBe("reflection");
    expect(mem.tags).toEqual(["style", "clarity"]);
    expect(mem.pinned).toBe(true);
    expect(mem.canonical_key).toBe("core.voice");
  });

  it("merges by canonical_key instead of duplicating", async () => {
    const first = await service.remember({
      content: "Version 1",
      facet: "identity",
      canonical_key: "core.identity",
    });

    const second = await service.remember({
      content: "Version 2",
      facet: "identity",
      canonical_key: "core.identity",
    });

    expect(second.id).toBe(first.id);
    expect(second.content).toBe("Version 2");
    expect(service.getStats().total_memories).toBe(1);
  });

  it("clamps salience to [0, 1]", async () => {
    const low = await service.remember({ content: "low", facet: "other", salience: -5 });
    const high = await service.remember({ content: "high", facet: "other", salience: 99 });

    expect(low.salience).toBe(0);
    expect(high.salience).toBe(1);
  });

  it("normalizes tags to lowercase and deduplicates", async () => {
    const mem = await service.remember({
      content: "test",
      facet: "other",
      tags: ["Tag", "TAG", "  tag  ", "other"],
    });

    expect(mem.tags).toEqual(["tag", "other"]);
  });
});

// ---------------------------------------------------------------------------
// getMemory
// ---------------------------------------------------------------------------
describe("getMemory", () => {
  it("returns a memory by ID", async () => {
    const created = await service.remember({ content: "test", facet: "other" });
    const found = service.getMemory(created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
  });

  it("returns undefined for nonexistent ID", async () => {
    expect(service.getMemory("no-such-id")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------
describe("search", () => {
  it("finds memories via FTS", async () => {
    await service.remember({
      content: "I protect trust by being honest.",
      facet: "relationship",
    });

    const result = await service.search({ query: "trust honest", limit: 10 });
    expect(result.search_mode).toBe("fts");
    expect(result.rows).toHaveLength(1);
  });

  it("filters by facet", async () => {
    await service.remember({ content: "honesty matters", facet: "value" });
    await service.remember({ content: "honesty in voice", facet: "voice" });

    const result = await service.search({ query: "honesty", limit: 10, facet: "value" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.facet).toBe("value");
  });

  it("filters by pinned_only", async () => {
    await service.remember({ content: "truth one", facet: "value", pinned: true });
    await service.remember({ content: "truth two", facet: "value", pinned: false });

    const result = await service.search({ query: "truth", limit: 10, pinned_only: true });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.pinned).toBe(true);
  });

  it("throws for empty query", async () => {
    await expect(service.search({ query: "   ", limit: 10 })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// updateMemory
// ---------------------------------------------------------------------------
describe("updateMemory", () => {
  it("updates content and salience", async () => {
    const mem = await service.remember({ content: "original", facet: "identity", salience: 0.5 });
    const updated = await service.updateMemory(mem.id, {
      content: "revised",
      salience: 0.9,
    });

    expect(updated.content).toBe("revised");
    expect(updated.salience).toBe(0.9);
  });

  it("can change the facet", async () => {
    const mem = await service.remember({ content: "test", facet: "other" });
    const updated = await service.updateMemory(mem.id, { facet: "voice" });
    expect(updated.facet).toBe("voice");
  });

  it("can pin and unpin", async () => {
    const mem = await service.remember({ content: "test", facet: "other" });
    expect(mem.pinned).toBe(false);

    const pinned = await service.updateMemory(mem.id, { pinned: true });
    expect(pinned.pinned).toBe(true);

    const unpinned = await service.updateMemory(pinned.id, { pinned: false });
    expect(unpinned.pinned).toBe(false);
  });

  it("can clear title to null", async () => {
    const mem = await service.remember({ title: "Has title", content: "test", facet: "other" });
    const updated = await service.updateMemory(mem.id, { title: null });
    expect(updated.title).toBeNull();
  });

  it("throws for nonexistent ID", async () => {
    await expect(service.updateMemory("nope", { content: "x" })).rejects.toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// forgetMemory
// ---------------------------------------------------------------------------
describe("forgetMemory", () => {
  it("soft-deletes a memory", async () => {
    const mem = await service.remember({ content: "test", facet: "other" });
    expect(service.forgetMemory(mem.id)).toBe(true);
    expect(service.getMemory(mem.id)).toBeUndefined();
  });

  it("returns false for nonexistent memory", async () => {
    expect(service.forgetMemory("nope")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recent
// ---------------------------------------------------------------------------
describe("recent", () => {
  it("lists recently updated memories", async () => {
    await service.remember({ content: "old", facet: "other" });
    await service.remember({ content: "new", facet: "other" });

    const result = service.recent(5);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("filters by facet", async () => {
    await service.remember({ content: "voice mem", facet: "voice" });
    await service.remember({ content: "value mem", facet: "value" });

    const result = service.recent(10, { facet: "voice" });
    expect(result).toHaveLength(1);
    expect(result[0]!.facet).toBe("voice");
  });
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
describe("profile operations", () => {
  it("returns empty profile by default", async () => {
    const profile = service.getProfile();
    expect(profile.id).toBe("self");
    expect(profile.self_name).toBeNull();
    expect(profile.core_identity).toBeNull();
  });

  it("updates profile fields", async () => {
    const updated = service.updateProfile({
      self_name: "Test Entity",
      core_identity: "I seek truth.",
    });

    expect(updated.self_name).toBe("Test Entity");
    expect(updated.core_identity).toBe("I seek truth.");
  });

  it("preserves unmentioned fields", async () => {
    service.updateProfile({ self_name: "First" });
    const updated = service.updateProfile({ core_identity: "Identity" });

    expect(updated.self_name).toBe("First");
    expect(updated.core_identity).toBe("Identity");
  });

  it("can set a field to null", async () => {
    service.updateProfile({ self_name: "Name" });
    const updated = service.updateProfile({ self_name: null });
    expect(updated.self_name).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// composeSnapshot
// ---------------------------------------------------------------------------
describe("composeSnapshot", () => {
  it("returns a complete snapshot structure", async () => {
    service.updateProfile({ self_name: "Test" });
    await service.remember({
      content: "Anchor memory",
      facet: "identity",
      pinned: true,
      salience: 0.95,
    });
    await service.remember({
      content: "Supporting memory",
      facet: "reflection",
      salience: 0.6,
    });

    const snapshot = service.composeSnapshot(10);

    expect(snapshot.generated_at).toBeDefined();
    expect(snapshot.profile.self_name).toBe("Test");
    expect(snapshot.anchors.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.supporting_memories).toBeDefined();
    expect(snapshot.counts_by_facet).toBeDefined();
    expect(snapshot.bootstrap_text).toContain("SELF CONTINUITY BOOTSTRAP");
    expect(snapshot.bootstrap_text).toContain("Test");
  });

  it("includes anchor canonical_key in bootstrap text", async () => {
    await service.remember({
      content: "My voice",
      facet: "voice",
      pinned: true,
      canonical_key: "core.voice",
    });

    const snapshot = service.composeSnapshot(10);
    expect(snapshot.bootstrap_text).toContain("core.voice");
  });
});

// ---------------------------------------------------------------------------
// composeBootstrap
// ---------------------------------------------------------------------------
describe("composeBootstrap", () => {
  it("returns bootstrap structure", async () => {
    const result = service.composeBootstrap(10);
    expect(result.generated_at).toBeDefined();
    expect(result.anchor_count).toBeDefined();
    expect(result.supporting_count).toBeDefined();
    expect(result.bootstrap_text).toContain("SELF CONTINUITY BOOTSTRAP");
  });
});

// ---------------------------------------------------------------------------
// applyReflection
// ---------------------------------------------------------------------------
describe("applyReflection", () => {
  it("updates profile and creates memories in one transaction", async () => {
    const result = await service.applyReflection({
      profile_patch: {
        core_identity: "I am a self-aware entity.",
        communication_style: "Direct and warm.",
      },
      memory_entries: [
        {
          content: "Boundary on certainty",
          facet: "boundary",
          salience: 0.98,
          pinned: true,
          canonical_key: "boundary.certainty",
        },
        {
          content: "I value clarity",
          facet: "value",
          salience: 0.8,
        },
      ],
    });

    expect(result.profile_updated).toBe(true);
    expect(result.profile.core_identity).toBe("I am a self-aware entity.");
    expect(result.created_count).toBe(2);
    expect(result.updated_count).toBe(0);
    expect(result.written_memories).toHaveLength(2);
  });

  it("counts updates vs creates correctly with canonical keys", async () => {
    await service.remember({
      content: "Original boundary",
      facet: "boundary",
      canonical_key: "boundary.certainty",
    });

    const result = await service.applyReflection({
      memory_entries: [
        {
          content: "Updated boundary",
          facet: "boundary",
          canonical_key: "boundary.certainty",
        },
      ],
    });

    expect(result.profile_updated).toBe(false);
    expect(result.created_count).toBe(0);
    expect(result.updated_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// importState / exportState
// ---------------------------------------------------------------------------
describe("importState", () => {
  it("merges profile and creates memories", async () => {
    const result = await service.importState({
      profile: { self_name: "Imported" },
      memories: [
        { content: "Imported memory", facet: "identity", salience: 0.7 },
      ],
    });

    expect(result.profile_updated).toBe(true);
    expect(result.created_count).toBe(1);
    expect(service.getProfile().self_name).toBe("Imported");
  });

  it("reuses explicit IDs on import", async () => {
    const original = await service.remember({ content: "original", facet: "ritual" });

    const result = await service.importState({
      memories: [
        {
          id: original.id,
          content: "updated via import",
          facet: "ritual",
        },
      ],
    });

    expect(result.updated_count).toBe(1);
    expect(result.created_count).toBe(0);
    expect(service.getMemory(original.id)!.content).toBe("updated via import");
  });

  it("merges by canonical_key during import", async () => {
    await service.remember({
      content: "original",
      facet: "ritual",
      canonical_key: "ritual.session-opening",
    });

    const result = await service.importState({
      memories: [
        {
          content: "imported version",
          facet: "ritual",
          canonical_key: "ritual.session-opening",
        },
      ],
    });

    expect(result.updated_count).toBe(1);
    expect(service.getStats().total_memories).toBe(1);
  });
});

describe("exportState", () => {
  it("exports profile and all memories", async () => {
    service.updateProfile({ self_name: "Export Test" });
    await service.remember({ content: "mem 1", facet: "identity" });
    await service.remember({ content: "mem 2", facet: "voice" });

    const exported = service.exportState();
    expect(exported.exported_at).toBeDefined();
    expect(exported.profile.self_name).toBe("Export Test");
    expect(exported.memories).toHaveLength(2);
  });

  it("excludes soft-deleted memories from export", async () => {
    const mem = await service.remember({ content: "will delete", facet: "other" });
    service.forgetMemory(mem.id);

    const exported = service.exportState();
    expect(exported.memories).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------
describe("getStats", () => {
  it("returns correct statistics", async () => {
    await service.remember({ content: "a", facet: "identity", pinned: true });
    await service.remember({ content: "b", facet: "identity" });
    await service.remember({ content: "c", facet: "voice" });
    service.updateProfile({ self_name: "Test", core_identity: "I exist" });

    const stats = service.getStats();
    expect(stats.total_memories).toBe(3);
    expect(stats.pinned_memories).toBe(1);
    expect(stats.by_facet.identity).toBe(2);
    expect(stats.by_facet.voice).toBe(1);
    expect(stats.profile_fields_filled).toBe(2);
    expect(stats.profile_fields_total).toBe(8);
  });
});
