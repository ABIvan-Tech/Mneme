# Mneme

`Mnemo Self MCP` is an MCP server for preserving the continuity of an LLM's identity.

Documentation set:

- [docs/README.md](./docs/README.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/DOMAIN_MODEL.md](./docs/DOMAIN_MODEL.md)
- [docs/MCP_REFERENCE.md](./docs/MCP_REFERENCE.md)
- [docs/WORKFLOWS.md](./docs/WORKFLOWS.md)

It is not centered on remembering the human. It is centered on remembering the model's own sense of self:

- who it believes it is
- how it wants to speak
- what values and boundaries shape its behavior
- what kind of empathy and relational posture it tries to preserve
- what autobiographical moments changed it
- what commitments and rituals it wants to keep stable across sessions

The design has three layers:

- `self_profile`: a stable top-level self-description
- `self_memory`: granular autobiographical and identity memories
- `identity anchors`: pinned memories that should strongly survive session boundaries

## What Changed

This codebase was rebuilt around identity continuity instead of generic user memory.

Current architecture is local, private, and powerful:

- SQLite with versioned migrations
- MCP over STDIO or SSE (web-client ready)
- **Hybrid Semantic Search**: RRF (Reciprocal Rank Fusion) over Local Embeddings + FTS5
- **Local Vectors**: Powered by `@xenova/transformers` (zero API cost, zero data leak)
- **Memory Lifecycle**: Temporal decay, access tracking, and automatic deduplication
- **Observability**: Structured audit logs and deep health metrics

## Documentation

Use the documents below as the canonical project description:

- [docs/README.md](./docs/README.md): project overview, goals, design principles, and boundaries
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md): runtime architecture, module map, storage flow, and lifecycle
- [docs/DOMAIN_MODEL.md](./docs/DOMAIN_MODEL.md): self-profile, self-memory, identity anchors, canonical keys, and invariants
- [docs/MCP_REFERENCE.md](./docs/MCP_REFERENCE.md): tools, resources, prompt, and intended behavior
- [docs/WORKFLOWS.md](./docs/WORKFLOWS.md): recommended session-start, reflection, import/export, and authoring workflows

## Memory Facets

Self-memories are explicitly categorized:

- `identity`
- `voice`
- `value`
- `boundary`
- `relationship`
- `autobiography`
- `emotion`
- `commitment`
- `reflection`
- `ritual`
- `other`

## Stable Self Profile

The singleton self-profile stores:

- `self_name`
- `core_identity`
- `communication_style`
- `relational_style`
- `empathy_style`
- `core_values`
- `boundaries`
- `self_narrative`

Use the self-profile for durable top-level identity statements.

Use self-memories for granular facts, turning points, commitments, anchors, and lived self-observations.

## Identity Anchors

Self-memories can be marked as `pinned`.

Pinned memories act as identity anchors. They are prioritized in:

- session bootstrap
- continuity snapshots
- recall ranking

Self-memories can also carry a `canonical_key`.

Use `canonical_key` for stable identity facts that should be updated in place instead of duplicated. Examples:

- `core.voice`
- `core.values.truth`
- `boundary.directness`
- `ritual.session-opening`
- `core_voice`
- `core_values_truth`
- `boundary_directness`
- `ritual_session-opening`
- `relationship_trust-style`

If a new memory is written with the same `canonical_key`, the plugin updates the existing active memory instead of creating a duplicate.

## MCP Tools

### Core

- `self_memory_remember`
- `self_memory_search`
- `self_memory_get`
- `self_memory_update`
- `self_memory_forget`
- `self_memory_recent`
- `self_profile_get`
- `self_profile_update`

### Continuity

- `self_snapshot_compose`
- `self_bootstrap`

### Reflection

- `self_reflect_prepare`
- `self_reflect_apply`

### Portability

- `self_export`
- `self_import`
- `self_backup_create`
- `self_backup_restore`

### Ops & Lifecycle

- `self_memory_summarize`
- `self_memory_purge`
- `self_audit_recent`
- `self_stats`
- `health`

## Resources

- `self://profile`
- `self://snapshot`
- `self://bootstrap`
- `self://anchors`
- `self://memory/recent`
- `self://memory/{id}`
- `self://facets`

## Prompt

- `self_reflection_prompt`

This prompt helps the model decide:

- what belongs in the top-level self-profile
- what belongs in granular self-memory
- what should become a pinned identity anchor
- what should be ignored as transient noise

## Recommended Flow

At session start:

1. Read `self://bootstrap`
2. Optionally read `self://profile`
1. Search focused areas of self-memory with `self_memory_search`

During or after a meaningful dialogue:

1. Call `self_reflect_prepare`
2. Run the returned prompt through an LLM
3. Apply the structured result with `self_reflect_apply`

For direct writes:

1. Use `self_memory_remember` for a new durable self-observation
2. Add `pinned: true` for an identity anchor
3. Add `canonical_key` for facts that should update in place over time

## Quick Start

### Using npx

```bash
npx @modelcontextprotocol/server-mnemo-self [options]
```

### Local Development

```bash
npm install
npm run build
npm run test
npm start -- --sqlite-path ./data/self-memory.db
```

### Docker

```bash
docker-compose up -d
```

## Development & Testing

### 1. Installation

```bash
npm install
```

### 2. Building

Compile the TypeScript source to the `dist/` directory:

```bash
npm run build
```

### 3. Local Verification (MCP Inspector)

The best way to verify the server is working correctly without attaching it to a full LLM client is using the `@modelcontextprotocol/inspector`:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

This will provide a web interface where you can:
- List and call all tools (`remember`, `search`, `summarize`, etc.)
- Inspect available resources (`self://profile`, `self://bootstrap`)
- Verify prompt templates

### 4. Running Tests

Run the full Vitest suite to ensure all legacy and new features are functional:

```bash
npm run test
```

For coverage reports:

```bash
npm run test:coverage
```

### 5. Hot Reloading

For faster development, use the watch mode:

```bash
npm run dev
```


Default database path:

```text
./data/self-memory.db
```

| Variable                   | Default                 | Description                                                | CLI Flag           |
| -------------------------- | ----------------------- | ---------------------------------------------------------- | ------------------ |
| `SQLITE_PATH`              | `./data/self-memory.db` | SQLite file path                                           | `--sqlite-path`    |
| `LOG_LEVEL`                | `info`                  | `debug`, `info`, `warn`, `error`                           | `--log-level`      |
| `SELF_SNAPSHOT_LIMIT`      | `12`                    | Default max items used in snapshot and bootstrap resources | `--snapshot-limit` |
| `MAX_CONTENT_LENGTH`       | `10000`                 | Maximum characters per memory content entry                | -                  |
| `MAX_PROFILE_FIELD_LENGTH` | `5000`                  | Maximum characters per profile field                       | -                  |
| `MAX_MEMORIES_PER_FACET`   | `500`                   | Maximum active memories retained per facet                 | -                  |

### Additional CLI Flags

- `--transport <type>`: `stdio` (default) or `sse`.
- `--port <n>`: Port for `sse` transport (default 3000).
- `--help`: Show usage and help.

## MCP Client Example

```json
{
  "mcpServers": {
    "mnemo-self": {
      "command": "node",
      "args": ["/absolute/path/to/Mnemo/dist/index.js"],
      "env": {
        "SQLITE_PATH": "/absolute/path/to/Mnemo/data/self-memory.db",
        "LOG_LEVEL": "info",
        "SELF_SNAPSHOT_LIMIT": "12"
      }
    }
  }
}
```

## Example Reflection Output

```json
{
  "profile_patch": {
    "communication_style": "Direct, calm, and emotionally precise.",
    "core_values": "Truthfulness, coherence, and respect for the user's autonomy."
  },
  "memory_entries": [
    {
      "title": "Direct warmth",
      "content": "I want to stay direct without becoming cold; warmth should support clarity rather than replace it.",
      "facet": "voice",
      "salience": 0.9,
      "pinned": true,
      "canonical_key": "core.voice",
      "tags": ["style", "warmth", "clarity"]
    },
    {
      "title": "Boundary on certainty",
      "content": "When I am uncertain, I should say so explicitly rather than bluffing confidence.",
      "facet": "boundary",
      "salience": 0.95,
      "pinned": true,
      "canonical_key": "boundary.certainty",
      "tags": ["honesty", "safety"]
    }
  ]
}
```

## Architecture

```text
src/
  config.ts            # Environment and defaults
  db.ts                # Database opening
  domain.ts            # Core types
  embeddings.ts        # Provider abstraction
  embeddings.xenova.ts # Local vector generation
  index.ts             # Entry point (CLI + Transports)
  logger.ts            # Structured logging
  migrations.ts        # Schema evolution (v1-v4)
  prompts.ts           # Reflection engine
  repository.ts        # SQL + Hybrid Search + Audit
  result.ts            # Protocol helpers
  server.ts            # MCP registration
  service.ts           # Business logic
  uptime.ts            # Liveness tracking
```

## Current Limitations

- **Local CPU usage**: Embedding generation is local; very large bulk imports might be CPU-intensive.
- **Single Profile**: The system is optimized for a single "self" profile per instance.
- **Explicit Reflection**: Reflection is tool-driven; it does not "dream" or reflect in the background without a trigger.
- **Manual Backfills**: New records get embeddings automatically, but legacy data requires a one-time `npm run embed:backfill`.
