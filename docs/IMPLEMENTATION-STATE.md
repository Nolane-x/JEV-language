# Implementation State

```yaml
spec_version: 0.4-master-implementation-research-expanded
spec_digest_sha256: 9b8bc907fa0da89d4b7ea2e0be886919deffdb35e398ea7897ea77d305380f5b
last_completed_gate: M5-constrained-realizer-roundtrip
active_milestone: M6-bidirectional-English-expansion
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
  - m5-controlled-realizer-roundtrip
  - m6-discourse-naturalness-foundation
known_failures: []
blocked_items: []
next_tasks:
  - verify M6 T170-T180 discourse/naturalness foundation on deterministic CI
  - complete M6 bidirectional relative-clause, multi-sentence, and unknown-term preservation fixtures
  - run the M6 template-leakage benchmark on the expanded held-out corpus and publish failure classes
  - complete remaining M1 staged semantic validators and graph operations
  - harden M17 verifier orchestration, provenance edge cases, and cross-adapter conformance
  - expand M16 multi-target adapters beyond the controlled delete-limit semantic subset
last_verified_main_commit: 7176fa8f4959e1f44acc860e9c7aaa4504ada6ab
last_verified_pr_head: 48ae8668e8154d43cc03101c9a163d6c30fd7459
```

## Current state

M0–M5 are verified and merged. M3 includes the required one-request live Jev acceptance run; M4 and M5 are deterministic language-engine gates. M6 is now the active milestone: T170–T180 infrastructure and several bidirectional English variants are implemented on the current candidate branch, but M6 remains partial until all section-413 phenomena and its held-out template-leakage benchmark pass.

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
- M5 constrained English realization with discourse/clause plans, lexical/morphology planning primitives, semantic source maps, attribution-safe realization, fallback policy, and a 100% semantic round-trip target on the current 11-fixture controlled corpus.
- M6 candidate foundation: semantic discourse-relation planning, safety-gated aggregation, explicit paraphrase lattices, repetition/style/audience planning, collocation scoring, bounded pragmatic Decision Packs, template-leakage metrics, human-eval export, and verified-by-round-trip lexical/syntactic variants for synonyms, active/passive forms, temporal movement, condition/cause ordering, and reported speech.
- Graph-structured Discourse IR foundation with deterministic prerequisite-aware ordering.
- Formal IR family foundation (Data/Schema/Query/Math/Logic/Command), capability-validated Action IR, and harness-neutral Universal Expression contract.
- Registry-driven Universal Expression runtime plus trace DAG/config-digest/replay-manifest foundation.
- Controlled M16 same-JSG path: English/Vietnamese text, structured-data IR, and declared Action IR from one semantic requirement graph.
- M17 verifier foundation: semantic round-trip with parser-limit unknowns, conservative trust/provenance checks, requirement reports, grammar evidence normalization, and compile/test evidence normalization.

## Still partial by design

The master specification is much broader than the bootstrap wave. Broad NLU/NLG, full dialogue/pragmatics, full Vietnamese grammar, full PIR/search/CEGIS, code patching/repair, richer formal backends, broader M16 multi-target coverage beyond the controlled semantic subset and concrete program adapters, broader verifier orchestration/provenance edge cases, full conformance matrix and research-expansion tasks remain open. Package stubs say `NOT_IMPLEMENTED` or `PARTIAL` rather than pretending they exist.

## Quota policy

Live Jev calls are not part of push/PR CI. M3 used exactly one explicitly isolated live smoke request: model `jev-1.13.0`, 356 input tokens, 26 output tokens, SDK retry `0`. The temporary trigger was removed after the successful run, and ordinary deterministic development remains at zero live requests.

## Completion semantics

`implemented` means source exists. `verified` means the relevant automated gate passed. Recorded Jev behavior is never reported as live success, and a narrow vertical slice is never reported as broad capability coverage.
