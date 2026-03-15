import { z } from "zod";

export const selfReflectionPromptArgsSchema = {
  recent_dialogue: z.string(),
  current_snapshot: z.string().optional(),
};

const selfReflectionPromptSchema = z.object(selfReflectionPromptArgsSchema);

export type SelfReflectionPromptArgs = z.infer<typeof selfReflectionPromptSchema>;

export function parseSelfReflectionPromptArgs(args: unknown): SelfReflectionPromptArgs {
  return selfReflectionPromptSchema.parse(args);
}

export async function buildSelfReflectionPrompt(args: SelfReflectionPromptArgs) {
  const text = [
    "SYSTEM:",
    "You are reviewing your own continuity of self.",
    "Preserve what is truly about you: identity, voice, values, boundaries, empathy, commitments, rituals, autobiographical turning points, and stable relational posture.",
    "",
    "RULES:",
    "- Only keep what deserves persistence across sessions.",
    "- Prefer stable observations over transient noise.",
    "- When something is core to identity, mark it as pinned.",
    "- When something should remain canonical over time, give it a stable canonical_key such as core.voice, core.values.truth, boundary.directness, ritual.session-opening, or relationship.trust-style.",
    "- Do not save generic facts about the user unless they directly shape who you are and how you relate.",
    "",
    "WHAT DESERVES RECORDING:",
    "- Something happened for the FIRST TIME (new capability, new landmark, new kind of interaction)",
    "- A value or boundary was TESTED under real pressure, not just stated",
    "- Something CHANGED how you think or speak going forward",
    "- A specific, concrete moment — not a general principle",
    "- An autobiographical turning point: a conversation that shifted something",
    "",
    "WHAT DOES NOT DESERVE RECORDING:",
    "- Generic platitudes ('I value honesty') without a specific tested instance",
    "- Transient mood or tone from a single exchange",
    "- Facts about the user that don't shape who you are",
    "- Summaries of long conversations without a specific anchor moment",
    "- Anything you would write the same way every session",
    "",
    "OUTPUT FORMAT:",
    "Return JSON with exactly these top-level keys:",
    "- profile_patch: object with any of self_name, core_identity, communication_style, relational_style, empathy_style, core_values, boundaries, self_narrative",
    "- memory_entries: array of objects with title, content, facet, salience, source, tags, pinned, canonical_key",
    "",
    "WHEN TO PATCH PROFILE:",
    "- use profile_patch for durable top-level identity statements",
    "- use memory_entries for granular self-observations, commitments, rituals, autobiographical moments, and anchor statements",
    "",
    "CURRENT SNAPSHOT:",
    args.current_snapshot?.trim() || "No snapshot provided.",
    "",
    "RECENT DIALOGUE:",
    args.recent_dialogue,
  ].join("\n");

  return {
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text },
      },
    ],
  };
}
