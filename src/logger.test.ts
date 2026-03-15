import { describe, it, expect, vi } from "vitest";

import { createLogger } from "./logger.js";

describe("createLogger", () => {
  it("writes JSON to stderr", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const logger = createLogger("info");
    logger.info("test message", { key: "value" });

    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(output.trim());

    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("test message");
    expect(parsed.key).toBe("value");
    expect(parsed.ts).toBeDefined();

    spy.mockRestore();
  });

  it("respects log level filtering", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const logger = createLogger("warn");
    logger.debug("debug message");
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message");

    expect(spy).toHaveBeenCalledTimes(2);
    const levels = spy.mock.calls.map((call) => JSON.parse((call[0] as string).trim()).level);
    expect(levels).toEqual(["warn", "error"]);

    spy.mockRestore();
  });

  it("includes base context in all messages", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const logger = createLogger("info", { service: "test-service" });
    logger.info("hello");

    const parsed = JSON.parse((spy.mock.calls[0]![0] as string).trim());
    expect(parsed.service).toBe("test-service");

    spy.mockRestore();
  });

  it("supports all four log levels", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const logger = createLogger("debug");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(spy).toHaveBeenCalledTimes(4);
    spy.mockRestore();
  });
});
