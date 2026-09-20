# provenance v1 Stable API

Package: `provenance`  
Package version: `1.0.0`  
ABI version: `1.0.0`

## Public API

The stable v1 surface is exported from `packages/provenance/src/index.ts`.

### Version contracts

- `PROVENANCE_PACKAGE_VERSION`
- `PROVENANCE_ABI_VERSION`
- `PROVENANCE_SCHEMA_VERSIONS`

### Provenance model

- `ProvenanceId`
- `ProvenanceRef`
- `ProvenanceOriginType`
- `ProvenanceRecord`
- `createProvenance()`

### In-memory store

- `InMemoryProvenanceStore.add()`
- `InMemoryProvenanceStore.get()`
- `InMemoryProvenanceStore.has()`
- `InMemoryProvenanceStore.snapshot()`

`snapshot()` returns cloned records sorted by provenance ID, giving deterministic ordering when record content and IDs are fixed.

## Stable schema versions

- `jl-provenance-record`: `1.0.0`
- `jl-provenance-store-snapshot`: `1.0.0`

## Compatibility promise

Within the v1 major line, existing stable record fields retain their meaning. Additive optional metadata is allowed. Removing/renaming fields, changing trust-label semantics, or changing snapshot ordering requires a new ABI/schema major version and migration note.

## Non-goals

The base store is intentionally in-memory. Persistent storage, ancestry-cycle validation, trust-escalation policy and cross-record semantic verification live in higher layers.
