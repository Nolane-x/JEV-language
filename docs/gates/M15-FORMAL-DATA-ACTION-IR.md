# M15 — Formal / Data / Action IR Gate Evidence

Status: **verified**

Specification basis: Section 425 and tasks T239–T247 of the v0.4 master specification.

## Definition-of-Done mapping

| Task | IR family | Schema / validator evidence | Deterministic renderer |
| --- | --- | --- | --- |
| T239 | Data IR | `DataIr`, `validateDataIr()` | `renderDataIr()` |
| T240 | Schema IR | `SchemaIr`, `validateSchemaIr()` | `renderSchemaIr()` |
| T241 | Query IR | `QueryIr`, `validateQueryIr()` | `renderQueryIr()` |
| T242 | Math IR | `MathIr`, `validateMathIr()` | `renderMathIr()` |
| T243 | Logic IR | `LogicIr`, `validateLogicIr()` | `renderLogicIr()` |
| T244 | Command IR | `CommandIr`, `validateCommandIr()` | `renderCommandIr()` |
| T245 | Action IR | `ActionIR`, `ActionSchema`, `validateActionIr()` | `renderActionIr()` |
| T246 | validators for each | all seven validators above plus capability-definition validation | n/a |
| T247 | deterministic renderer/backend | canonical JSON serialization of every supported subset | all seven renderers above |

Every renderer validates first and then uses canonical JSON. Invalid IR is never serialized as if valid.

## M15 conformance fixture families

`tests/conformance/m15-formal-data-action-ir.conformance.test.ts` contains one explicit fixture family for every Section-425 IR:

1. structured Data IR with nested object/array/tagged-union values;
2. Schema IR with primitive constraints, optional values, arrays and enums;
3. parameterized read Query IR with projection/filter/order/pagination;
4. quantified Logic IR with predicate and comparison semantics;
5. Math IR containing derivative/product/relation/unit-bearing constants;
6. structured Command IR with executable/subcommand/flag/option/cwd/env;
7. Action IR against a consumer-supplied read capability registry.

The same suite verifies each renderer is deterministic for the same validated value.

## Critical negative invariants

The gate explicitly proves:

- duplicate Data IR object keys are rejected;
- invalid Schema IR array bounds and duplicate fields are rejected;
- a read Query IR cannot contain a mutation;
- mutation mode requires an explicit mutation object;
- query parameters remain structural nodes rather than being concatenated into a query string;
- invalid Logic IR arity is rejected;
- jagged Math IR matrices are rejected;
- invalid Command IR executable values are rejected;
- Action IR cannot invent capability ids outside the supplied registry;
- required Action parameters cannot be omitted;
- Action semantic references must exist when a known-reference set is supplied;
- Action IR requires provenance.

## Query safety boundary

Read and mutation semantics are separate in the IR. The renderer emits structure, not SQL or another executable query language, so this milestone does not concatenate user literals into executable syntax.

Dialect-specific SQL/query lowering remains outside the M15 completion claim.

## Action boundary

Action IR describes an intended downstream capability invocation only.

The core M15 surface validates and serializes Action IR. It does not:

- execute commands;
- open network connections;
- read/write/delete files;
- approve permissions;
- invoke a tool;
- maintain an autonomous loop.

Unknown capability ids are hard errors rather than guessed names.

## Non-claims

M15 does not claim:

- SQL dialect lowering;
- JSON Schema/OpenAPI dialect lowering;
- solver-backed logical equivalence;
- complete physical dimensional analysis;
- LaTeX/MathML rendering;
- shell escaping for executable command strings;
- Action execution authority.

Those can be later specialized backends without changing the neutral IR schemas.

## Gate rule

Verified evidence:

- verified implementation head: `772a9dbfca0dc8c7a7e7910677498c66267be5d6`
- GitHub Actions CI run: `#191` / run id `35434470005`
- package-boundary validation: pass
- strict TypeScript: pass
- deterministic test suite: **42/42 test files, 334/334 tests pass**
- M15 conformance: **9/9 tests pass**
- live Jev requests consumed by M15: `0`

The final evidence/state documentation commit must itself pass CI before PR merge.
