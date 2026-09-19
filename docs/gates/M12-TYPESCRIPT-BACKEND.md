# M12 — TypeScript Backend Gate Evidence

Status: **candidate — pending CI**

Specification basis: Sections 421–422 and tasks T209–T219 of the v0.4 master specification.

## Task mapping

| Task | Evidence |
| --- | --- |
| T209 ProgrammingBackend ABI | `ProgrammingBackend<Ast>`, source/diagnostic/patch/result contracts |
| T210 manifest validation | `validateProgrammingBackendManifest()`, TypeScript manifest |
| T211 robust parser | `parseTypeScriptDocument()` using `@typescript/typescript6` |
| T212 AST → PIR lift subset | `liftTypeScriptProgram()` |
| T213 PIR → AST lower subset | `lowerPirToTypeScriptAst()` |
| T214 printer/formatter | `printTypeScriptAst()`, `formatTypeScriptDocument()` |
| T215 source bindings | lift-time source bindings for modules/types/functions/parameters plus PIR bindings retained during lowering |
| T216 minimal patch generation | `createMinimalTextPatch()`, `applySourcePatches()`, backend `patch()` |
| T217 compiler diagnostics | `normalizeTypeScriptDiagnostic()` |
| T218 typecheck adapter | `typecheckTypeScriptDocument()` |
| T219 conformance suite | `tests/conformance/m12-typescript-backend.conformance.test.ts` |

## Section 422 coverage

The lift fixture includes:

- module import/export;
- functions and local variables;
- object and array literals;
- conditionals;
- while loop and for-of;
- calls;
- async/await;
- try/catch;
- interface and type alias declarations;
- a basic generic identity function.

The lowering proof additionally attempts every verified M10 PIR fixture and requires the resulting TypeScript source to pass the strict compiler adapter with zero diagnostics.

## Semantic boundaries

Unsupported TypeScript/PIR constructs return typed errors instead of being dropped or approximated silently. The backend does not use Jev or a generative model to produce source.

Source patching currently uses a deterministic minimal contiguous replacement derived from common prefix/suffix analysis. It does not claim concrete-syntax-tree minimal-edit optimality.

## Gate rule

Do not mark M12 verified or advance `last_completed_gate` until the complete branch head passes:

1. package-boundary validation;
2. strict TypeScript;
3. full deterministic tests;
4. the M12 conformance suite, including strict compiler acceptance of every M10 PIR fixture.

Live Jev requests required by M12: **0**.
