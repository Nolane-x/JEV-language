# ADR-0002 — Recorded-first Jev and live quota guard

- Status: accepted
- Date: 2026-09-19

## Context

The specification requires both deterministic record/replay and a live Jev smoke gate. Live calls consume the owner's API budget and must not be triggered accidentally by ordinary development.

## Decision

1. Push/PR CI never receives `TYPESAFE_API_KEY`.
2. Live Jev evaluation exists only in a manually dispatched workflow.
3. The smoke script refuses to run unless `JEV_ALLOW_LIVE=1`.
4. Bootstrap live smoke performs one `systemOne` request containing one narrow Noul question.
5. SDK retry is set to zero for the smoke path.
6. SDK token usage is printed for accounting.
7. Recorded adapters are the default for deterministic tests.

## Alternatives considered

- Live Jev on every push.
- Allow broad live evals with only a warning.
- Mock-only testing with no live gate.

## Consequences

Normal development is quota-safe and reproducible. A human can still verify the real provider contract deliberately.

## Spec sections affected

185-200, 407-408, 584, 592.

## Evidence/tests

Recorded JDR tests plus the manual `JEV Live Smoke` workflow.
