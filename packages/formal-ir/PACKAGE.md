# formal-ir

Status: **candidate / M15 implementation complete pending gate CI**.

Implemented for T239–T244, T246–T247:

- Data IR with null/boolean/number/string/binary reference/array/object/tagged-union values;
- Schema IR with primitive/nullable/optional/array/tuple/object/record/enum/union/intersection/reference forms and constraints;
- Query IR with read-vs-mutation safety, sources, projection, filter, joins, grouping, aggregation, ordering, pagination, parameters and explicit mutations;
- Math IR for symbols/constants/arithmetic/relations/sets/intervals/vectors/matrices/limits/derivatives/integrals and quantified forms;
- Logic IR for propositions, predicates, terms, boolean connectives, implication/equivalence, comparisons, quantification and modal forms;
- Command IR with typed argument kinds, cwd/env/stdin/effect metadata;
- deterministic validators for every family;
- canonical JSON renderer for every supported family;
- M15 conformance fixtures covering positive rendering and critical negative invariants.

Broader dialect-specific renderers, dimensional solvers, SQL backends and solver-backed logic are intentionally outside the M15 completion claim.
