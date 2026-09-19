# repair-core

Status: **verified M14 bounded repair-loop scope**.

Scope:

- normalized compiler/test diagnostic taxonomy;
- source-span/PIR implicated-node location;
- deterministic bounded repair candidates for guards, imports/symbols, arguments, and return/type errors;
- bounded Jev/recorded-JDR candidate ranking that may only select existing candidate IDs;
- compile/test/regression loop with rollback and hard iteration/compiler/test/deadline budgets;
- traceable repair progress and structured partial failure.

Non-claims:

- arbitrary free-form code repair;
- generative source synthesis;
- repair outside declared candidate generators/knowledge;
- success without compiler/test/regression evidence.

The M14 gate is verified for the bounded deterministic scope documented in `docs/gates/M14-COMPILER-TEST-REPAIR.md`. Broader free-form repair remains explicitly out of scope.
