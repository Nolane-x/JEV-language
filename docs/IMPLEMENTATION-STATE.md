# Implementation State

```yaml
spec_version: 0.4-master-implementation-research-expanded
spec_digest_sha256: 9b8bc907fa0da89d4b7ea2e0be886919deffdb35e398ea7897ea77d305380f5b
last_completed_gate: none
active_milestone: M0-verification
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
  - lexicon-core
  - morphology-core
partial_vertical_slices:
  - controlled-English-requirement-roundtrip
  - recorded-Jev-reference-choice
  - controlled-Vietnamese-shared-JSG
  - PIR-typed-hole-to-TypeScript
known_failures: []
blocked_items:
  - live-Jev-smoke-not-yet-executed
next_tasks:
  - complete remaining M1 staged semantic validators and graph operations
  - expand M2 ontology/open-world conformance beyond transactional evolution
  - build M3 calibration fixtures/report before candidate quality claim
  - implement T096 live/recorded Jev ambiguity resolver with strict budget
  - implement T107-T120 grammar categories/rules and controlled English syntax-to-JSG
  - complete remaining verifier adapters T262-T266
  - continue formal IR/universal expression T239-T258
  - run exactly one manual live-Jev smoke only when explicitly desired
last_verified_main_commit: 7dac106cdf08bc89be50833ed7dc4e7e6f5cd20e
last_verified_pr_head: 8e752001af62c7dc5caffd2cef15cce66cc48169
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
- M4 normalization/segmentation/tokenization/literal/language-span/packed-parser substrate and validated JSG parse commits; Jev ambiguity resolution remains open.
- M5 typed Lexeme/LexicalSense, valency/collocation contracts, language-neutral lexicon index, unknown-lexeme preservation, MWE matching, controlled English seed lexicon, and deterministic English morphology subset.
- First four narrow vertical slices required by the bootstrap sequence: controlled English, recorded reference choice, controlled Vietnamese, and PIR typed-hole → TypeScript.

## Still partial by design

The master specification is much broader than the bootstrap wave. Broad NLU/NLG, discourse/pragmatics, full Vietnamese grammar, full PIR/search/CEGIS, code patching/repair, formal IRs, universal expression API, remaining verifier adapters, full conformance matrix and research-expansion tasks remain open. Package stubs say `NOT_IMPLEMENTED` or `PARTIAL` rather than pretending they exist.

## Quota policy

Live Jev calls are not part of push/PR CI. The manual live smoke is hard-limited to one request containing one narrow question, uses SDK retry `0`, and reports SDK token usage. The current implementation wave has consumed **zero live Jev requests**.

## Completion semantics

`implemented` means source exists. `verified` means the relevant automated gate passed. Recorded Jev behavior is never reported as live success, and a narrow vertical slice is never reported as broad capability coverage.
