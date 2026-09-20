# core-types Public API — v1.0

This document is the public API reference for the first JEV Language stable-core package.

The normative export surface is `packages/core-types/src/index.ts`; `packages/core-types/PACKAGE.md` summarizes the compatibility promise.

## ABI

`CORE_TYPES_ABI_VERSION = "1.0.0"`.

Stable consumers may rely on the exported Result/Error contracts, typed identifiers, canonical JSON/digest helpers, runtime-schema wrapper and ResultEnvelope contracts documented in the package file.

## Serialization

The v1 stable serialized schemas are:

- `jl-result-envelope` → `1.0.0`
- `jl-runtime-schema` → `1.0.0`

The string field inside `ResultEnvelope.schemaVersion` remains `jl-result-envelope-1`; the semantic schema release version is tracked separately as `1.0.0`.

## Determinism

`canonicalJson()` and `sha256()` are deterministic for the same JSON value. ID creation helpers are intentionally not deterministic and must not be used as replay expectations unless IDs are captured in replay evidence.
