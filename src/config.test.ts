import { describe, it, expect } from "vitest";

import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("returns defaults when env is empty", () => {
    const config = loadConfig({});
    expect(config.sqlitePath).toMatch(/self-memory\.db$/);
    expect(config.logLevel).toBe("info");
    expect(config.snapshotLimit).toBe(12);
    expect(config.maxContentLength).toBe(10_000);
    expect(config.maxProfileFieldLength).toBe(5_000);
    expect(config.maxMemoriesPerFacet).toBe(500);
  });

  it("reads SQLITE_PATH from env", () => {
    const config = loadConfig({ SQLITE_PATH: "/tmp/test.db" });
    expect(config.sqlitePath).toBe("/tmp/test.db");
  });

  it("trims SQLITE_PATH", () => {
    const config = loadConfig({ SQLITE_PATH: "  /tmp/test.db  " });
    expect(config.sqlitePath).toBe("/tmp/test.db");
  });

  it("reads LOG_LEVEL from env", () => {
    const config = loadConfig({ LOG_LEVEL: "debug" });
    expect(config.logLevel).toBe("debug");
  });

  it("reads SELF_SNAPSHOT_LIMIT from env", () => {
    const config = loadConfig({ SELF_SNAPSHOT_LIMIT: "25" });
    expect(config.snapshotLimit).toBe(25);
  });

  it("returns default snapshotLimit for non-positive values", () => {
    expect(loadConfig({ SELF_SNAPSHOT_LIMIT: "0" }).snapshotLimit).toBe(12);
    expect(loadConfig({ SELF_SNAPSHOT_LIMIT: "-5" }).snapshotLimit).toBe(12);
  });

  it("returns default snapshotLimit for non-numeric values", () => {
    expect(loadConfig({ SELF_SNAPSHOT_LIMIT: "abc" }).snapshotLimit).toBe(12);
  });

  it("throws for invalid LOG_LEVEL", () => {
    expect(() => loadConfig({ LOG_LEVEL: "verbose" })).toThrow();
  });

  it("reads MAX_CONTENT_LENGTH from env", () => {
    const config = loadConfig({ MAX_CONTENT_LENGTH: "20000" });
    expect(config.maxContentLength).toBe(20_000);
  });

  it("reads MAX_PROFILE_FIELD_LENGTH from env", () => {
    const config = loadConfig({ MAX_PROFILE_FIELD_LENGTH: "8000" });
    expect(config.maxProfileFieldLength).toBe(8_000);
  });

  it("reads MAX_MEMORIES_PER_FACET from env", () => {
    const config = loadConfig({ MAX_MEMORIES_PER_FACET: "1000" });
    expect(config.maxMemoriesPerFacet).toBe(1_000);
  });
});
