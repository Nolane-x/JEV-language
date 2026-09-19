# JEV Language

**Universal Semantic, Language, Programming, and Expression Substrate for Jev**

JEV Language is a harness-neutral, semantic-first substrate that turns bounded typed Jev judgments into increasingly general expression through explicit semantic representations, composition, deterministic compilation, search, and verification.

> **Core experiment:** can a model that emits bounded typed judgments gain broad expressive power by operating over a compositional semantic substrate whose outputs are compiled and verified afterward?

## Architectural invariants

- The native core requires **zero generative-LLM calls**.
- Meaning is canonicalized independently from surface wording.
- Deterministic rules dominate probabilistic preferences.
- Unknowns and ambiguity are preserved explicitly rather than guessed.
- Provenance, trust, replay, validation and verification are first-class.
- Jev is used for bounded semantic judgment, not hidden free-form generation.
- Exact external strings travel through source spans / opaque values / deterministic constructions, not semantic control-channel hacks.
- Downstream harnesses own execution, permissions, scheduling, UI and agent loops.

## What is runnable now

The bootstrap implementation already includes:

- strict TypeScript + machine-checked package dependency boundaries;
- typed IDs, structured errors, canonical JSON, provenance and digests;
- JSG node/value algebra, graph transactions, serialization, restore, query and semantic diff;
- open-world spans, stale-reference detection, deterministic literal parsing and opaque sensitivity controls;
- ontology namespaces/core seed/provisional concepts;
- Jev Decision Runtime with recorded and official TypeSafe SDK adapters, budgets, cache, calibration hooks and usage accounting;
- versioned decision-pack registry;
- a controlled English parse → JSG → alternate realization → semantic round-trip verifier;
- recorded Jev Choice reference resolution that preserves ambiguity under low confidence;
- a controlled Vietnamese path that maps directly to the shared JSG and realizes from the same semantics;
- an initial Program IR with typed holes, type-guided filter synthesis, deterministic TypeScript lowering and compiler diagnostics.

These are **narrow, tested vertical slices**, not claims that broad language/code generation is already complete.

## Repository map

```text
packages/
  core-types/           foundational typed contracts
  provenance/           origin/trust records
  open-world-values/    source spans, opaque values, deterministic literals
  ontology/             concept/role/namespace infrastructure
  semantic-graph/       JSG
  semantic-validator/   semantic invariants
  decision-runtime/     JDR + TypeSafe/recorded adapters
  decision-packs/       versioned Jev judgments
  grounding/            deterministic controlled grounding
  dialogue-state/       dialogue/reference semantics (partial)
  realizer-core/        deterministic realization slices
  program-ir/           PIR (partial)
  synthesis-core/       typed-hole synthesis (partial)
  code-backend-core/    TypeScript lowering/compiler bridge (partial)
  ...
```

Unimplemented surfaces are materialized as explicit package stubs marked `NOT_IMPLEMENTED` or `PARTIAL`.

## Development

```bash
npm install
npm run check
npm run benchmark
```

Ordinary CI runs only deterministic/recorded tests and never receives the TypeSafe key.

## TypeSafe / Jev quota safety

Store the API key only as the GitHub Actions secret:

```text
TYPESAFE_API_KEY
```

The `JEV Live Smoke` workflow is **manual-only**, requires an explicit `YES`, is hard-limited to **one request / one question**, sets SDK retries to zero, and prints TypeSafe-reported token usage. Broad live evaluations must be added deliberately with separate budgets.

## Specification and state

- [SPEC-PIN.md](SPEC-PIN.md) pins the supplied v0.4 master specification and digest.
- [docs/IMPLEMENTATION-STATE.md](docs/IMPLEMENTATION-STATE.md) is the authoritative progress snapshot.
- [docs/TASK-LEDGER.yaml](docs/TASK-LEDGER.yaml) tracks implementation status without fake completion.
- [docs/adr/](docs/adr/) records architectural decisions.

## Security

Never commit API keys, credentials, opaque secret payloads, or live traces containing them. A typed interface guarantees structure—not truth—so capability claims require evidence from conformance/evaluation.

## Status

Research implementation in active development. The foundation is runnable; the complete 16k-line master specification is **not** yet fully implemented.
