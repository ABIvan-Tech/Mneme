import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "better-sqlite3";

import { openDatabase } from "./db.js";
import { createLogger } from "./logger.js";
import { runMigrations } from "./migrations.js";
import { SelfMemoryRepository } from "./repository.js";

let db: Database;
let repo: SelfMemoryRepository;
const logger = createLogger("error");

beforeEach(() => {
  db = openDatabase(":memory:");
  runMigrations(db, logger);
  repo = new SelfMemoryRepository(db);
});

afterEach(() => {
  db.close();
});

function makeMemory(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: `mem-${Math.random().toString(36).slice(2, 10)}`,
    title: "Test Memory",
    content: "Test content for a self-memory entry.",
    facet: "identity" as const,
    salience: 0.7,
    source: null,
    tags: "[]",
    pinned: 0,
    canonical_key: null,
    embedding: null,
    access_count: 0,
    last_accessed_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("createMemory + findMemoryById", () => {
  it("round-trips a memory", () => {
    const input = makeMemory({ id: "test-1" });
    const created = repo.createMemory(input);

    expect(created.id).toBe("test-1");
    expect(created.content).toBe(input.content);
    expect(created.facet).toBe("identity");

    const found = repo.findMemoryById("test-1");
    expect(found).toBeDefined();
    expect(found!.id).toBe("test-1");
  });

  it("returns undefined for nonexistent id", () => {
    expect(repo.findMemoryById("no-such-id")).toBeUndefined();
  });
});

describe("findMemoryByCanonicalKey", () => {
  it("finds a memory by canonical key", () => {
    repo.createMemory(makeMemory({ canonical_key: "core.voice" }));
    const found = repo.findMemoryByCanonicalKey("core.voice");
    expect(found).toBeDefined();
    expect(found!.canonical_key).toBe("core.voice");
  });

  it("returns undefined for unknown canonical key", () => {
    expect(repo.findMemoryByCanonicalKey("no.such.key")).toBeUndefined();
  });

  it("ignores soft-deleted memories", () => {
    const mem = repo.createMemory(makeMemory({ canonical_key: "core.test" }));
    repo.softDeleteMemory(mem.id, Date.now());
    expect(repo.findMemoryByCanonicalKey("core.test")).toBeUndefined();
  });
});

describe("listRecent", () => {
  it("returns memories ordered by updated_at DESC", () => {
    repo.createMemory(makeMemory({ id: "old", updated_at: 1000 }));
    repo.createMemory(makeMemory({ id: "new", updated_at: 2000 }));

    const result = repo.listRecent(10);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("new");
    expect(result[1]!.id).toBe("old");
  });

  it("filters by facet", () => {
    repo.createMemory(makeMemory({ facet: "voice" }));
    repo.createMemory(makeMemory({ facet: "value" }));

    expect(repo.listRecent(10, { facet: "voice" })).toHaveLength(1);
  });

  it("filters by pinned only", () => {
    repo.createMemory(makeMemory({ pinned: 1 }));
    repo.createMemory(makeMemory({ pinned: 0 }));

    expect(repo.listRecent(10, { pinnedOnly: true })).toHaveLength(1);
  });

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      repo.createMemory(makeMemory());
    }
    expect(repo.listRecent(3)).toHaveLength(3);
  });

  it("excludes soft-deleted memories", () => {
    const mem = repo.createMemory(makeMemory());
    repo.softDeleteMemory(mem.id, Date.now());
    expect(repo.listRecent(10)).toHaveLength(0);
  });
});

describe("listAnchors", () => {
  it("returns only pinned memories ordered by salience DESC", () => {
    repo.createMemory(makeMemory({ pinned: 1, salience: 0.5 }));
    repo.createMemory(makeMemory({ pinned: 1, salience: 0.9 }));
    repo.createMemory(makeMemory({ pinned: 0, salience: 1.0 }));

    const anchors = repo.listAnchors(10);
    expect(anchors).toHaveLength(2);
    expect(anchors[0]!.salience).toBe(0.9);
    expect(anchors[1]!.salience).toBe(0.5);
  });
});

describe("listSnapshotCandidates", () => {
  it("excludes specified IDs", () => {
    const a = repo.createMemory(makeMemory({ id: "include-me" }));
    repo.createMemory(makeMemory({ id: "exclude-me" }));

    const candidates = repo.listSnapshotCandidates(10, ["exclude-me"]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.id).toBe(a.id);
  });

  it("orders by pinned DESC, salience DESC", () => {
    repo.createMemory(makeMemory({ id: "low", pinned: 0, salience: 0.3 }));
    repo.createMemory(makeMemory({ id: "high", pinned: 0, salience: 0.9 }));
    repo.createMemory(makeMemory({ id: "pinned", pinned: 1, salience: 0.5 }));

    const candidates = repo.listSnapshotCandidates(10);
    expect(candidates[0]!.id).toBe("pinned");
    expect(candidates[1]!.id).toBe("high");
    expect(candidates[2]!.id).toBe("low");
  });
});

describe("searchMemories", () => {
  it("finds memories by FTS", () => {
    repo.createMemory(makeMemory({ content: "I value honesty and directness above all." }));
    repo.createMemory(makeMemory({ content: "I enjoy rainy weather." }));

    const result = repo.searchMemories("honesty directness", { limit: 10 });
    expect(result.mode).toBe("fts");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.content).toContain("honesty");
  });

  it("falls back to LIKE when FTS returns no results", () => {
    repo.createMemory(makeMemory({ content: "Unique_phrase_xyz123 in this memory." }));

    const result = repo.searchMemories("Unique_phrase_xyz123", { limit: 10 });
    expect(result.rows).toHaveLength(1);
  });

  it("filters by facet in FTS mode", () => {
    repo.createMemory(makeMemory({ content: "honesty matters", facet: "value" }));
    repo.createMemory(makeMemory({ content: "honesty in voice", facet: "voice" }));

    const result = repo.searchMemories("honesty", { limit: 10, facet: "value" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.facet).toBe("value");
  });

  it("filters by pinned_only", () => {
    repo.createMemory(makeMemory({ content: "truth telling", pinned: 1 }));
    repo.createMemory(makeMemory({ content: "truth seeking", pinned: 0 }));

    const result = repo.searchMemories("truth", { limit: 10, pinnedOnly: true });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.pinned).toBe(1);
  });
});

describe("updateMemory", () => {
  it("updates specified fields", () => {
    const mem = repo.createMemory(makeMemory({ id: "upd-1", salience: 0.5 }));
    const updated = repo.updateMemory("upd-1", {
      salience: 0.9,
      content: "Updated content",
      updated_at: Date.now(),
    });

    expect(updated).toBeDefined();
    expect(updated!.salience).toBe(0.9);
    expect(updated!.content).toBe("Updated content");
    expect(updated!.title).toBe(mem.title); // unchanged
  });

  it("can set title to null", () => {
    repo.createMemory(makeMemory({ id: "null-title", title: "Has title" }));
    const updated = repo.updateMemory("null-title", {
      title: null,
      updated_at: Date.now(),
    });

    expect(updated!.title).toBeNull();
  });
});

describe("softDeleteMemory", () => {
  it("marks memory as deleted", () => {
    repo.createMemory(makeMemory({ id: "del-1" }));
    const changes = repo.softDeleteMemory("del-1", Date.now());
    expect(changes).toBe(1);
    expect(repo.findMemoryById("del-1")).toBeUndefined();
  });

  it("returns 0 for already deleted memory", () => {
    repo.createMemory(makeMemory({ id: "del-2" }));
    repo.softDeleteMemory("del-2", Date.now());
    expect(repo.softDeleteMemory("del-2", Date.now())).toBe(0);
  });

  it("returns 0 for nonexistent memory", () => {
    expect(repo.softDeleteMemory("no-such-id", Date.now())).toBe(0);
  });
});

describe("Profile operations", () => {
  it("getProfile returns the singleton profile", () => {
    const profile = repo.getProfile();
    expect(profile.id).toBe("self");
    expect(profile.self_name).toBeNull();
  });

  it("saveProfile upserts profile fields", () => {
    const profile = repo.getProfile();
    profile.self_name = "Test Name";
    profile.core_identity = "I am a test entity.";
    profile.updated_at = Date.now();

    const saved = repo.saveProfile(profile);
    expect(saved.self_name).toBe("Test Name");
    expect(saved.core_identity).toBe("I am a test entity.");
  });
});

describe("countByFacet", () => {
  it("returns counts grouped by facet", () => {
    repo.createMemory(makeMemory({ facet: "identity" }));
    repo.createMemory(makeMemory({ facet: "identity" }));
    repo.createMemory(makeMemory({ facet: "voice" }));

    const counts = repo.countByFacet();
    expect(counts.identity).toBe(2);
    expect(counts.voice).toBe(1);
  });

  it("excludes soft-deleted memories", () => {
    const mem = repo.createMemory(makeMemory({ facet: "identity" }));
    repo.softDeleteMemory(mem.id, Date.now());

    const counts = repo.countByFacet();
    expect(counts.identity ?? 0).toBe(0);
  });
});

describe("countPinned", () => {
  it("counts only pinned non-deleted memories", () => {
    repo.createMemory(makeMemory({ pinned: 1 }));
    repo.createMemory(makeMemory({ pinned: 1 }));
    repo.createMemory(makeMemory({ pinned: 0 }));

    expect(repo.countPinned()).toBe(2);
  });
});

describe("exportMemories", () => {
  it("exports all non-deleted memories", () => {
    repo.createMemory(makeMemory({ id: "exp-1" }));
    repo.createMemory(makeMemory({ id: "exp-2" }));
    const del = repo.createMemory(makeMemory({ id: "exp-3" }));
    repo.softDeleteMemory(del.id, Date.now());

    const exported = repo.exportMemories();
    expect(exported).toHaveLength(2);
  });
});

describe("transaction", () => {
  it("commits on success", () => {
    repo.transaction(() => {
      repo.createMemory(makeMemory({ id: "tx-1" }));
      repo.createMemory(makeMemory({ id: "tx-2" }));
    });

    expect(repo.findMemoryById("tx-1")).toBeDefined();
    expect(repo.findMemoryById("tx-2")).toBeDefined();
  });

  it("rolls back on error", () => {
    try {
      repo.transaction(() => {
        repo.createMemory(makeMemory({ id: "tx-fail" }));
        throw new Error("rollback");
      });
    } catch {
      // expected
    }

    expect(repo.findMemoryById("tx-fail")).toBeUndefined();
  });
});
