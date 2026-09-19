# code-backend-core

Status: **verified through M13 Python backend**.

Verified M12 TypeScript backend:

- harness-neutral `ProgrammingBackend` ABI and capability manifest;
- TypeScript compiler-API parse/lift/lower/print/patch/diagnostic/typecheck path;
- strict M12 conformance over the portable source subset and all eight M10 PIR fixtures.

Verified M13 Python backend:

- CPython stdlib `ast.parse` parser adapter and `ast.unparse` printer adapter;
- Python `compile(..., "exec")` syntax/compiler acceptance adapter;
- dynamic unannotated values preserved as PIR `unknown`;
- optional Python annotations mapped into portable PIR types;
- `Callable`, `Awaitable`, collections, optionals/unions and type variables;
- AST → PIR lift for functions, variables, list/dict structures, conditions, loops, calls, async/await and try/except;
- PIR → Python AST lower subset;
- PIR records lower with Python mapping semantics rather than JavaScript object assumptions;
- source bindings and minimal deterministic source patching;
- normalized Python diagnostics;
- deterministic formatter through stdlib AST unparse;
- cross-backend ID-independent PIR semantic projection for TypeScript/Python fixtures.

The verified M13 scope does not claim M14 compiler/test repair loops, static Python type checking through mypy/pyright, arbitrary Python syntax coverage, or generative source production.
