# M16 — Universal Expression API Gate Evidence

Status: **verified**

Specification basis: Section 426 and tasks T248–T258 of the v0.4 master specification.

## Stable harness-neutral API mapping

| Task | Evidence |
| --- | --- |
| T248 ExpressionTarget | `ExpressionTarget` |
| T249 ExpressionRequest | `ExpressionRequest`, `ExpressionGoal`, `ExpressionConstraint` |
| T250 ExpressionArtifact union | text/program/structured-data/schema/query/math/logic/command/action artifacts |
| T251 ExpressionResult | `ResultEnvelope<T>`, `ExpressionResult`, explicit non-ok statuses |
| T252 capability manifest | `CapabilityManifest`, runtime `capabilities()` |
| T253 parse API | registry parser adapters + `parse()` |
| T254 realize API | registry realizer adapters + `realize()` |
| T255 express API | public `express()` routed through the same realization contract |
| T256 transform API | registry transformer adapters + `transform()` |
| T257 verify API | registry verifier adapters + `verify()` |
| T258 traces/replay | trace DAG events, configuration digest and replay manifest |

No core type contains a downstream harness dependency.

## Section-426 same-JSG acceptance

`tests/conformance/m16-multitarget.conformance.test.ts` starts with one controlled semantic graph for:

> the service must not delete more than N files.

The same constraint root is sent through one Universal Expression runtime to four independent target realizers:

1. **natural language** — controlled English text;
2. **structured data** — Data IR object retaining semantic refs;
3. **program** — backend-neutral PIR function `canDeleteFiles(requestedDeleteCount): boolean`;
4. **action** — declared capability Action IR.

Each artifact carries the same semantic root in `semanticRefs`.

The program realizer emits PIR only. It does not choose a source language or generate executable source text.

## Program applicability proof

The delete-limit requirement has a direct pure program interpretation:

`requestedDeleteCount <= semanticMaximum`

The generated PIR:

- has no unresolved holes;
- has one number parameter;
- returns boolean;
- has pure effect;
- binds the function semantic purpose to the requirement root;
- binds the parameter semantic purpose to the semantic quantity node;
- stores the source semantic root in program annotations;
- passes `validatePirProgram()` before being returned.

## Capability discovery proof

The same runtime manifest exposes:

- targets registered by the controlled realizers;
- language packs from registered language-aware adapters;
- backend/adapter identifiers;
- parse/realize/express/transform/verify operations.

The Section-426 test requires the manifest to include natural-language, structured-data, program and action targets and the exact registered adapter ids.

## Trace / replay proof

All four realization operations:

- carry the same runtime trace id;
- record start/finish events with configuration digests;
- appear in `traceEvents()`;
- are linked to `replayManifest().traceId`.

Separate trace-replay conformance verifies DAG integrity, missing-parent/cycle rejection and stable deterministic replay-bundle digests.

## Action execution boundary

Action realization requires the consumer to supply the configured capability schema. Missing capability declaration returns an explicit non-ok result.

The API constructs and validates Action IR only. It does not invoke the capability, perform I/O, approve permissions or run an autonomous loop.

## Non-claims

M16 does not claim broad semantic coverage for every target. The acceptance path is intentionally controlled and proves the public API architecture and same-root multi-target semantics.

Broader target/domain adapters remain subsequent coverage work.

## Verified gate evidence

- implementation head: `2ddfb7de428e71a33633d5db0408f5d9b4ed7227`
- GitHub Actions CI: run `#196` / run id `35438815596`
- result: `success`
- package-boundary check: pass
- strict TypeScript: pass
- full deterministic suite: pass
- live Jev requests consumed by M16: `0`

M16 may advance the implementation state to M17 verification hardening. The final state/evidence documentation commit must itself pass CI before merge.
