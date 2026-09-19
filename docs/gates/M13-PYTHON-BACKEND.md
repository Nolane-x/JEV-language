# M13 — Python Backend Gate Evidence

Status: **verified**

Specification basis: Section 423 and tasks T220–T226 of the v0.4 master specification.

## Task mapping

| Task | Evidence |
| --- | --- |
| T220 Python parser adapter | `parsePythonDocument()` using CPython stdlib `ast.parse` |
| T221 AST → PIR subset | `liftPythonProgram()` with dynamic `unknown` and optional annotation mapping |
| T222 PIR → AST subset | `lowerPirToPythonAst()` |
| T223 source binding / patch | Python lift bindings + shared minimal patch generation/application |
| T224 diagnostics normalization | Python syntax/compile diagnostics normalized into backend diagnostic contract |
| T225 Python backend conformance | `tests/conformance/m13-python-backend.conformance.test.ts` |
| T226 cross-backend PIR semantic fixtures | `projectPortableProgramSemantics()` / `portableProgramSemanticsDigest()` across TypeScript and Python round trips |

## Python semantic boundary

The backend deliberately preserves Python-specific semantics:

- missing annotations become PIR `unknown`; no speculative static type inference is performed;
- optional annotations are consumed when present;
- `Callable`, `Awaitable`, collection forms, unions/optionals and TypeVar-based generic parameters map into portable PIR;
- PIR structural records lower to Python mapping semantics (`dict` / subscript) instead of assuming JavaScript object identity;
- Python compilation acceptance uses `compile(..., "exec")`, not a fake static type checker;
- unsupported syntax/IR returns typed errors rather than being silently dropped.

The parser/printer are adapters over CPython's stdlib AST implementation; the repository does not implement a second Python parser.

## Section 423 conformance

The Python source lift fixture covers:

- functions;
- annotated and unannotated parameters/locals;
- TypeVar generic identity;
- list and dict literals;
- conditionals;
- while loops;
- for-each loops;
- calls;
- async/await;
- try/except/finally;
- assertions;
- optional typing annotations.

The lower proof requires all eight verified M10 PIR fixtures to produce Python source accepted by the Python compile adapter.

## Cross-backend semantic proof

For portable fixtures, conformance performs:

`PIR → TypeScript AST → TypeScript source → PIR`

and independently:

`PIR → Python AST → Python source → PIR`.

The resulting programs are compared through an ID/source-span-independent semantic projection that preserves:

- function names;
- parameter names and portable types;
- return types;
- async flag;
- generic parameter names;
- executable expression/control structure;
- symbol references resolved to semantic names.

The cross-backend proof excludes backend-only formatting/source-binding details from semantic equality.

## Source patches and formatting

Python patching uses the same deterministic minimal contiguous common-prefix/common-suffix strategy as the backend ABI. It does not claim concrete-syntax-tree minimal-edit optimality.

Formatting uses CPython `ast.unparse`, making normalization deterministic for the supported environment.

## Non-claims

M13 does not claim:

- mypy/pyright static typing;
- arbitrary Python syntax coverage;
- M14 repair loops;
- compiler/test CEGIS;
- generative source production.

## Gate evidence

- implementation head: `d32667ef0a23c4f42a51962b48b73ebcc65eb07b`
- GitHub Actions CI: run `#167` / run id `35432279280`
- deterministic job: `105868893026`
- package boundaries: `success`
- strict TypeScript: `success`
- M13 conformance: `7/7` tests
- full suite: `40/40` test files, `319/319` tests
- all eight verified M10 PIR fixtures lower to Python accepted by the compile adapter
- portable cross-backend fixtures pass TypeScript/Python semantic round-trip projection
- live Jev requests consumed by M13: `0`

The final documentation head must itself pass CI before merge.
