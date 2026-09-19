# Implementation State

```yaml
spec_version: 0.4-master-implementation-research-expanded
spec_digest_sha256: 9b8bc907fa0da89d4b7ea2e0be886919deffdb35e398ea7897ea77d305380f5b
last_completed_gate: M2-ontology-open-world
active_milestone: M3-jev-decision-runtime-verification
stable_packages: []
candidate_packages:
  - core-types
  - provenance
experimental_packages:
  - open-world-values
  - ontology
  - semantic-graph
  - semantic-validator
  - decision-runtime
  - decision-packs
  - verifier-core
  - discourse-ir
  - formal-ir
  - action-ir
  - universal-expression
  - trace-replay
partial_vertical_slices:
  - controlled-English-requirement-roundtrip
  - recorded-Jev-reference-choice
  - controlled-Vietnamese-shared-JSG
  - PIR-typed-hole-to-TypeScript
  - formal-action-universal-contract
  - m16-controlled-multitarget
  - m17-verification-hardening
  - m4-controlled-parser-foundation
known_failures: []
blocked_items:
  - live-Jev-smoke-not-yet-executed
next_tasks:
  - complete remaining M1 staged semantic validators and graph operations
  - run the single explicitly authorized live-Jev smoke required to close M3; keep M3 and successor milestone gates incomplete until then
  - harden M17 verifier orchestration, provenance edge cases, and cross-adapter conformance
  - expand M16 multi-target adapters beyond the controlled delete-limit semantic subset
  - run exactly one manual live-Jev smoke only when explicitly desired
last_verified_main_commit: 7dac106cdf08bc89be50833ed7dc4e7e6f5cd20e
last_verified_pr_head: b6d1f913107b72d76269fbcbab36ce8a447002d3
```

## Current state

A runnable foundation now exists, but this ledger deliberately does **not** mark a milestone complete before the current hardening PR passes its deterministic gate. The last verified `main` commit above passed install, package-boundary checks, strict TypeScript, and tests on GitHub Actions.

## Implemented foundation

- Strict TypeScript / Node 20+ baseline.
- Machine-readable package maturity/dependency DAG plus source-import boundary enforcement.
- Structured Result/Error, semantic IDs, versions, trust/sensitivity labels, canonical JSON and SHA-256 digest utilities.
- Provenance records/store.
- Open-world source spans, normalization maps, stale-span detection, numeric/quantity/temporal/path/URL/email/filename literals, opaque integrity validation, sensitivity/redaction, and secret-safe state projection.
- Ontology namespace/store, expanded reusable core primitive inventory, provisional concepts, compositional concepts, domain/range traversal, transactional merge, and deprecation/alias handling.
- JSG typed node/value algebra, atomic transactions, revisions, canonical serialization/deserialization, restore, semantic diff/query and staged foundation validation.
- Recorded and TypeSafe JDR adapters, shared provider-response runtime validation, normalized typed answers, bounded transport retry policy, request/token budgets, cache, calibration hooks, structured errors and trace accounting.
- Decision-pack registry/lifecycle contract, candidate-source provenance and recall evidence, deterministic decision-DAG batching, calibration profile registry, abstention policy, and evidence-based candidate/production maturity gates.
- JDR request/token budgets, deterministic trace events, cache accounting, and calibration hooks.
- Ontology transactional batch merge, parent-cycle rejection, ancestry queries, deprecation/replacement resolution, and replacement-cycle rejection.
- Generic VerificationObligation/Verifier ABI, evidence grading, deterministic-verifier precedence, and critical semantic-preservation checks including role bindings and temporal values.
- TypeScript 7 CLI compatibility with the official TypeScript 6 programmatic compiler API bridge for embedded compile checks.
- First four narrow bootstrap vertical slices: controlled English, recorded reference choice, controlled Vietnamese, and PIR typed-hole → TypeScript.
- M4 controlled grounding/parser foundation with reversible normalization, packed syntax forests, bounded recorded-JDR ambiguity choice, JSG commit, and corpus coverage for event/negation/quantity/time/condition/cause/requirement/permission/prohibition/comparison/question.
- Graph-structured Discourse IR foundation with deterministic prerequisite-aware ordering.
- Formal IR family foundation (Data/Schema/Query/Math/Logic/Command), capability-validated Action IR, and harness-neutral Universal Expression contract.
- Registry-driven Universal Expression runtime plus trace DAG/config-digest/replay-manifest foundation.
- Controlled M16 same-JSG path: English/Vietnamese text, structured-data IR, and declared Action IR from one semantic requirement graph.
- M17 verifier foundation: semantic round-trip with parser-limit unknowns, conservative trust/provenance checks, requirement reports, grammar evidence normalization, and compile/test evidence normalization.

## Still partial by design

The master specification is much broader than the bootstrap wave. Broad NLU/NLG, full dialogue/pragmatics, full Vietnamese grammar, full PIR/search/CEGIS, code patching/repair, richer formal backends, broader M16 multi-target coverage beyond the controlled semantic subset and concrete program adapters, broader verifier orchestration/provenance edge cases, full conformance matrix and research-expansion tasks remain open. Package stubs say `NOT_IMPLEMENTED` or `PARTIAL` rather than pretending they exist.

## Quota policy

Live Jev calls are not part of push/PR CI. The manual live smoke is hard-limited to one request containing one narrow question, uses SDK retry `0`, and reports SDK token usage. The current implementation wave has consumed **zero live Jev requests**.

## Completion semantics

`implemented` means source exists. `verified` means the relevant automated gate passed. Recorded Jev behavior is never reported as live success, and a narrow vertical slice is never reported as broad capability coverage.
