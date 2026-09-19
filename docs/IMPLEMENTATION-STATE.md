# Implementation State

```yaml
spec_version: 0.4-master-implementation-research-expanded
spec_digest_sha256: 9b8bc907fa0da89d4b7ea2e0be886919deffdb35e398ea7897ea77d305380f5b
last_completed_gate: M18.2-grammar-parser-expansion
active_milestone: M18-open-world-language-expansion
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
  - extension-core
partial_vertical_slices:
  - controlled-English-requirement-roundtrip
  - recorded-Jev-reference-choice
  - controlled-Vietnamese-shared-JSG
  - PIR-typed-hole-to-TypeScript
  - formal-action-universal-contract
  - m16-controlled-multitarget
  - m17-verification-hardening
  - m18-open-world-lexicon-code-switch
  - m4-controlled-parser-foundation
  - m5-controlled-realizer-roundtrip
  - m6-discourse-naturalness-foundation
  - m7-dialogue-semantics
  - m8-vietnamese-language-pack
  - m10-program-ir
  - m11-synthesis-core
  - m12-typescript-backend
  - m13-python-backend
  - m14-compiler-test-repair-loop
  - m16-universal-expression-api
  - t268-t275-extension-framework
  - t301-t310-graph-topology
  - t311-t320-scope-quantification
  - t331-t340-deixis-attitudes-evidence
  - t341-t350-presupposition-pragmatics
  - t351-t360-comparison-quantity-space-candidate
  - t361-t370-questions-dialogue-acts-candidate
  - t371-t380-reference-ellipsis-candidate
known_failures: []
blocked_items: []
next_tasks:
  - verify and merge T351-T360, T361-T370, then T371-T380 deterministic gates
  - continue T381-T390 discourse/information structure after reference/ellipsis verification
  - continue M18 language expansion beyond the verified grammar/parser wave
  - expand M16 multi-target adapters beyond the controlled delete-limit semantic subset
last_verified_main_commit: 852fdaff04f07be7eb3f5e2c34f329ef24b0bff5
last_verified_pr_head: cd8aa283610013c74757a8afa99549d0a9f9e383
```

## Current state

M0–M9 are verified at their milestone gates. M3 includes the required one-request live Jev acceptance run; M4–M9 use deterministic/recorded language-engine evidence. M9 passed CI #136 with 36/36 test files and 280/280 tests. M10 Program IR and M11 Synthesis Core are verified. M12 TypeScript Backend passed CI #155 with 39/39 test files and 312/312 tests. M13 Python Backend passed CI #167 with 40/40 test files and 319/319 tests. M14 Compiler/Test Repair Loop passed CI #182 with 41/41 test files and 325/325 tests. M15 Formal/Data/Action IR passed CI #191 with 42/42 test files and 334/334 tests. M16 Universal Expression API is verified. M17 Verification Hardening passed CI #202 and is verified. M18.1 is verified, and M18.2 grammar/parser expansion passed CI #218 with 45/45 test files and 368/368 tests before merge commit `d6d7c19`; M18 Open-world Language Expansion remains the active milestone. The cross-cutting T268-T275 extension foundation passed CI #235 with 47/47 test files and 386/386 tests; package boundaries and strict TypeScript typecheck also passed, with zero live Jev requests. T276-T288 evaluation foundation passed CI #246 with 48/48 test files and 404/404 tests after a real T286 repair-loop benchmark exposed and fixed an inline-return patch-boundary bug; merged main then passed CI #247. T289-T296 hardening passed CI with 51/51 test files and 413/413 tests and merged to main. T297-T300 performance/cache/cancellation/crash/release hardening then passed CI with 52/52 test files and 417/417 tests; merged main commit `153986e` passed the same deterministic gate. Both waves used zero live Jev requests. T301-T310 graph topology passed CI with 54/54 test files and 427/427 tests, with boundaries/typecheck green and zero live Jev requests. T311-T320 scope/quantification and T321-T330 event/time/modality are verified on main. T331-T340 deixis/attitudes/evidence passed deterministic CI with 57/57 test files and 453/453 tests and merged to main commit `852fdaff`; merged main also passed. T341-T350 presupposition/pragmatics passed deterministic CI with 58/58 test files and 461/461 tests and merged as `1472e87`; its main push gate is queued while this next wave is built. T351-T360 comparison/quantity/space is implemented on the active branch and remains candidate until its own deterministic gate passes. T361-T370 questions/dialogue acts is implemented on the stacked branch and remains candidate until deterministic CI verifies its semantic contract and repair benchmark. T371-T380 reference/ellipsis is implemented on the next stacked branch with deterministic pruning, ambiguity preservation, reconstructed-origin provenance and stress-corpus coverage; verification is pending.

## Implemented foundation

- Strict TypeScript / Node 20+ baseline.
- Machine-readable package maturity/dependency DAG plus source-import boundary enforcement.
- Structured Result/Error, semantic IDs, versions, trust/sensitivity labels, canonical JSON and SHA-256 digest utilities.
- Provenance records/store.
- Open-world source spans, normalization maps, stale-span detection, numeric/quantity/temporal/path/URL/email/filename literals, opaque integrity validation, sensitivity/redaction, and secret-safe state projection.
- Ontology namespace/store, expanded reusable core primitive inventory, provisional concepts, compositional concepts, domain/range traversal, transactional merge, and deprecation/alias handling.
- JSG typed node/value algebra, atomic transactions, revisions, canonical serialization/deserialization, restore, semantic diff/query, and the verified V0–V8 staged semantic-validation pipeline with ontology domain/range/cardinality, scope/binding, invariant, provenance/trust, stable-diagnostic and profile-validation hooks.
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
- M12 verified TypeScript backend: backend ABI/manifest, compiler-API parser, AST↔PIR subset, source bindings, AST/source printer, minimal patching, normalized diagnostics, strict typecheck adapter and conformance over the M12 source subset plus the verified M10 PIR corpus.\n- M13 verified Python backend: stdlib AST parse/unparse, optional annotations with dynamic unknowns, AST↔PIR subset, mapping-safe record lowering, source bindings/patches, normalized compile diagnostics, all-eight M10 lower/compile proof and TypeScript/Python cross-backend PIR semantic fixtures.
- M14 verified compiler/test repair loop: stable repair diagnostics, implicated-node location, bounded guard/import/argument/return repair generators, bounded candidate ranking, compile/test/regression verification, rollback, hard budgets and executable broken-code acceptance.
- M15 verified formal/data/action IR: stable Data/Schema/Query/Math/Logic/Command/Action schemas, deterministic validators, canonical renderers, read-vs-mutation query safety, declared-capability Action IR validation and seven-family conformance.
- Graph-structured Discourse IR foundation with deterministic prerequisite-aware ordering.
- Formal IR family foundation (Data/Schema/Query/Math/Logic/Command), capability-validated Action IR, and harness-neutral Universal Expression contract.
- Registry-driven Universal Expression runtime plus trace DAG/config-digest/replay-manifest foundation.
- M16 verified Universal Expression API: harness-neutral parse/realize/express/transform/verify runtime, capability discovery, same-JSG natural-language/structured-data/PIR-program/declared-Action realization, and trace/replay evidence.
- M17 verifier foundation: semantic round-trip with parser-limit unknowns, conservative trust/provenance checks, requirement reports, grammar evidence normalization, and compile/test evidence normalization.\n- M17 verified verification hardening: registry orchestration, provenance ancestry integrity, deterministic conflict handling, evidence-floor grading, and replay bundles bound to raw/authoritative result digests.
- M18.1 verified: Section-209 open-world lexical resolver, EN/VI code-switch evidence, provisional lexical-sense proposals, exact unknown-term preservation and explicit borrowing policy. T098-T106 passed CI #207.
- M18.2 verified: typed grammar features/categories, GrammarRule-driven packed chart parser, expanded English controlled syntax T110-T119, lexical/morphology grammar evidence and conservative syntax-to-JSG bridging. T107-T120 passed CI #218 with 45/45 test files and 368/368 tests; live Jev requests: 0.\n- M1 validator completion verified: T026-T035 now provide V0–V8 staged validation, stable diagnostic registry, invariant registration/bundle, ontology domain/range/cardinality checks, scope/binding validation and provenance/trust closure. CI #226 passed 46/46 test files and 378/378 tests; live Jev requests: 0.
- T268-T275 extension foundation verified: runtime-validated extension manifests, duplicate-safe dependency registry, spec-compatible version ranges for engine/semantic-schema/ontology-core/PIR, language/backend/verifier conformance runners, transactional ontology/domain-pack loading, and capability-minimal isolation admission. CI #235 passed 47/47 test files and 386/386 tests; live Jev requests: 0.\n- T276-T288 evaluation foundation verified: reproducible dataset manifests, deterministic benchmark runner, candidate-recall/calibration reporters, semantic/NLU/NLG/dialogue/multilingual/synthesis/repair benchmark reports, zero-generative audit, and replay-manifest generation. CI #246 passed 48/48 test files and 404/404 tests; the T286 executable repair benchmark also produced a regression fix for one-line return-expression patch boundaries. Main merge CI #247 passed.\n- T289-T296 hardening verified: deterministic fuzz-smoke coverage for JSG deserialization, normalization/spans, syntax forests and patch application; canonicalization/transaction properties; adversarial trust escalation and credential redaction tests. CI passed 51/51 test files and 413/413 tests; live Jev requests: 0.\n- T297-T300 bootstrap release hardening verified: deterministic performance recorder with percentile summaries, cache key/copy-isolation/stale-request correctness, cancellation and crash normalization coverage, and an evidence-bound release conformance report that blocks unverified tasks, red CI, incomplete tests, generative violations, known failures, or blocked items. CI passed 52/52 test files and 417/417 tests; merged main commit `153986e` passed the same deterministic suite; live Jev requests: 0.

- T301-T310 graph topology verified: canonical graph-view/projector APIs, reentrant shared-node analysis, explicit MentionNode/entity separation and mention indexes, provisional disconnected graph fragments with deterministic merge diagnostics, explicit cycle-permission registry/enforcement, and bounded topology property tests. CI passed 54/54 test files and 427/427 tests with package boundaries and strict typecheck green; live Jev requests: 0.

- T311-T320 scope/quantification verified: explicit ScopeNode/ScopeConstraintNode, unresolved relative scope, generalized QuantifierNode/cardinality/distributivity semantics, explicit negation scope, staged scope validation, evidence-tier resolution pipeline, ambiguity-preserving generation filtering, and an adversarial executable benchmark. CI passed 55/55 test files and 436/436 tests with boundaries/typecheck green; merged main commit `304c2ca` passed deterministic CI; live Jev requests: 0.

- T321-T330 event/time/modality/conditionals verified: refined event/process/transition/achievement/activity ontology, explicit event-token versus event-class semantics, temporal object registry with interval-relation constraints, language-pack tense/time separation and aspect mapping ABI, dimensioned/ordinal modality with separate calibrated probability, conditional variants and counterfactual metadata, runtime boundary validation, semantic-preservation checks, and a deterministic adversarial benchmark. After correcting a round-trip test that incorrectly assumed insertion-order preservation instead of canonical node ordering, CI passed 56/56 test files and 445/445 tests with package boundaries and strict typecheck green; live Jev requests: 0.

## Still partial by design

The master specification is much broader than the bootstrap wave. Broad NLU/NLG, full dialogue/pragmatics, full Vietnamese grammar, repair beyond the verified bounded M14 families, richer formal backends, broader M16 multi-target coverage beyond the controlled semantic subset and concrete program adapters, broader verifier orchestration/provenance edge cases, full conformance matrix and research-expansion tasks remain open. Package stubs say `NOT_IMPLEMENTED` or `PARTIAL` rather than pretending they exist.

## Quota policy

Live Jev calls are not part of push/PR CI. M3 used exactly one explicitly isolated live smoke request: model `jev-1.13.0`, 356 input tokens, 26 output tokens, SDK retry `0`. The temporary trigger was removed after the successful run, and ordinary deterministic development remains at zero live requests.

## Completion semantics

`implemented` means source exists. `verified` means the relevant automated gate passed. Recorded Jev behavior is never reported as live success, and a narrow vertical slice is never reported as broad capability coverage.


- T331-T340 deixis/attitudes/evidence verified: serializable Deictic/Quotation/Attitude ContextNode frames, explicit person/spatial/temporal/discourse/social deictic references, deterministic deictic resolution, nested quotation context stack, direct-vs-indirect speech exactness rules, propositional-attitude isolation from global assertions, first-class evidential source modes kept separate from node confidence and provenance, context-aware graph topology/cycle permissions, semantic-preservation checks, nested-attribution tests and a deterministic deictic-shift/quotation benchmark. CI passed 57/57 test files and 453/453 tests with package boundaries and strict typecheck green; live Jev requests: 0.
