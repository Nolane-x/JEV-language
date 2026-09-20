# core-types v1 Stable API

Package: `core-types`  
Package version: `1.0.0`  
ABI version: `1.0.0`

## Public API

The stable v1 surface is exported from `packages/core-types/src/index.ts`.

### Version and maturity contracts

- `Maturity`
- `Version`, `parseVersion()`
- `CORE_TYPES_PACKAGE_VERSION`
- `CORE_TYPES_ABI_VERSION`
- `CORE_TYPES_SCHEMA_VERSIONS`

### JSON, identifiers, trust and sensitivity

- `JsonPrimitive`, `JsonValue`
- `Namespace`, `SemanticId`, `TraceId`, `Digest`
- `TrustLabel`, `SensitivityLabel`, `ConfidenceValue`
- `isSemanticId()`, `createSemanticId()`, `createTraceId()`

### Result and error contracts

- `Result<T, E>`
- `ok()`, `err()`
- `StructuredError`
- `RuntimeSchema<T>`, `runtimeSchema()`
- `assertNever()`

### Canonical data and digest contracts

- `canonicalizeJson()`
- `canonicalJson()`
- `DigestProvider`
- `NodeSha256DigestProvider`
- `defaultDigestProvider`
- `sha256()`

### Result envelope schema

- `ResultEnvelopeStatus`
- `ResultEnvelopeDiagnostic`
- `ResultEnvelope<T>`
- `validateResultEnvelope()`
- `resultEnvelopeOk()`
- `resultEnvelopeError()`

## Stable schema versions

- `jl-result-envelope`: `1.0.0`
- `jl-runtime-schema`: `1.0.0`

## Compatibility promise

Within the v1 major line, existing stable exported names and serialized stable schema meanings will not be removed or changed incompatibly in minor/patch releases. Additive fields must remain optional unless a new schema major version is introduced.

## Non-goals

This package does not provide semantic graph validation, ontology reasoning, persistent storage, cryptographic signatures, or application-level authorization.
