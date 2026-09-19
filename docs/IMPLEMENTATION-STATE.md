# Implementation State

```yaml
spec_version: 0.4-master-implementation-research-expanded
spec_digest_sha256: 9b8bc907fa0da89d4b7ea2e0be886919deffdb35e398ea7897ea77d305380f5b
last_completed_gate: M12-typescript-backend
active_milestone: M13-python-backend
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
  - m7-dialogue-semantics
  - m8-vietnamese-language-pack
  - m10-program-ir
  - m11-synthesis-core
  - m12-typescript-backend
known_failures: []
blocked_items: []
next_tasks:
  - verify M13 Python backend gate on CI before advancing to M14 compiler/test repair loop
  - complete remaining M1 staged semantic validators and graph operations
  - harden M17 verifier orchestration, provenance edge cases, and cross-adapter conformance
  - expand M16 multi-target adapters beyond the controlled delete-limit semantic subset
last_verified_main_commit: ffedc2521cc1310141f4e6ffb7b3028c7bf9d446
last_verified_pr_head: 9fc388abc194c2ac737e45da30ca3f24b8e4676a
```

## Current state

M0–M9 are verified at their milestone gates. M3 includes the required one-request live Jev acceptance run; M4–M9 use deterministic/recorded language-engine evidence. M9 passed CI #136 with 36/36 test files and 280/280 tests. M10 Program IR and M11 Synthesis Core are verified. M12 TypeScript Backend passed CI #155 with 39/39 test files and 312/312 tests; M13 Python Backend is now the active milestone.

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
- M6 verified bidirectional English expansion: semantic discourse-relation planning, safety-gated aggregation, explicit paraphrase lattices, repetition/style/audience planning, collocation scoring, bounded pragmatic Decision Packs, human-eval export, verified-by-round-trip synonyms/active-passive/temporal/condition/cause/reported-speech variants, relative clauses, pronoun-linked multi-sentence discourse, exact unknown-name preservation, and a passing 14-sample held-out template-leakage benchmark.\n- M7 verified dialogue semantics: revisioned transactional state, topic stack, salience/reference candidates, questions, requests, commitments, correction/retraction history, ellipsis/follow-up reconstruction, bounded reference Decision Pack, semantics-preserving compaction, and a passing 22-turn long-reference acceptance fixture.
- M8 verified Vietnamese language pack: direct Vietnamese↔JSG parsing/realization, bilingual semantic-equivalence corpus, language-specific classifier/aspect/address behavior, and the shared Section-251 HumanLanguagePack ABI for English/Vietnamese.
- M9 verified multilingual semantic gate: independent English/Vietnamese G→surface→G round trips, resolved-reference and instruction-as-content JSG structures, and dimension-level diagnostics for predicate/roles/polarity/modality/quantity/time/condition/causality/attribution/reference/instruction content.
- M10 verified Program IR: backend-neutral graph/model with modules, symbols, expanded types/expressions/statements, contracts/effects, typed holes, source bindings, atomic transactions, deterministic validation/serialization, derived CFG/def-use analysis and all eight required corpus fixtures.
- M11 verified synthesis core: typed expression/statement holes, six generator families, deterministic hard pruning, best-first/beam frontiers, state deduplication, bounded search budgets, bounded recorded-Jev ranking, acceptance verifiers, structured partial failures and traceable multi-step composition.
- M12 verified TypeScript backend: backend ABI/manifest, compiler-API parser, AST↔PIR subset, source bindings, AST/source printer, minimal patching, normalized diagnostics, strict typecheck adapter and conformance over the M12 source subset plus the verified M10 PIR corpus.\n- M13 Python backend candidate: stdlib AST parse/unparse, optional annotations with dynamic unknowns, AST↔PIR subset, mapping-safe record lowering, source bindings/patches, normalized compile diagnostics and TypeScript/Python cross-backend PIR semantic fixtures.
- Graph-structured Discourse IR foundation with deterministic prerequisite-aware ordering.
- Formal IR family foundation (Data/Schema/Query/Math/Logic/Command), capability-validated Action IR, and harness-neutral Universal Expression contract.
- Registry-driven Universal Expression runtime plus trace DAG/config-digest/replay-manifest foundation.
- Controlled M16 same-JSG path: English/Vietnamese text, structured-data IR, and declared Action IR from one semantic requirement graph.
- M17 verifier foundation: semantic round-trip with parser-limit unknowns, conservative trust/provenance checks, requirement reports, grammar evidence normalization, and compile/test evidence normalization.

## Still partial by design

The master specification is much broader than the bootstrap wave. Broad NLU/NLG, full dialogue/pragmatics, full Vietnamese grammar, compiler-backed CEGIS, code patching/repair, richer formal backends, broader M16 multi-target coverage beyond the controlled semantic subset and concrete program adapters, broader verifier orchestration/provenance edge cases, full conformance matrix and research-expansion tasks remain open. Package stubs say `NOT_IMPLEMENTED` or `PARTIAL` rather than pretending they exist.

## Quota policy

Live Jev calls are not part of push/PR CI. M3 used exactly one explicitly isolated live smoke request: model `jev-1.13.0`, 356 input tokens, 26 output tokens, SDK retry `0`. The temporary trigger was removed after the successful run, and ordinary deterministic development remains at zero live requests.

## Completion semantics

`implemented` means source exists. `verified` means the relevant automated gate passed. Recorded Jev behavior is never reported as live success, and a narrow vertical slice is never reported as broad capability coverage.
