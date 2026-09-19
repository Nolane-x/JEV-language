# JEV Language

**Universal Semantic, Language, Programming, and Expression Substrate for Jev**

JEV Language is a harness-neutral, semantic-first substrate that turns bounded typed Jev judgments into increasingly general expression through explicit semantic representations, composition, deterministic compilation, search, and verification.

## Core invariants

- Zero generative-LLM calls are required by the core path.
- Meaning is represented independently from surface wording.
- Deterministic rules dominate probabilistic preferences.
- Unknowns and ambiguity are preserved explicitly rather than guessed.
- Provenance, trust, replay, and verification are first-class.
- Jev is used for bounded semantic judgment, not hidden free-form generation.
- Downstream harnesses own execution, permissions, scheduling, UI, and agent loops.

## Current implementation

The repository is being bootstrapped from the **JEV LANGUAGE Universal Semantic, Language, Programming, and Expression Substrate — master implementation specification v0.4**.

The first implementation wave targets:

1. M0 repository/contracts.
2. M1 semantic graph foundation.
3. M2 ontology/open-world values foundation.
4. M3 Jev Decision Runtime in recorded-first mode.
5. A narrow controlled-language vertical slice proving parse → JSG → realize → verify.

Live Jev evaluation is intentionally isolated from ordinary CI to protect API quota.

See [docs/IMPLEMENTATION-STATE.md](docs/IMPLEMENTATION-STATE.md) for the authoritative progress ledger once bootstrap lands.

## Security

Never commit a TypeSafe API key. Live workflows read `TYPESAFE_API_KEY` from GitHub Actions secrets and are manual-only.

## Status

Early implementation. Capability claims are valid only when backed by conformance tests and the implementation-state ledger.
