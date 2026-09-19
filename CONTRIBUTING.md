# Contributing

JEV Language is a research-grade semantic system. Correctness and auditability take priority over surface breadth.

## Required change discipline

1. Preserve the package dependency DAG.
2. Do not add a generative-LLM dependency to the native core.
3. Deterministic rules must decide deterministic facts.
4. Every new semantic/grammar/PIR rule ships with tests.
5. Serialized contract changes require compatibility/migration notes.
6. New Jev decisions belong in versioned decision packs.
7. Live Jev calls must never be required for deterministic CI.
8. Keep `docs/IMPLEMENTATION-STATE.md` and `docs/TASK-LEDGER.yaml` truthful.

## Rule metadata

Substantial rules should record a stable ID, purpose, examples/counterexamples, tests, and introduction version.

## Live API budget

Do not run broad live evaluations from pull requests. Recorded mode is the default. The manual live smoke workflow is intentionally hard-limited.
