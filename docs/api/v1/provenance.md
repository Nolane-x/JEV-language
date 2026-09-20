# provenance Public API — v1.0

This document is the public API reference for the JEV Language stable provenance package.

The normative export surface is `packages/provenance/src/index.ts`; `packages/provenance/PACKAGE.md` summarizes the compatibility promise.

## ABI

`PROVENANCE_ABI_VERSION = "1.0.0"`.

## Serialization

The v1 stable serialized schemas are:

- `jl-provenance-record` → `1.0.0`
- `jl-provenance-store-snapshot` → `1.0.0`

## Determinism

`InMemoryProvenanceStore.snapshot()` sorts by record ID and returns clones. Replay fixtures therefore supply fixed provenance IDs instead of calling `createProvenance()`.

## Trust boundary

A provenance record describes origin/trust metadata; its presence is not proof that the metadata is true. Higher-layer verifiers remain responsible for ancestry, trust and integrity checks.
