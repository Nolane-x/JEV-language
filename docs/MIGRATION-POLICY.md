# Migration policy

This policy applies to public Jev Language schemas, ABIs, serialized artifacts, replay manifests, package APIs, and extension contracts.

## Version classes

- Patch: compatible bug fixes and evidence/documentation changes that do not change a public serialized shape.
- Minor: backward-compatible additive fields, capabilities, enum values only when readers have an explicit unknown-value policy, or new optional APIs.
- Major: removal, rename, semantic reinterpretation, required-field changes, incompatible enum behavior, or changes that invalidate previously valid serialized artifacts.

## Required migration evidence

An incompatible change must provide all of:

1. old and new version identifiers;
2. an explicit migration function or documented non-migratable boundary;
3. deterministic fixtures covering successful migration and rejected inputs;
4. provenance retaining source version and migration version;
5. replay metadata that records the version transition;
6. an ADR when semantics or trust boundaries change.

Silent reinterpretation is forbidden. If an artifact cannot be migrated without information loss, the migration result must fail or expose that loss explicitly.

## Deprecation

Deprecated public fields/APIs remain readable for at least one declared compatibility window unless a security or correctness defect requires faster removal. Deprecation notices must name the replacement and target removal version.

## Extensions

Extension manifests remain fail-fast. An extension outside engine/schema/PIR compatibility ranges may not partially load and may not receive undeclared effects.

## Release rule

A package may not be promoted to `stable` while it has an undocumented incompatible migration from any public version included in its declared compatibility window.
