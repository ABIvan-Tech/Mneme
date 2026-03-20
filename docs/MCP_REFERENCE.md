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

### `self_memory_archive`

Purpose:

- archive a memory by id (hides it from search/snapshot without deleting it)

Arguments:

- `id` (string, required): Memory id

Returns:

- Memory entry after archiving

### `self_memory_unarchive`

Purpose:

- restore an archived memory back to active state

Arguments:

- `id` (string, required): Memory id

### `self_memory_restore`

Purpose:

- restore a soft-deleted memory back to active state

Arguments:

- `id` (string, required): Memory id

### `self_memory_search_batch`

Purpose:

- run multiple semantic searches in one call, each with independent query and filters

Arguments:

- `queries` (array, required): Array of `{ query, limit?, facet?, pinned_only? }` objects

Returns:

- `results`: Array of result sets, one per query

### `self_memory_thread_create`

Purpose:

- create a new memory thread (returns a UUID thread_id for linking memories)

Arguments:

- `label` (string, optional): Human-readable label for the thread

Returns:

- `thread_id`

### `self_memory_add_to_thread`

Purpose:

- associate an existing memory with a thread

Arguments:

- `id` (string, required): Memory id
- `thread_id` (string, required): Thread id from `self_memory_thread_create`

### `self_memory_get_thread`

Purpose:

- retrieve all memories belonging to a thread, ordered chronologically

Arguments:

- `thread_id` (string, required)

Returns:

- `memories`: Array of memory entries in the thread

### `self_profile_history`

Purpose:

- list profile snapshots (versions) created before each profile mutation

Arguments:

- `limit` (number, optional, default 20)

Returns:

- `snapshots`: Array of `{ id, snapshot_at, profile }` entries

### `self_profile_restore`

Purpose:

- restore the self-profile to a previous snapshot

Arguments:

- `snapshot_id` (string, required)

Returns:

- Restored profile entry

### `self_facet_consolidate`

Purpose:

- find low-salience consolidation candidates in a facet (step 1 of 2)

Arguments:

- `facet` (enum, required)
- `limit` (number, optional, default 10)

Returns:

- `candidates`: Low-salience memories eligible for consolidation

### `self_facet_consolidate_apply`

Purpose:

- apply consolidation: create one summary memory and soft-delete the sources (step 2 of 2)

Arguments:

- `facet` (enum, required)
- `source_ids` (array of strings, required): IDs of memories to consolidate
- `summary_content` (string, required): The LLM-generated consolidated summary

Returns:

- `consolidated`: The new summary memory entry
- `deleted_count`: Number of source memories soft-deleted

### `self_health_check`

Purpose:

- return detailed system health: database integrity, embedding status, memory counts, orphaned rows, FTS index status

Returns:

- `status`: `ok` | `degraded` | `error`
- `checks`: Array of named check results with status and detail

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
