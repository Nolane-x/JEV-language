# M20 — v1.0 Stable-Core Conformance

Status: **implemented candidate; deterministic verification pending**

The master specification requires every stable core package to provide:

1. public API docs;
2. ABI/schema versioning;
3. conformance suites;
4. migration policy;
5. benchmark baseline;
6. known limitations;
7. replayable demos;
8. zero-generative-model audit for native demos.

## Stable-core target

The first v1 stable-core profile contains exactly:

- `core-types`
- `provenance`

The profile is intentionally non-vacuous. The conformance runtime rejects an empty stable-package set and rejects evidence whose package set differs from the declared target.

Both packages are dependency-safe for stable maturity: `core-types` has no package dependencies; `provenance` depends only on `core-types`.

## Evidence

Machine-readable release manifest:

- `docs/v1.0-conformance.json`

Public API and compatibility:

- `packages/core-types/PACKAGE.md`
- `packages/provenance/PACKAGE.md`
- `docs/api/v1/core-types.md`
- `docs/api/v1/provenance.md`

Migration policy:

- `docs/migrations/v1-stable-core.md`

Benchmark baseline:

- `evals/manifests/v1-stable-core-baseline.json`

Known limitations:

- `docs/known-limitations-v1.json`

Replayable native demo:

- `examples/v1/stable-core-replay.json`
- `scripts/replay-v1-stable-core.ts`
- command: `npm run demo:v1-stable-core`

Conformance suite:

- `tests/conformance/m20-v1-conformance.conformance.test.ts`
- command: `npm run test:v1-conformance`

## Versioning

`core-types`:

- package: `1.0.0`
- ABI: `1.0.0`
- `jl-result-envelope`: `1.0.0`
- `jl-runtime-schema`: `1.0.0`

`provenance`:

- package: `1.0.0`
- ABI: `1.0.0`
- `jl-provenance-record`: `1.0.0`
- `jl-provenance-store-snapshot`: `1.0.0`

## Zero-generative boundary

The stable-core replay demo imports only deterministic core/provenance facilities plus filesystem input. Its fixture declares and the conformance suite verifies:

- generative model calls: 0
- generative embedding calls: 0
- external generation services: 0
- violations: none

The replay uses fixed provenance IDs because ID-generation helpers intentionally use time/UUID sources.

## Research-gate separation

M20 stable-core conformance does **not** fabricate or substitute for M19 blinded human ratings. M19 natural-conversation research remains pending until real evaluator data is frozen and imported. A successful M20 engineering gate therefore does not imply a positive M19 research result.
