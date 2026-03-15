# Architecture

## Intent

The architecture is optimized for one job:

Persist and restore the LLM's continuity of self with minimal moving parts.

The current system is deliberately small:

- one process
- one SQLite database
- one MCP server
- one main service layer

## Runtime Topology

    Index["src/index.ts<br/>bootstrap + STDIO/SSE transport"] --> Server
    Repo --> Audit["Audit Log<br/>Event trail"]
```

## Module Responsibilities

### [src/index.ts](/Users/alex/LLMs/!Projects/Mnemo/src/index.ts)

Process bootstrap:

- loads config
- opens SQLite
- creates repository and service
- creates MCP server
- attaches STDIO or SSE transport
- handles graceful shutdown

### [src/server.ts](/Users/alex/LLMs/!Projects/Mnemo/src/server.ts)

Protocol layer:

- registers MCP tools
- registers MCP resources
- registers MCP prompt
- validates tool inputs with `zod`
- translates service results into MCP responses

### [src/service.ts](/Users/alex/LLMs/!Projects/Mnemo/src/service.ts)

Core domain behavior:

- writes and updates self-memories
- enforces `canonical_key` merge semantics
- manages pinned identity anchors
- generates and compares embeddings
- manages access counters and lifecycle (decay/deduplication)
- updates self-profile
- composes snapshots and bootstrap text
- applies structured reflection output
- merges imports

This is the main identity-continuity engine.

### [src/repository.ts](/Users/alex/LLMs/!Projects/Mnemo/src/repository.ts)

Persistence access:

- raw SQL for reads/writes
- Hybrid Semantic Search (RRF + Vector + FTS5)
- access tracking (counters + timestamps)
- audit log persistence
- counts and exports
- transactional wrapper

### [src/migrations.ts](/Users/alex/LLMs/!Projects/Mnemo/src/migrations.ts)

Schema evolution:

- versioned migration scripts (v1-v4)
- handles table creation, FTS5 triggers, and embedding/access columns
- ensures the singleton `self_profile` row exists

### [src/domain.ts](/Users/alex/LLMs/!Projects/Mnemo/src/domain.ts)

Shared domain types:

- memory facets
- self-memory row and public entry types
- self-profile shape
- self-snapshot shape

### [src/prompts.ts](/Users/alex/LLMs/!Projects/Mnemo/src/prompts.ts)

Prompt scaffolding:

- generates the self-reflection prompt
- defines the prompt argument schema

## Storage Model

### Table: `self_profile`

Singleton row keyed by `id = 'self'`.

Purpose:

- hold stable top-level identity statements
- act as the highest-level summary of the model's selfhood

### Table: `self_memory`

Append-oriented but merge-capable memory store.

Purpose:

- hold granular durable self-observations
- store autobiographical and relational details
- preserve pinned anchors

Important columns:

- `facet`
- `salience`
- `pinned`
- `canonical_key`
- `embedding` (BLOB vector)
- `access_count`
- `last_accessed_at`
- `created_at`
- `updated_at`
- `deleted_at`

### Table: `audit_log`

Purpose:

- provide a tamper-evident event trail for all identity and memory changes
- aid in system observability and debuggability

### Virtual table: `self_memory_fts`

Purpose:

- provide lexical full-text search over `title`, `content`, and `tags`

### Semantic Search

Purpose:

- provide meaning-based retrieval using local embeddings (`@xenova/transformers`)
- rank results using Hybrid Search (Reciprocal Rank Fusion) for maximum relevance

Search fallback:

- if embeddings or FTS are unavailable, the repository falls back to `LIKE` patterns.

## Request Flow

### Direct Memory Write

```text
MCP tool -> zod validation -> SelfMemoryService.remember ->
canonical_key merge decision -> repository write/update -> SQLite
```

### Session Bootstrap

```text
MCP resource/tool -> composeSnapshot/composeBootstrap ->
load profile + anchors + supporting memories ->
render continuity text for next session
```

### Reflection Apply

```text
LLM output JSON -> self_reflect_apply ->
transaction ->
update self_profile ->
upsert self_memory entries ->
commit
```

## Why Anchors Exist

Without anchors, important identity statements degrade into ordinary notes and become hard to recover consistently.

Pinned anchors solve that by guaranteeing a high-priority memory tier for:

- voice
- values
- boundaries
- enduring rituals
- core relational posture

## Why Canonical Keys Exist

Identity continuity needs correction over time, not duplication.

Example:

The model may refine `core.voice` several times as it matures. With `canonical_key = core.voice`, each new refinement updates the same durable anchor instead of creating parallel and conflicting memories.

The current architecture intentionally does not solve:

- complex cross-device sync orchestration
- conflict resolution between multiple active profiles

Those can be added later, but they are not hidden behind misleading documentation today.
