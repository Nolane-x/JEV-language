# M10 — Program IR Gate Evidence

Status: **candidate — pending CI**

Specification basis: Sections 261–271, 417–418 and tasks T181–T193 of the v0.4 master specification.

## Definition-of-Done mapping

| M10 requirement | Repository evidence |
| --- | --- |
| PIR graph | `InMemoryPirGraph`, `PirGraphSnapshot`, atomic revisioned transactions |
| symbols | `PirSymbol` with semantic purpose, naming intent, visibility and source binding |
| types | expanded `PirType` algebra |
| expressions | `PirExpression` union covering literals, refs, access, calls, operators, conditions, lambdas, await, casts, collections, records, match, filter/map and holes |
| statements | `PirStatement` union covering declare/assign/expression/return/if/loop/for-each/match/try/throw/assert/break/continue/defer/block/hole |
| functions | `PirFunction` with expression or structured-statement body |
| modules | `PirModule`, imports/exports/declarations/name intent |
| contracts | `FunctionContract`, error cases and provenance |
| effects | `EffectSpec` and explicit portable effect kinds |
| holes | `ProgramHole` with type/effect/facts/scope/purpose/budget |
| source bindings | `SourceBinding` plus runtime validation |
| CFG derived view | `lowerFunctionToCfg()` |
| data-flow seed | `analyzeDefUse()` derived from canonical PIR |
| runtime validation | `validatePirProgram()`, `validatePirType()`, `validateSourceBinding()` |
| canonical persistence | `serializePirProgram()` / `deserializePirProgram()` |
| backward compatibility | existing VS4 synthesis path retained; narrow TypeScript backend explicitly rejects unsupported statement/expression lowering rather than pretending support |

No source generation is claimed by this milestone. Section 417 explicitly leaves source generation to the backend milestone. fileciteturn578file0

## Required M10 program corpus

`m10ProgramCorpus()` contains all eight Section-418 fixture families:

1. pure arithmetic function;
2. conditional validation;
3. collection filter/map;
4. state mutation;
5. error handling;
6. async call;
7. multi-function module;
8. simple generic function.

## Conformance evidence

`tests/conformance/m10-program-ir.conformance.test.ts` checks:

- every mandatory fixture passes the PIR validator;
- expression-body and statement-body functions lower to CFGs;
- every CFG successor names an existing block;
- conditional control flow exposes branch/return/throw structure;
- def-use facts are derived rather than stored in canonical PIR;
- serialization round-trips modules/functions/contracts/effects/generics/source bindings canonically;
- graph rollback does not mutate state;
- successful commits change revision and retain parent revision;
- stale transactions are rejected;
- failed transactions leave revision and canonical program unchanged;
- typed holes remain explicit incomplete program locations;
- source-binding ranges are validated;
- symbols remain backend-neutral;
- pure/write-memory/throw/network/async effects remain distinguishable.

## Gate rule

Do not mark M10 verified or advance `last_completed_gate` until the complete branch head passes package-boundary validation, strict TypeScript and the full deterministic test suite. No live Jev request is required for M10.
