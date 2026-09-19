# extension-core

Status: **prototype / T268-T275 verified extension foundation**.

This package implements the harness-neutral Jev Language extension substrate described by the v0.4 master specification. It is admission/compatibility/conformance infrastructure, not an agent-plugin runtime and not an action executor.

Implemented scope:

- T268: runtime-validated, versioned `ExtensionManifest` covering ontology packs, language packs, lexicon packs, candidate generators, programming/formal/expression backends, parser/verifier plugins, decision packs and domain packs;
- T269: deterministic `ExtensionRegistry` with dependency/version checks and dependency ordering;
- T270: strict extension versions plus partial/exact/caret/tilde/comparator/wildcard compatibility ranges for engine, semantic schema, ontology core, PIR and extension dependencies, including spec-style ranges such as `>=0.3 <0.4`;
- T271: language-pack conformance runner with the minimum required probe inventory from the master specification;
- T272: programming-backend conformance runner with required backend probes;
- T273: asynchronous verifier conformance runner that checks manifest/result identity and expected verification status;
- T274: functional ontology/domain-pack loader that returns a staged ontology and rejects namespace escape, unknown signature concepts and overwrites;
- T275: declarative extension-isolation admission checks. Direct core mutation is forbidden, domain/ontology packs are not implicitly trusted for action execution, and all host effects require explicit host permission.

Important boundary: these checks do **not** claim to provide an operating-system sandbox. They prevent undeclared/forbidden capabilities from being admitted through the Jev Language extension registry. A downstream host that chooses to execute third-party code remains responsible for process/container/WASM isolation appropriate to its environment.

The package contains no harness lifecycle, scheduling, browser policy, shell permissions or hidden generative-model fallback.

Verification evidence: GitHub CI #235 passed package-boundary validation, strict TypeScript typecheck, and 47/47 test files with 386/386 tests. The T268-T275 conformance suite consumes zero live Jev requests.
