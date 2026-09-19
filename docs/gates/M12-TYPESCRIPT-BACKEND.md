# M12 — TypeScript Backend Gate Evidence

Status: **verified**

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

Verified evidence:

- implementation head: `9fc388abc194c2ac737e45da30ca3f24b8e4676a`
- GitHub Actions CI: run `#155` / run id `35430332203`
- deterministic job: `105863624639`
- package boundaries: `success`
- strict TypeScript: `success`
- M12 conformance: `7/7` tests
- full suite: `39/39` test files, `312/312` tests
- all eight verified M10 PIR fixtures lowered to TypeScript and strict-typechecked successfully
- live Jev requests consumed by M12: `0`

The implementation-state ledger may advance to M13 Python backend. The final documentation head must itself pass CI before merge.
