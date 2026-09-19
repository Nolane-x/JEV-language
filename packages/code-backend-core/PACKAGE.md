# code-backend-core

Status: **candidate / M12 implementation complete pending gate CI**.

Implemented for the TypeScript backend milestone:

- harness-neutral `ProgrammingBackend` ABI and validated capability manifest;
- robust TypeScript parsing through `@typescript/typescript6`;
- normalized parser/compiler diagnostics with stable TS codes and source coordinates;
- AST → PIR lift subset with module/import/export, functions, variables, arrays/objects, conditionals, loops/for-of, calls, async/await, try/catch, interfaces/type aliases and basic generics;
- source bindings captured during lift;
- PIR → TypeScript AST lowering for the portable M12 subset;
- deterministic TypeScript printer/formatter adapter;
- minimal contiguous source patch generation plus overlap-safe patch application;
- strict in-memory TypeScript typecheck adapter;
- compatibility wrappers retained for the original narrow VS4 renderer/typecheck API.

The M12 candidate does not claim Python lowering, repair, compiler-backed CEGIS or complete TypeScript syntax coverage.
