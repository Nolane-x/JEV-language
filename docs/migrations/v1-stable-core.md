# v1 Stable-Core Migration Policy

Applies to stable packages `core-types` and `provenance`.

## Versioning

Package ABI and stable serialized schemas use semantic versions.

- patch: bug fixes that do not change stable observable contracts;
- minor: backward-compatible additions;
- major: incompatible API or schema changes.

A stable schema may evolve independently from package ABI, but every incompatible serialized-form change requires a schema-major increment and a migration entry.

## 0.x → 1.0

The first stable-core promotion does not intentionally rename existing public exports or serialized fields.

New normative version exports are added:

- `CORE_TYPES_PACKAGE_VERSION`
- `CORE_TYPES_ABI_VERSION`
- `CORE_TYPES_SCHEMA_VERSIONS`
- `PROVENANCE_PACKAGE_VERSION`
- `PROVENANCE_ABI_VERSION`
- `PROVENANCE_SCHEMA_VERSIONS`

Existing consumers may continue using the prior APIs. Consumers that persist ResultEnvelope or ProvenanceRecord data should store the corresponding schema release version beside persisted artifacts.

## Future incompatible changes

A future incompatible change MUST:

1. increment the relevant major version;
2. document old/new schemas and transformation semantics;
3. add executable migration fixtures;
4. preserve replay evidence for pre-migration inputs;
5. never silently reinterpret trust/provenance fields.
