# program-ir

Status: **candidate / M10 implementation complete pending gate CI**.

Implemented against the v0.4 M10 Program IR milestone:

- ProgramId / ProgramRef / HoleId;
- backend-neutral naming intent and source bindings;
- expanded PirType algebra including primitive, named, generic, union, intersection, optional, function, tuple, record, collection, unknown, type-variable, result, variant and promise forms;
- expression algebra for literals, refs, access, calls, construction, operators, conditionals, lambdas, await, casts, collections, records, matching, filter/map and typed holes;
- structured statement algebra including declaration, assignment, return, branching, loops, match, try/catch/finally, throw, assert, control transfer, defer, block and holes;
- function/module/symbol structures;
- contracts with explicit provenance;
- effect declarations;
- explicit typed ProgramHole contracts and budgets;
- atomic revisioned PIR graph transactions with rollback and stale-revision rejection;
- deterministic validation and canonical serialization/deserialization;
- derived CFG lowering and def-use analysis;
- required M10 fixture corpus: arithmetic, validation, filter/map, state mutation, error handling, async call, multi-function module and generic function.

Source generation is intentionally not part of the M10 completion claim; backend lowering remains a later milestone.
