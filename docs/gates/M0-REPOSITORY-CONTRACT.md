# M0 — Repository and Contract Gate Evidence

Status: **candidate — pending CI on this branch**

Specification basis: sections 402 and 551 of the v0.4 master specification.

## Required artifacts

| Requirement | Evidence |
| --- | --- |
| workspace skeleton | root workspace plus `packages/manifest.json` |
| strict build configuration | `tsconfig.json`, `npm run typecheck` |
| package-layer check | `scripts/check-boundaries.mjs`, `npm run check:boundaries` |
| schema validation wrapper | `runtimeSchema()` in `packages/core-types/src/index.ts` |
| structured-error core | `StructuredError` with canonical `toJSON()` |
| trace IDs | `TraceId` and `createTraceId()` |
| implementation-state ledger | `docs/IMPLEMENTATION-STATE.md`, `docs/TASK-LEDGER.yaml` |
| ADR template | `docs/adr/0000-template.md` |
| CI C0/C1 | `.github/workflows/ci.yml` deterministic boundary/typecheck/test job |
| digest abstraction | `DigestProvider`, `NodeSha256DigestProvider`, `defaultDigestProvider` |

## Required tests

- all packages compile: CI `npm run typecheck`
- forbidden dependency cycle/import rule: CI `npm run check:boundaries`
- runtime schema boundary: `tests/conformance/m0-foundation.conformance.test.ts`
- canonical error serialization: `tests/conformance/m0-foundation.conformance.test.ts`
- digest provider contract: `tests/conformance/m0-foundation.conformance.test.ts`
- TraceId contract: `tests/conformance/m0-foundation.conformance.test.ts`

## Verification rule

This document must not claim **verified** until the branch commit containing all evidence above has a successful GitHub Actions CI run. After that run, record the verified head SHA/run and advance the active milestone to M1 verification.
