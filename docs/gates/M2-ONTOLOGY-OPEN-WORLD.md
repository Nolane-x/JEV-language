# M2 — Ontology and Open-World Gate Evidence

Status: **verified**

Specification basis: sections 405–406, 173–179, and bootstrap tasks T036–T059 of the v0.4 master specification.

## Definition-of-Done evidence

| Requirement | Evidence |
| --- | --- |
| core ontology schema | `ConceptDefinition`, `ConceptKind`, `ConceptConstraint` |
| reusable primitive inventory | `createCoreOntology()` seeds entity/object/time/quantity/information/state/event/action/change/cause/condition/modality/truth/unknown families |
| namespace registry | `NamespaceRegistry` collision-safe ownership |
| provisional concepts | `provisionalConcept()` with explicit provisional namespace/status |
| concept composition | `ConceptComposition`, `OntologyStore.composeConcept()` |
| parent/type traversal | `isA()`, `ancestorsOf()` |
| domain/range queries | `relationDomain()`, `relationRange()` |
| ontology transaction | `mergeConcepts()` with all-or-nothing validation and parent-cycle rejection |
| deprecation/aliases | `deprecateConcept()`, `resolveConcept()` |
| source spans | `SpanRef`, `makeUtf16Span()`, `resolveUtf16Span()` |
| normalization edit maps | `normalizeGroundingSource()`, `mapNormalizedRangeToSourceSpan()` and M4 conformance |
| opaque registry | `OpaqueValueRegistry`, `InMemoryOpaqueValueRegistry` |
| exact opaque integrity | `validate()` detects missing/digest/sensitivity mismatches |
| sensitivity/redaction | read policy, `opaqueRedaction()`, `projectOpaqueToState()` |
| numeric values | deterministic numeric literal parser |
| quantity/unit values | `QuantityValue`, `parseQuantityLiteral()` |
| temporal values | `TemporalLiteralValue`, `parseTemporalLiteral()` |
| path/URL/email/filename values | deterministic literal classifier |
| constructed strings | `ConstructionPlan` |
| trust/sensitivity labels | core `TrustLabel` / `SensitivityLabel` contracts |
| ontology validation | ID, parent, merge-cycle, replacement-cycle, composition component/relation/target checks |

## Required acceptance cases

`tests/conformance/m2-open-world.conformance.test.ts` covers:

- an unknown project-specific source name retained by exact span;
- a new technical term retained as a provisional concept;
- an unknown filename retained as a filename literal;
- a secret-like value retained by opaque reference;
- reusable core ontology families;
- composition from existing semantic primitives instead of inventing a new meaning.

## Required failure cases

| Failure case | Expected evidence |
| --- | --- |
| stale span | `OWV_STALE_SPAN` / failed span resolution |
| opaque digest mismatch | `OWV_OPAQUE_DIGEST_MISMATCH` |
| namespace collision | `ONTO_NAMESPACE_COLLISION` |
| provisional concept with invalid parent | `ONTO_INVALID_PARENT` |
| secret exposed to unauthorized state projection | `OWV_STATE_PROJECTION_DENIED`; diagnostic contains no secret content |
| unknown concept dropped | fixture proves exact provisional label + parent survives store round trip |

Additional ontology integrity cases cover parent cycles, replacement cycles, unknown composition components, and explicit alias/replacement resolution.

## Verification rule

Verified evidence:

- branch head: `9eadcdc0bb2e581c09748df2eb71de965a6022a1`
- GitHub Actions CI: run `#76` / run id `35420197439`
- result: `success`
- deterministic gate: package boundaries → strict typecheck → full test suite

The implementation-state ledger may therefore advance to M3 Jev Decision Runtime verification. The final documentation commit must itself pass CI before merge.
