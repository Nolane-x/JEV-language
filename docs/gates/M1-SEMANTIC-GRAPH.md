# M1 — Semantic Graph Gate Evidence

Status: **verified**

Specification basis: sections 403–404, staged-validation/invariant requirements, and bootstrap tasks T011–T035 of the v0.4 master specification.

## Definition-of-Done evidence

| Requirement | Evidence |
| --- | --- |
| JSG node envelope / minimum union / semantic refs | `packages/semantic-graph/src/nodes.ts` |
| in-memory graph store | `InMemorySemanticGraph` |
| transactions + preconditions | `GraphTransaction`, `beginTransaction()` |
| atomic commit / rollback | `commit()`, `rollback()`; no mutation before commit |
| revision identity | deterministic parent + schema + ontology + operation digest |
| canonical serialization | `canonicalSnapshotJson()`, `serializeSnapshot()` |
| runtime deserialization boundary | `deserializeSnapshot()` |
| reference integrity | `validateSnapshot()` dangling-reference checks |
| semantic query | `selectNodes()` |
| semantic diff | `semanticDiff()` |
| snapshot/replay | `GraphSnapshot`, `fromSnapshot()` with lineage preservation |

## Acceptance fixture

`tests/conformance/m1-semantic-graph.conformance.test.ts` constructs a graph containing:

- entities;
- an event;
- a proposition;
- an exact quantity with unit;
- an absolute time node;
- an explicit causal relation;
- a condition constraint;
- source attribution.

It then proves:

1. canonical serialize → deserialize → serialize stability;
2. semantic IDs and attribution/modality/time/scope preservation;
3. replay from a snapshot returns the same revision and canonical snapshot;
4. transaction replacement retains source provenance and quantity unit;
5. semantic diff is deterministic;
6. explicit rollback leaves state/revision unchanged;
7. failed validation leaves graph unchanged;
8. dangling references are rejected;
9. polarity remains explicit.

## Mandatory invariant mapping

| M1 invariant | Evidence |
| --- | --- |
| INV-001 no dangling internal references | validator + failed dangling-reference transaction fixture |
| INV-002 IDs stable through serialization | canonical round-trip fixture |
| INV-003 failed transaction leaves graph unchanged | failed-transaction fixture |
| INV-004 canonical serialization stable | serialize/deserialize canonical equality |
| INV-005 semantic diff deterministic | repeated diff equality |
| INV-006 provenance retained on mutation | replace-node provenance union + fixture |
| INV-007 polarity explicit | validator + fixture assertions |
| INV-008 quantity unit retained | replacement fixture |

## Verification rule

Verified evidence:

- implementation head: `6725495b37bbb1f4f5ee005946adb336a0670c70` (CI #72 passed)
- final documentation head: `e225bd34ed7f3f5a6133e39d59a275d5ffd15f6b`
- GitHub Actions final CI: run `#74` / run id `35420024045`
- result: `success`
- deterministic gate: package boundaries → strict typecheck → full test suite

The final documentation head also passed CI, so the merged M1 gate is fully verified and the implementation-state ledger has advanced to M2 ontology/open-world verification.


## T026–T035 staged semantic-validator completion

The original M1 graph gate proved the T011–T025 graph substrate. The remaining M1 validator tasks are now independently verified by `tests/conformance/m1-semantic-validator.conformance.test.ts` and the staged implementation in `packages/semantic-validator/src/index.ts`.

| Stage / task | Verified behavior |
| --- | --- |
| V0 / T026 | schema/runtime-value checks: schema and ontology version compatibility, trust label domain, confidence bounds, finite semantic numeric values |
| V1 / T027 | semantic-ID validity, duplicate IDs, complete internal-reference closure |
| V2 / T028 | ontology concept/role/relation existence checks, including nested semantic values, quantity units and entity attribute relations |
| V3 / T029 | role domain/range and relation domain/range checks with conservative handling of unresolved types |
| V4 / T030 | declared role cardinality, including maximums and minimums only where domain applicability is semantically known |
| V5 / T031 | resolved-scope validity, explicit negative-scope warning, reference/alternative binding membership |
| V7 / T032 | provenance closure when a provenance store is supplied and prevention of trust escalation beyond declared provenance |
| Registry / T033 | central stable diagnostic-code registry and structured diagnostics |
| V6 / T034 | duplicate-safe semantic invariant registration API |
| V6 / T035 | first invariant bundle: explicit polarity, exact-quantity unit retention, disjoint support/contradiction evidence |
| V8 extension point | deterministic profile-specific validation hook sorted by profile-validator ID |

Compatibility is preserved through the existing `validateSnapshot(snapshot, context?)` API, while `validateSnapshotStages(...)` exposes stage-level evidence.

### Validator verification evidence

- validator implementation head: `82be0463172ac444bfa5b26aefa12b20c8c9829b`
- verification head including state/gate updates: `6dff82ea2430749009cd97b2430c8b01fea374cd`
- GitHub Actions: CI #226 / run id `35443217721`
- package-boundary validation: **success**
- strict TypeScript typecheck: **success**
- deterministic test suite: **46/46 files, 378/378 tests passed**
- live Jev requests consumed by this work: **0**

T026–T035 are therefore verified. Warnings remain non-blocking in graph transactions; only `error` and `fatal` diagnostics reject a transaction.
