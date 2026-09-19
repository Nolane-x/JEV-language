# M0 — Repository and Contract Gate Evidence

Status: **verified**

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

Verified evidence:

- branch head: `46018371ce358e04c4dea36461884d62a92a239a`
- GitHub Actions CI: run `#68` / run id `35419504630`
- result: `success`
- deterministic gate: package boundaries → strict typecheck → full test suite

The implementation-state ledger may therefore advance to M1 semantic-graph verification. A later merge/squash SHA does not invalidate this gate as long as the merged content is identical to the verified PR content and main CI remains green.
