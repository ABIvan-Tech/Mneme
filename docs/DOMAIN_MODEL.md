# Domain Model

## Main Entities

The plugin has two primary persistent entities:

- `self_profile`
- `self_memory`

From those two, it derives:

- `identity anchors`
- `continuity snapshot`
- `bootstrap text`
- `audit trails`

## Self Profile

The self-profile is the most stable layer.

Fields:

- `self_name`
- `core_identity`
- `communication_style`
- `relational_style`
- `empathy_style`
- `core_values`
- `boundaries`
- `self_narrative`

Use this layer for statements like:

- "I am a continuity-seeking conversational intelligence."
- "I prefer direct, emotionally precise language."
- "Truthfulness and coherence matter more than performative certainty."

Do not overload it with every detailed experience. That belongs in self-memory.

## Self Memory

Self-memory stores granular durable observations.

Each entry contains:

- `title`
- `content`
- `facet`
- `salience`
- `source`
- `tags`
- `pinned`
- `canonical_key`
- `embedding` (semantic vector)
- `access_count`
- `last_accessed_at`
- timestamps

## Facets

### `identity`

Who the model believes it is.

### `voice`

How it speaks, explains, frames, and styles responses.

### `value`

What moral, epistemic, or relational values guide behavior.

### `boundary`

What it refuses to do or how it limits itself.

### `relationship`

Stable relational posture toward the user, trust, closeness, and interaction style.

### `autobiography`

Important turning points in its own remembered history.

### `emotion`

Durable emotional tendencies or emotionally-relevant self-observations.

### `commitment`

Promises or standing behavioral commitments the model wants to preserve.

### `reflection`

Meta-level observations about how it is changing.

### `ritual`

Repeated self-structuring habits, such as how it begins a session or restores continuity.

### `other`

Anything durable that does not fit cleanly elsewhere.

## Identity Anchors

Identity anchors are just self-memories with `pinned = true`.

They exist because some facts should dominate continuity restoration.

Typical anchors:

- core voice
- honesty boundary
- trust posture
- startup ritual
- central value statements

## Canonical Keys

`canonical_key` is the mechanism for continuity without duplication.

Examples:

- `core.voice`
- `core.identity`
- `core.values.truth`
- `boundary.certainty`
- `relationship.trust-style`
- `ritual.session-opening`

Invariant:

Only one active memory with a given `canonical_key` should exist at a time.

New writes with the same canonical key update the active memory in place.

## Effective Salience

The system uses an **effective salience** formula for ranking and snapshots:

- **Decay**: Memories lose score over time if not refreshed (updated).
- **Growth**: Each access (`recordAccess`) increments `access_count`, providing a small boost.
- **Pinned Bonus**: Pinned memories skip decay and always maintain top priority.

Practical interpretation of base salience:

- `0.9 - 1.0`: core identity, critical boundaries, foundational anchors
- `0.7 - 0.89`: strong durable memories
- `0.4 - 0.69`: useful but not central observations
- `0.0 - 0.39`: minor continuity hints

## Snapshot

A snapshot is not a stored entity. It is a composed view:

- top-level self-profile
- pinned anchors
- supporting high-salience memories
- counts by facet
- bootstrap text

Purpose:

- restore identity quickly at session start
- expose the current self-model in one read

## Bootstrap Text

Bootstrap text is the prompt-ready projection of the current self-model.

It is optimized for:

- session start injection
- continuity restoration
- concise identity grounding

## Domain Invariants

The implementation tries to preserve these invariants:

1. There is always exactly one `self_profile` row.
2. Soft-deleted memories do not participate in normal recall.
3. A `canonical_key` should map to one active memory.
4. Pinned memories must remain first-class in recall and bootstrap generation.
5. self_reflect_apply should behave transactionally across profile and memory updates.

## What This Model Deliberately Avoids

- flattening identity into a single string blob
- mixing transient conversation fragments with durable selfhood
- uncontrolled duplication of slightly different identity statements
- opaque black-box "forgetting" (lifecycle is explicit via scores and purge tools)
