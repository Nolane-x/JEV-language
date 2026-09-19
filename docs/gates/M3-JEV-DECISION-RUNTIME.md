# M3 — Jev Decision Runtime Gate Evidence

Status: **verified**

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

## Deterministic CI evidence

- PR #17 implementation head: `1f84bc6dd4711c2939f8f73890e73a3a9aab870b`
- GitHub Actions CI run `#79` / run id `35420605857`: `success`
- merged squash commit: `8225706447feef17b3ed2777a8a12413e7ccea51`
- live Jev requests consumed by that deterministic PR: `0`

This proves the deterministic implementation path only. It does **not** satisfy the live acceptance requirement below.

## Live acceptance evidence

The required live track was executed once through an isolated temporary branch workflow with all quota protections enabled.

Verified run:

- workflow: `JEV Live Smoke Once 20260919`
- run id: `35421718883`
- run number: `1`
- temporary head: `e6999bd0c64bb7d9d543732efa816af2683c1170`
- conclusion: `success`
- provider source reported by the runtime: `live`
- model: `jev-1.13.0`
- provider requests used: `1`
- input tokens: `356`
- output tokens: `26`
- SDK retries: `0`
- runtime request budget: `1`

The temporary workflow branch was force-reset to `main` immediately after evidence collection. A post-cleanup Actions check found exactly one run of that workflow, so no second live request was triggered.

## Gate rule

Both required M3 tracks now have evidence: deterministic recorded mode and the one-request live Jev smoke. M3 is therefore verified. Normal push/PR CI remains network-free and must not run live Jev calls.
