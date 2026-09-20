# M20 — v1.0 conformance readiness

Status: **framework implemented; v1.0 currently blocked**.

The v1.0 gate is intentionally non-vacuous. An empty `stable_packages` list cannot make the release ready.

## Current blockers

1. Original M19 natural-conversation human measurement is still pending real blinded ratings.
2. `packages/manifest.json` currently contains no package with maturity `stable`.
3. Several packages do not yet have package-level public API documentation.
4. Package-specific ABI/schema version evidence and migration evidence are not yet complete across the required core set.
5. Package-specific benchmark/replay evidence still needs to be assembled into a v1 package matrix.

## Global release artifacts already prepared

- `docs/MIGRATION-POLICY.md`
- `docs/BENCHMARK-BASELINE.md`
- `docs/KNOWN-LIMITATIONS.md`
- `docs/unsupported-cases.json`
- `docs/coverage-v0.4.json`
- `examples/README.md`
- `examples/native-v0.4-roundtrip.ts`

## Readiness rule

`buildV1ConformanceReport(...)` can return `ready-for-v1` only when:

- the required core package set is non-empty;
- every required package is explicitly `stable`;
- every required package has public API docs;
- ABI/schema version evidence exists;
- conformance evidence exists;
- migration policy evidence exists;
- benchmark baseline evidence exists;
- known limitations are published;
- replayable demo evidence exists;
- zero-generative audit evidence exists;
- §§963–980 release gates are verified;
- original M19 measurement status is `complete`.

`complete` for M19 means measurement completion, not a positive naturalness score. Negative or mixed M19 results remain scientifically valid.

## Promotion policy

Package promotion from prototype/experimental/candidate to stable must be explicit. This framework does not automatically promote packages simply because tests pass.
