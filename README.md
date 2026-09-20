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

## Playground

A zero-install browser Playground is deployed at:

https://nolane-x.github.io/JEV-language/

It is a static GitHub Pages BYOK surface: users supply their own TypeSafe key, which stays in tab memory only. The current UI routes bounded yes/no and explicit-choice prompts through Jev and keeps unsupported free-form generation explicit rather than hiding another generator behind the chat surface.

The NUI-driven interface uses an obsidian/editorial-instrument visual thesis with a warm-metal inspection-light field that follows the pointer, plus coarse-pointer and reduced-motion fallbacks. Provider success payloads are validated before rendering.

The static Pages shell was previously deployment-verified. A browser-equivalent preflight probe on 2026-09-20 then proved that direct TypeSafe requests from the GitHub Pages origin are blocked by the provider's current CORS policy. PR #70 therefore added an explicit self-hosted relay transport; the deployed relay is now the Playground default. The relay was subsequently live-verified with the existing `TYPESAFE_API_KEY` GitHub secret: exactly one authenticated `/v1/systemone` request traversed the verified Worker, returned `X-JEV-Relay: 1`, preserved the GitHub Pages CORS origin, and produced a valid `jev-1.13.0` Noul response. Sanitized evidence is committed at `docs/evidence/PLAYGROUND-RELAY-LIVE-SMOKE.json`; the API key itself was not printed or persisted.

## Security

Never commit API keys, credentials, opaque secret payloads, or live traces containing them. A typed interface guarantees structure—not truth—so capability claims require evidence from conformance/evaluation.

## v1 stable-core profile

The first stable ABI profile covers `core-types` and `provenance`. Its machine-readable evidence lives in `docs/v1.0-conformance.json`; API references, migration policy, benchmark baseline, limitations and an executable zero-generative replay demo are checked by the M20 conformance suite.

Useful commands:

```bash
npm run test:v1-conformance
npm run demo:v1-stable-core
```

This stable-core profile does not imply that every package is stable. Language, synthesis, backend and other research packages retain their explicit lower maturity levels until separately promoted.

## Status

The T001–T500 engineering task sequence and v0.4 release gates are verified. M19 blinded natural-conversation protocol tooling is implemented, but the research milestone still requires real human ratings. M20 v1 stable-core conformance passed deterministic CI with 77/77 test files and 624/624 tests; no synthetic human ratings are used to close M19.
