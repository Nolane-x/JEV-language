# T268-T275 Extension Foundation Gate

Status: **verified**

Spec: `0.4-master-implementation-research-expanded`

## Scope

This gate verifies only T268-T275:

- T268 — versioned extension manifest with runtime-boundary validation;
- T269 — duplicate-safe registry, dependency validation and deterministic dependency ordering;
- T270 — version compatibility for engine, semantic schema, ontology core, PIR and extension dependencies;
- T271 — language-pack conformance runner;
- T272 — programming-backend conformance runner;
- T273 — verifier conformance runner;
- T274 — transactional ontology/domain-pack loader;
- T275 — capability-minimal extension isolation admission.

It does not claim completion of T276-T300, broad M18 language expansion, M19 natural-conversation research, or M20/v1.0 conformance.

## Architecture evidence

The extension core exposes explicit categories for ontology/domain/language/lexicon packs, candidate generators, decision packs, programming and expression backends, parser plugins and verifier plugins. Manifest validation is performed at the runtime boundary rather than trusting compile-time TypeScript types.

Compatibility accepts the partial semantic-version ranges used by the master specification, including `>=0.3 <0.4` and `>=0.2`, while extension package versions themselves remain strict semantic versions.

The ontology/domain loader stages changes into a new ontology store, rejects namespace escape/collision and known-definition overwrites, and never mutates the supplied base store on failure.

Isolation is capability-minimal: undeclared host effects are denied, direct core mutation is always rejected, and ontology/domain packs receive no implicit action-execution authority. This is an admission boundary, not an operating-system sandbox.

## Executable gate

GitHub Actions CI #235 / run `35445352016` on branch head `1c87c71b30027e61e911a85ccdb19d80cdfedf56` passed:

- package dependency/import boundary validation;
- strict TypeScript typecheck;
- 47/47 test files;
- 386/386 tests;
- the dedicated eight-case T268-T275 conformance suite;
- zero live Jev requests.

## Failure history retained as evidence

Earlier CI attempts were not hidden:

- CI #231 exposed a typed semantic-ID widening bug in the ontology loader;
- CI #234 exposed six extension conformance failures;
- root cause analysis identified incorrectly escaped regular-expression literals in semantic-version parsing;
- the implementation was corrected before this gate was marked verified.

This history is intentionally retained because the project completion rules require executable evidence rather than textual completion claims.

## Remaining boundaries

The following remain outside this gate:

- process/container/WASM sandboxing for arbitrary third-party code;
- extension distribution/signing/marketplace policy;
- T276-T300 evaluation and hardening;
- full conformance matrix and v0.4 research-expansion tasks;
- downstream harness lifecycle or action execution policy.
