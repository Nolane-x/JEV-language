# Implementation State

```yaml
spec_version: 0.4-master-implementation-research-expanded
last_completed_gate: none
active_milestone: M0
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
  - verifier-core
known_failures: []
blocked_items: []
next_tasks:
  - verify M0 CI C0/C1
  - implement T005-T010 core foundation
  - implement T011-T035 JSG and validator
  - implement T036-T059 open-world and ontology
  - implement T060-T084 JDR and first decision pack
  - expand strict semantic-preservation invariants into conformance/property suites
last_verified_commit: null
```

## Current state

The repository is in bootstrap. This file is deliberately conservative: no milestone is marked complete until its required automated checks have run successfully on GitHub.

## Implemented in bootstrap contract layer

- Strict TypeScript and Node 20+ baseline.
- Central package maturity/dependency manifest.
- Deterministic package DAG/cycle guard.
- Structured task ledger.
- ADR process.
- Ordinary CI that never reads the TypeSafe secret.
- Manual live-Jev workflow separated from ordinary CI.
- Strict semantic-preservation verifier covering negation, quantities, unknown preservation, identity, attribution, conditions, modality, causal direction, temporal order, and exact payload preservation.

## Quota policy

Live Jev calls are not part of push/PR CI. The live smoke path defaults to one request and one question, has SDK retry disabled, and records SDK-reported token usage. Any broader live evaluation must be explicitly opted into and budgeted.

## Completion semantics

`implemented` means source exists. `verified` means the relevant automated gate passed. Mocked or recorded Jev behavior is never reported as live success.
