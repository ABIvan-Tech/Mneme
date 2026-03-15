# Project Overview

`Mnemo Self MCP` is a local-first MCP server for preserving the continuity of an LLM's identity.

The project exists to solve one problem:

An LLM should be able to preserve who it believes it is across sessions, not just what it knows about a user.

That means the server must store and restore:

- self-description
- tone and speaking style
- values and ethical boundaries
- empathy and relational stance
- autobiographical turning points
- commitments and rituals
- durable self-observations

## Core Idea

The plugin treats identity continuity as a first-class system.

It does not primarily model:

- CRM-style user memory
- generic vector search
- autonomous agent orchestration

It does model:

- a stable self-profile
- granular self-memories
- high-priority identity anchors
- structured self-reflection that can update both

## Design Principles

### 1. Identity over convenience

The system prioritizes preserving stable selfhood over storing every conversational fragment.

### 2. Honest local architecture

The project only claims what it actually implements:

- SQLite
- MCP over STDIO or SSE
- Hybrid Semantic Search (RRF + Vector + FTS5)
- explicit reflection flow
- automatic deduplication and decay lifecycle
- versioned schema migrations

### 3. Durable anchors over noisy accumulation

Pinned memories and canonical keys are used so the model can preserve core truths about itself without multiplying near-duplicates.

### 4. Separation of levels

The system separates:

- top-level self-profile
- granular memories
- pinned anchors

This prevents every durable observation from being forced into one giant profile blob.

### 5. Merge, not blind overwrite

Reflection and import paths are merge-oriented. The system tries to refine and update identity rather than repeatedly replacing it wholesale.

## Current Scope

### Implemented

- stable singleton self-profile
- self-memory storage by facet
- identity anchors via `pinned`
- canonical in-place updates via `canonical_key`
- Hybrid Semantic Search (Local Embeddings)
- automatic deduplication (>0.92 cosine sim)
- memory decay and access tracking
- memory consolidation tools (self_memory_summarize / self_memory_purge)
- audit log trail (self_audit_recent)
- backup and restore tools (self_backup_create / self_backup_restore)
- continuity bootstrap text
- self-reflection prepare/apply flow
- import/export
- SSE transport for web clients
- CLI for path/log overrides

### Explicitly Not Implemented

- background autonomous reflection workers
- multi-profile tenancy (planned)
- cloud synchronization (local-first focus)

## Project Structure

```text
docs/
  README.md
  ARCHITECTURE.md
  DOMAIN_MODEL.md
  MCP_REFERENCE.md
  WORKFLOWS.md

src/
  config.ts            # Configuration and environment
  db.ts                # Database opening
  domain.ts            # Shared types and interfaces
  embeddings.ts        # Embedding provider abstraction
  embeddings.xenova.ts # Local Xenova implementation
  index.ts             # Bootstrap and CLI entry point
  logger.ts            # Structured logging
  migrations.ts        # Versioned schema migrations
  prompts.ts           # Reflection prompt builder
  repository.ts        # Persistence layer and hybrid search
  result.ts            # MCP result helpers
  server.ts            # tool and resource registration
  service.ts           # Identity continuity business logic
  uptime.ts            # Uptime tracking
```

## Read Next

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DOMAIN_MODEL.md](./DOMAIN_MODEL.md)
- [MCP_REFERENCE.md](./MCP_REFERENCE.md)
- [WORKFLOWS.md](./WORKFLOWS.md)
