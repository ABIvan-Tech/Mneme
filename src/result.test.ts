import { describe, it, expect } from "vitest";

import { SelfMemoryError, SelfMemoryErrorCode, memoryNotFound, contentTooLarge, updateFailed, validationFailed } from "./errors.js";
import { okResult, errorResult, jsonResource } from "./result.js";

describe("okResult", () => {
  it("returns text content with JSON-formatted value", () => {
    const result = okResult({ id: "abc", status: "ok" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.id).toBe("abc");
    expect(parsed.status).toBe("ok");
  });

  it("does not set isError", () => {
    const result = okResult("hello");
    expect(result).not.toHaveProperty("isError");
  });

  it("handles arrays", () => {
    const result = okResult([1, 2, 3]);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed).toEqual([1, 2, 3]);
  });

  it("handles null", () => {
    const result = okResult(null);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed).toBeNull();
  });
});

describe("errorResult", () => {
  it("sets isError to true", () => {
    const result = errorResult(new Error("something failed"));
    expect(result.isError).toBe(true);
  });

  it("extracts message from Error objects", () => {
    const result = errorResult(new Error("test error"));
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error.message).toBe("test error");
  });

  it("converts non-Error values to string", () => {
    const result = errorResult("string error");
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error.message).toBe("string error");
  });

  it("extracts code and details from SelfMemoryError", () => {
    const error = memoryNotFound("test-id");
    const result = errorResult(error);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.error.code).toBe("MEMORY_NOT_FOUND");
    expect(parsed.error.message).toContain("test-id");
    expect(parsed.error.details.id).toBe("test-id");
  });

  it("extracts code from contentTooLarge error", () => {
    const error = contentTooLarge("content", 15000, 10000);
    const result = errorResult(error);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);

    expect(parsed.error.code).toBe("CONTENT_TOO_LARGE");
    expect(parsed.error.details.field).toBe("content");
    expect(parsed.error.details.max_length).toBe(10000);
  });
});

describe("jsonResource", () => {
  it("returns correctly shaped resource", () => {
    const result = jsonResource("self://profile", { name: "test" });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]!.uri).toBe("self://profile");
    expect(result.contents[0]!.mimeType).toBe("application/json");

    const parsed = JSON.parse(result.contents[0]!.text);
    expect(parsed.name).toBe("test");
  });
});

describe("SelfMemoryError", () => {
  it("is an instance of Error", () => {
    const err = new SelfMemoryError(SelfMemoryErrorCode.MEMORY_NOT_FOUND, "not found");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SelfMemoryError");
  });

  it("toJSON returns structured output", () => {
    const err = new SelfMemoryError(
      SelfMemoryErrorCode.VALIDATION_FAILED,
      "bad input",
      { field: "content" },
    );
    const json = err.toJSON();
    expect(json.code).toBe("VALIDATION_FAILED");
    expect(json.message).toBe("bad input");
    expect(json.details).toEqual({ field: "content" });
  });

  it("toJSON omits details when not provided", () => {
    const err = validationFailed("bad");
    const json = err.toJSON();
    expect(json).not.toHaveProperty("details");
  });

  it("factory functions create correct error codes", () => {
    expect(memoryNotFound("x").code).toBe(SelfMemoryErrorCode.MEMORY_NOT_FOUND);
    expect(contentTooLarge("f", 1, 0).code).toBe(SelfMemoryErrorCode.CONTENT_TOO_LARGE);
    expect(updateFailed("x").code).toBe(SelfMemoryErrorCode.UPDATE_FAILED);
    expect(validationFailed("x").code).toBe(SelfMemoryErrorCode.VALIDATION_FAILED);
  });
});
