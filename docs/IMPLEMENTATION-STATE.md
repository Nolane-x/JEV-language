# Implementation State

```yaml
spec_version: 0.4-master-implementation-research-expanded
spec_digest_sha256: 9b8bc907fa0da89d4b7ea2e0be886919deffdb35e398ea7897ea77d305380f5b
last_completed_gate: none
active_milestone: M5-M6-language-foundation
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
  - grounding
  - parser-core
  - lexicon-core
  - morphology-core
  - grammar-core
  - language-en
partial_vertical_slices:
  - controlled-English-requirement-roundtrip
  - recorded-Jev-reference-choice
  - controlled-Vietnamese-shared-JSG
  - PIR-typed-hole-to-TypeScript
known_failures: []
blocked_items:
  - live-Jev-smoke-not-yet-executed
next_tasks:
  - implement T096 recorded-first Jev ambiguity resolver before any live calibration
  - implement T120 semantic construction from supported English syntax into JSG
  - continue T121+ discourse/realizer foundations without overstating broad NLG
  - complete remaining M1 staged semantic validators and graph operations
  - build M3 calibration fixtures/report before candidate quality claim
  - complete remaining verifier adapters T262-T266
  - continue formal IR/universal expression T239-T258
  - run exactly one manual live-Jev smoke only when explicitly desired
last_verified_main_commit: 4a9e5e7c63fd113d912253ea2d73e6a0fbf9e0fd
last_verified_pr_head: d6d6b6fb957169277b2a740a4eade8189a8b2bb3
```

## Current state

A runnable foundation now exists, but this ledger deliberately does **not** mark a milestone complete before the current hardening PR passes its deterministic gate. The last verified `main` commit above passed install, package-boundary checks, strict TypeScript, and tests on GitHub Actions.

## Implemented foundation

- Strict TypeScript / Node 20+ baseline.
- Machine-readable package maturity/dependency DAG plus source-import boundary enforcement.
- Structured Result/Error, semantic IDs, versions, trust/sensitivity labels, canonical JSON and SHA-256 digest utilities.
- Provenance records/store.
- Open-world source spans, stale-span detection, deterministic literal recognition, opaque-value sensitivity and redaction.
- Ontology namespace/store/core seed/provisional concepts.
- JSG typed node/value algebra, atomic transactions, revisions, canonical serialization/deserialization, restore, semantic diff/query and staged foundation validation.
- Recorded and TypeSafe JDR adapters, normalized typed answers, request budgets, cache, calibration hook, structured errors and token usage accounting.
- Decision-pack registry and lifecycle contract, with evidence-based candidate/production maturity gates.
- JDR request/token budgets, deterministic trace events, cache accounting, and calibration hooks.
- Ontology transactional batch merge, parent-cycle rejection, ancestry queries, deprecation/replacement resolution, and replacement-cycle rejection.
- Generic VerificationObligation/Verifier ABI, evidence grading, deterministic-verifier precedence, and critical semantic-preservation checks including role bindings and temporal values.
- TypeScript 7 CLI compatibility with the official TypeScript 6 programmatic compiler API bridge for embedded compile checks.
- M4 reversible grounding pipeline: normalization/source mapping, segmentation, tokenization, language-span/literal/lexicon-provider ABIs, packed parse forests, ambiguity registry, and validated JSG parse commits.
- Consolidated M5 lexical substrate: typed Lexeme/LexicalSense→Concept contracts, semantic valency, collocations, structured MWE semantics, exact+normalized unknown preservation, and language-neutral lookup/indexing.
- M5 deterministic English morphology subset behind a language-neutral lexeme-id-based MorphologyProvider ABI.
- M6 grammar foundation: typed GrammarRule/constraint/realization-plan registry plus controlled English NP, clause, modal-negation, coordination, conditional, causal, quantity, and WH-question inventory. Broad English syntax and T120 syntax→JSG construction remain partial/open.
- First four narrow vertical slices required by the bootstrap sequence: controlled English, recorded reference choice, controlled Vietnamese, and PIR typed-hole → TypeScript.

## Still partial by design

The master specification is much broader than the implemented waves. Broad NLU/NLG, T096 Jev ambiguity resolution, T120 grammar semantic construction, discourse/pragmatics, full Vietnamese grammar, full PIR/search/CEGIS, code patching/repair, formal IRs, universal expression API, remaining verifier adapters, full conformance matrix and research-expansion tasks remain open. Package stubs say `NOT_IMPLEMENTED` or `PARTIAL` rather than pretending they exist.

## Quota policy

Live Jev calls are not part of push/PR CI. The manual live smoke is hard-limited to one request containing one narrow question, uses SDK retry `0`, and reports SDK token usage. The current implementation wave has consumed **zero live Jev requests**.

## Completion semantics

`implemented` means source exists. `verified` means the relevant automated gate passed. Recorded Jev behavior is never reported as live success, and a narrow vertical slice is never reported as broad capability coverage.
