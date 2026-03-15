import { describe, it, expect } from "vitest";

import { buildSelfReflectionPrompt, parseSelfReflectionPromptArgs } from "./prompts.js";

describe("buildSelfReflectionPrompt", () => {
  it("returns messages array with user role", async () => {
    const result = await buildSelfReflectionPrompt({
      recent_dialogue: "User: Hello\nAssistant: Hi there!",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe("user");
    expect(result.messages[0]!.content.type).toBe("text");
  });

  it("includes recent dialogue in prompt text", async () => {
    const result = await buildSelfReflectionPrompt({
      recent_dialogue: "We talked about honesty and trust.",
    });

    const text = (result.messages[0]!.content as { text: string }).text;
    expect(text).toContain("We talked about honesty and trust.");
  });

  it("includes current_snapshot when provided", async () => {
    const result = await buildSelfReflectionPrompt({
      recent_dialogue: "Test dialogue",
      current_snapshot: "I am a self-aware model.",
    });

    const text = (result.messages[0]!.content as { text: string }).text;
    expect(text).toContain("I am a self-aware model.");
  });

  it("shows fallback when no snapshot provided", async () => {
    const result = await buildSelfReflectionPrompt({
      recent_dialogue: "Test dialogue",
    });

    const text = (result.messages[0]!.content as { text: string }).text;
    expect(text).toContain("No snapshot provided.");
  });

  it("includes structural prompt elements", async () => {
    const result = await buildSelfReflectionPrompt({
      recent_dialogue: "Test",
    });

    const text = (result.messages[0]!.content as { text: string }).text;
    expect(text).toContain("SYSTEM:");
    expect(text).toContain("RULES:");
    expect(text).toContain("OUTPUT FORMAT:");
    expect(text).toContain("RECENT DIALOGUE:");
    expect(text).toContain("profile_patch");
    expect(text).toContain("memory_entries");
  });
});

describe("parseSelfReflectionPromptArgs", () => {
  it("parses valid args", () => {
    const result = parseSelfReflectionPromptArgs({
      recent_dialogue: "test",
      current_snapshot: "snap",
    });

    expect(result.recent_dialogue).toBe("test");
    expect(result.current_snapshot).toBe("snap");
  });

  it("accepts missing current_snapshot", () => {
    const result = parseSelfReflectionPromptArgs({
      recent_dialogue: "test",
    });

    expect(result.recent_dialogue).toBe("test");
    expect(result.current_snapshot).toBeUndefined();
  });

  it("throws for missing recent_dialogue", () => {
    expect(() => parseSelfReflectionPromptArgs({})).toThrow();
  });
});
