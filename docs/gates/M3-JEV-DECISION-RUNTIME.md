# M3 — Jev Decision Runtime Gate Evidence

Status: **deterministic candidate — live smoke not yet executed**

Specification basis: sections 185–191, 407–408, 863–884, and bootstrap tasks T060–T084 of the v0.4 master specification.

## Deterministic implementation evidence

| Requirement | Evidence |
| --- | --- |
| Noul / Choice / Score types | `DecisionQuestion` union |
| normalized answers | `DecisionAnswer` / `DecisionBatchResponse` |
| batch requests | `DecisionBatchRequest` |
| provider adapter | `DecisionProviderAdapter` |
| current TypeSafe adapter | `TypeSafeDecisionAdapter` |
| provider-response runtime validation | `validateDecisionBatchResponse()` |
| timeout/cancellation | request `deadlineMs`, `AbortSignal`, TypeSafe adapter timeout/signal mapping |
| structured errors | `JdrError` stable taxonomy |
| retry policy | `DecisionRetryPolicy` + runtime transport/schema retry loop |
| cache | `DecisionCache`, `InMemoryDecisionCache` |
| recorded replay | `RecordedDecisionAdapter` |
| state projector ABI | `StateProjector<I>` |
| trace events | request/cache/failure/completion events |
| Decision Pack manifest/loader/version | `DecisionPackManifest`, `loadDecisionPack()`, semver validation |
| candidate-source binding | `CandidateSourceBinding` + manifest validation |
| fallback policies | typed `LowConfidenceFallback` |
| decision DAG | `DecisionNode`, `DecisionDag` |
| DAG scheduler | `scheduleDecisionDag()` |
| independent-node batching | deterministic topological `DecisionBatchPlan[]` |
| budget tracking | request/input/output/total token budgets |
| calibration loader | `loadCalibrationProfile()`, `CalibrationProfileRegistry` |
| confidence/abstention | `evaluateConfidence()` |
| first sentinel pack | `sentinelDecisionPack` remains draft until evidence justifies promotion |

## Deterministic conformance

`tests/conformance/m3-decision-runtime.conformance.test.ts` proves:

1. provider responses are rejected when answer IDs/types/candidates/probabilities violate the request contract;
2. retry occurs only for configured typed failures and each provider attempt consumes request budget;
3. semantic uncertainty / low confidence does not trigger transport retry;
4. low confidence is handled by abstention policy;
5. independent DAG nodes form deterministic parallel batches;
6. dependency cycles are rejected;
7. candidate Choice packs require candidate-source provenance and candidate-recall evidence;
8. calibration profiles are runtime validated and registry versioned;
9. low candidate-recall confidence may cause abstention;
10. recorded mode executes deterministically without a live network/model call.

## Decision quality evidence rule

Before any Decision Pack is treated as a relied-on candidate/production asset, its lifecycle validator requires the appropriate fixture/schema/constraint/counterexample/failure/trace evidence. Choice packs additionally require candidate-source bindings and candidate-recall reporting. Production maturity additionally requires calibration profile and version-history evidence.

## Required live acceptance still open

The M3 Definition of Done requires both:

- recorded deterministic response mode;
- live Jev smoke mode.

The repository contains `.github/workflows/jev-live-smoke.yml`, which:

- is manual `workflow_dispatch` only;
- runs only when input `confirm` equals `YES`;
- exposes the stored API secret only to that job;
- sets `JEV_ALLOW_LIVE=1`;
- hard-limits `JEV_LIVE_MAX_REQUESTS=1`.

The current GitHub connector can inspect CI jobs but does not expose a workflow-dispatch action. Therefore this gate MUST remain incomplete until that single-request workflow is explicitly dispatched and its run evidence is recorded here.

## Gate rule

Deterministic CI success is required before merging the implementation. **Do not set `last_completed_gate` to M3** until a successful one-request live smoke is also recorded. Until then, M2 remains the last completed gate and M3 remains the active milestone.
