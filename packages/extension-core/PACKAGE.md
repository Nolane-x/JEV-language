# extension-core

Status: **prototype / T268-T275 candidate pending conformance CI**.

This package implements the harness-neutral Jev Language extension substrate described by the v0.4 master specification. It is admission/compatibility/conformance infrastructure, not an agent-plugin runtime and not an action executor.

Implemented scope:

- T268: versioned `ExtensionManifest` covering ontology packs, language packs, lexicon packs, programming/formal backends, parser/verifier plugins, decision packs and domain packs;
- T269: deterministic `ExtensionRegistry` with dependency/version checks and dependency ordering;
- T270: strict semver parsing plus exact/caret/tilde/comparator/wildcard compatibility checks for engine, semantic-schema, PIR and extension dependencies;
- T271: language-pack conformance runner with the minimum required probe inventory from the master specification;
- T272: programming-backend conformance runner with required backend probes;
- T273: asynchronous verifier conformance runner that checks manifest/result identity and expected verification status;
- T274: functional ontology/domain-pack loader that returns a staged ontology and rejects namespace escape, unknown signature concepts and overwrites;
- T275: declarative extension-isolation admission checks. Direct core mutation is forbidden, domain/ontology packs are not implicitly trusted for action execution, and all host effects require explicit host permission.

Important boundary: these checks do **not** claim to provide an operating-system sandbox. They prevent undeclared/forbidden capabilities from being admitted through the Jev Language extension registry. A downstream host that chooses to execute third-party code remains responsible for process/container/WASM isolation appropriate to its environment.

The package contains no harness lifecycle, scheduling, browser policy, shell permissions or hidden generative-model fallback.
