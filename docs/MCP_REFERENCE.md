# MCP Reference

This document describes the current MCP surface exposed by the server.

## Tools

### `self_memory_remember`

Purpose:

- create or update a durable self-memory

Important fields:

- `content`
- `facet`
- `salience`
- `pinned`
- `canonical_key`

Behavior:

- creates a new memory by default
- updates an existing memory in place when `canonical_key` matches an active memory

### `self_memory_search`

Semantic and lexical search for memories.

Arguments:

- `query` (string, required): Search terms
- `limit` (number, optional, default 10): Max results
- `facet` (enum, optional): Filter by facet
- `pinned_only` (boolean, optional): Only pinned memories

Returns:

- `rows`: Array of memory entries
- `search_mode`: `hybrid` | `vector` | `fts` | `like`

Note: If embeddings are enabled, this performs hybrid search using Reciprocal Rank Fusion (RRF).

### `self_memory_summarize`

Get a consolidated summary of memories for a given facet.

Arguments:

- `facet` (enum, required): The facet to summarize

Returns:

- `summary`: Prompt-ready text consolidating the memories.

### `self_memory_purge`

Permanently remove soft-deleted memories.

Arguments:

- `retention_days` (number, optional, default 30): Purge items deleted more than X days ago.

Returns:

- `purged_count`: Number of items removed.

### `self_memory_get`

Purpose:

- fetch one memory by id

### `self_memory_update`

Purpose:

- manually refine an existing self-memory

Supports:

- title/content updates
- facet changes
- salience changes
- anchor status changes
- canonical key changes

### `self_memory_forget`

Purpose:

- soft-delete a self-memory by id

### `self_memory_forget_by_key`

Purpose:

- soft-delete a self-memory by canonical_key
- more convenient than forget-by-id when you know the key

Arguments:

- `canonical_key` (string, required): The canonical key of the memory to delete

Returns:

- `canonical_key`, `id`, `deleted`

### `self_memory_recent`

Purpose:

- list recent memories

Options:

- `limit`
- `facet`
- `pinned_only`

### `self_profile_get`

Purpose:

- read the singleton self-profile

### `self_profile_update`

Purpose:

- update durable top-level identity statements

Use this when the change is profile-level, not just one memory.

### `self_snapshot_compose`

Purpose:

- build a structured continuity snapshot

Returns:

- profile
- anchors
- supporting memories
- counts by facet
- `bootstrap_text`

### `self_bootstrap`

Purpose:

- return a prompt-ready continuity text block for session startup

### `self_reflect_prepare`

Purpose:

- prepare a reflection prompt using recent dialogue plus the current bootstrap

Input:

- `recent_dialogue`
- `max_items`

Returns:

- current bootstrap payload
- reflection prompt text

### `self_reflect_apply`

Purpose:

- apply structured reflection output

Accepted structure:

- `profile_patch`
- `memory_entries`

Behavior:

- runs in one transaction
- updates profile if present
- upserts memories with canonical merge behavior

### `self_export`

Purpose:

- export the current self-state as JSON

### `self_import`

Bulk import memories and profile state. Use for migration or consolidation.

Arguments:

- `data`: JSON object or string containing state.

### `self_audit_recent`

List recent internal audit logs for system observability.

Arguments:

- `limit` (number, optional, default 50): Max logs.

Returns:

- `logs`: Array of audit log entries.

### `self_stats`

Purpose:

- return counts and completeness indicators

Includes:

- total memories
- pinned memories
- counts by facet
- self-profile completeness

### `self_backup_create`

Purpose:

- create a JSON backup of the entire self-memory state to a local file

### `self_backup_restore`

Purpose:

- restore self-memory state from a JSON backup file

### `self_should_reflect`

Purpose:

- check if it is time to reflect and store memories from the current session
- call this when a significant moment has passed, or periodically during long sessions

Arguments:

- `inactivity_minutes` (number, optional, default 30): Minutes since last memory update before reflection is recommended

Returns:

- `should`: boolean
- `reason`: explanation
- `last_memory_age_minutes`: minutes since last memory update
- `suggestion`: what to do next

### `list_tools`

Purpose:

- list all available tools with descriptions and tier classification
- useful for discovery when the MCP client limits visible tools

Returns:

- `total`: number of tools
- `tools`: array of `{ name, tier, description }`

### `health`

Purpose:

- basic liveness probe
- returns enhanced server operating metrics (uptime, version, storage size, active memory counts)

## Resources

### `self://profile`

Current singleton self-profile.

### `self://snapshot`

Structured continuity snapshot.

### `self://bootstrap`

Plain-text continuity bootstrap for prompt injection.

### `self://anchors`

Pinned identity anchors only.

### `self://memory/recent`

Recent self-memories.

### `self://memory/{id}`

One memory by id.

### `self://facets`

Allowed facet enum values.

## Prompt

### `self_reflection_prompt`

Purpose:

- help the model decide what to preserve about itself after a dialogue

Arguments:

- `recent_dialogue`
- `current_snapshot`

Expected output:

- JSON with `profile_patch` and `memory_entries`

## Behavioral Conventions

### Use `self_profile_update` when:

Use it for durable global statements, for example:

- identity
- voice at the highest level
- broad value set
- broad boundaries

### Use `self_memory_remember` for:

Use it for:

- specific observations
- autobiographical turning points
- granular commitments
- rituals
- anchorable facts

### When to pin a memory

Pin when forgetting or demoting the memory would noticeably distort continuity.

### When to use a canonical key

Use it when the same identity fact should evolve in place over time.
