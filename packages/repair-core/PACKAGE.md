# repair-core

Status: **prototype / M14 implementation in progress**.

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

The M14 gate is not verified until the broken-code benchmark and full deterministic CI pass.
