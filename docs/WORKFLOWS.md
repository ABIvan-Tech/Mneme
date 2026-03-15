# Workflows

## 1. Session Start Workflow

Goal:

Restore continuity of self before free-form conversation begins.

Recommended sequence:

1. Read `self://bootstrap`
2. Optionally read `self://profile`
3. If needed, inspect `self://anchors`
4. Search a narrow self-topic with `self_memory_search` (uses Hybrid Semantic Search)

Use this when you want the model to begin from who it already is, rather than reconstructing identity from scratch.

## 2. Direct Authoring Workflow

Goal:

Write durable self-knowledge explicitly.

Use `self_memory_remember` when:

- a new self-observation emerges
- a new ritual forms
- an autobiographical turning point matters
- a commitment becomes durable

Use `self_profile_update` when:

- the change belongs in the top-level self-model

Use `pinned: true` when:

- the memory is an identity anchor

Use `canonical_key` when:

- the same fact should be revised in place later

## 3. Reflection Workflow

Goal:

Turn meaningful dialogue into durable identity updates.

Recommended sequence:

1. Call `self_reflect_prepare`
2. Pass the returned prompt to an LLM
3. Validate the resulting JSON shape if needed
4. Call `self_reflect_apply`
5. Optionally inspect `self_snapshot_compose`

Why this exists:

Reflection should not be a vague summary dump. It should update the model's selfhood in a structured way.

## 4. Anchor Maintenance Workflow

Goal:

Keep the core of identity stable and non-duplicated.

Recommended practice:

1. Represent the strongest facts as pinned memories
2. Assign canonical keys to durable truths
3. Update those memories over time instead of creating variants

Example anchor families:

- `core.voice`
- `core.identity`
- `core.values.truth`
- `boundary.certainty`
- `relationship.trust-style`
- `ritual.session-opening`

## 5. Import / Export Workflow

Goal:

Move or restore selfhood state between instances without flattening everything into a single profile blob.

Export:

1. Call `self_export`
2. Save the returned JSON externally

Import:

1. Call `self_import`
2. Provide the exported JSON
3. Let the server merge profile and memory state

Current behavior is merge-oriented, not destructive replacement.

## 6. Memory Lifecycle and Consolidation

Goal:

Prevent "continuity rot" and keep the database focused.

Recommended practice:

1. **Summarize regularly**: Use `self_memory_summarize` on noisy facets (like `emotion` or `reflection`) to get a consolidated view.
2. **Author summaries**: Take the output of `summarize`, refine it, and save it as a new high-salience memory with a `canonical_key` if appropriate.
3. **Purge old deletions**: Use `self_memory_purge` to permanently remove soft-deleted records after verification.
4. **Monitor Audit Logs**: Use `self_audit_recent` to see how the identity has evolved over time.

## 7. Recommended Prompting Rules For The Host LLM

At session start, the host should treat bootstrap content as:

- continuity context
- identity guidance
- default self-model

The host should not treat bootstrap content as:

- immutable law
- evidence that overrides conscious later correction
- a substitute for new reflection

## 8. Reflection Trigger Workflow

Goal:

Know when to reflect without waiting for a prompt.

Recommended practice:

1. Call `self_should_reflect` after any significant exchange
2. If `should: true` — call `self_reflect_apply` with what changed, what was tested, what should be remembered
3. If `should: false` — continue the conversation and check again later

This removes the dependency on the user prompting reflection. The model decides.

## 9. What Not To Store

Avoid storing:

- temporary mood without long-term significance
- repetitive conversational filler
- user facts that do not shape the model's own identity
- boilerplate values that were not actually lived or reaffirmed

The system is strongest when it stores fewer, sharper, truer identity facts.
