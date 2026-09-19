import { describe, expect, it } from "vitest";
import {
  applySourcePatches,
  createPythonBackend,
  createTypeScriptBackend,
  formatPythonDocument,
  parsePythonDocument,
  portableProgramSemanticsDigest,
  pythonBackendManifest,
  type SourceDocument,
} from "../../packages/code-backend-core/src/index.ts";
import {
  m10ProgramCorpus,
  validatePirProgram,
} from "../../packages/program-ir/src/index.ts";

const pythonDocument = (
  sourceId: string,
  text: string,
): SourceDocument => ({
  sourceId,
  language: "python",
  path: `/virtual/${sourceId}.py`,
  text,
});

const typeScriptDocument = (
  sourceId: string,
  text: string,
): SourceDocument => ({
  sourceId,
  language: "typescript",
  path: `/virtual/${sourceId}.ts`,
  text,
});

describe("M13 Python backend conformance", () => {
  it("exposes the complete T220-T225 Python backend capability manifest", () => {
    const backend = createPythonBackend();
    expect(backend.ok).toBe(true);
    if (!backend.ok) return;

    expect(backend.value.manifest).toEqual(pythonBackendManifest);
    expect(backend.value.manifest.language).toBe("python");
    expect(backend.value.manifest.extensions).toEqual([".py"]);
    expect(new Set(backend.value.manifest.capabilities)).toEqual(
      new Set([
        "parse",
        "lift",
        "lower",
        "print",
        "patch",
        "diagnostics",
        "typecheck",
      ]),
    );
    expect(backend.value.manifest.annotations).toMatchObject({
      parserAdapter: "python-stdlib-ast",
      dynamicUnannotatedType: "unknown",
      staticAnnotations: "optional",
      recordLowering: "mapping-semantics",
    });
  });

  it("parses and lifts the M13 source subset while keeping unannotated values unknown", () => {
    const source = pythonDocument(
      "m13-lift",
      `
from typing import Awaitable, Callable, TypeVar

T = TypeVar("T")

def identity(value: T) -> T:
    return value

def untyped(value):
    copy = value
    return copy

def positive(value: float) -> float:
    if value > 0:
        return value
    else:
        raise Exception("not positive")

def make_record(value: float):
    values: list[float] = [value, 1.0]
    return {"left": value, "values": values}

def count_to(limit: float) -> float:
    index: float = 0.0
    total: float = 0.0
    while index < limit:
        total = total + index
        index = index + 1.0
    return total

def count_items(values: list[float]) -> float:
    total: float = 0.0
    for value in values:
        total = total + 1.0
    return total

async def read_value(fetcher: Callable[[], Awaitable[str]]) -> str:
    return await fetcher()

def safe_identity(value: str) -> str:
    try:
        return value
    except Exception as error:
        return "fallback"
    finally:
        assert True, "cleanup"
`.trimStart(),
    );

    const backend = createPythonBackend();
    expect(backend.ok).toBe(true);
    if (!backend.ok) return;

    const parsed = backend.value.parse(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.diagnostics).toEqual([]);

    const lifted = backend.value.lift(parsed.value);
    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(validatePirProgram(lifted.value.program).ok).toBe(true);

    const names = lifted.value.program.functions.map((fn) => fn.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "identity",
        "untyped",
        "positive",
        "make_record",
        "count_to",
        "count_items",
        "read_value",
        "safe_identity",
      ]),
    );

    const identity = lifted.value.program.functions.find(
      (fn) => fn.name === "identity",
    );
    expect(identity?.typeParameters?.[0]).toMatchObject({
      kind: "type-variable",
      name: "T",
    });

    const untyped = lifted.value.program.functions.find(
      (fn) => fn.name === "untyped",
    );
    expect(untyped?.parameters[0]?.type).toEqual({ kind: "unknown" });
    expect(untyped?.returnType).toEqual({ kind: "unknown" });
    const copyDeclaration = untyped?.statements?.find(
      (statement) =>
        statement.kind === "declare" &&
        statement.symbol.existingName === "copy",
    );
    expect(copyDeclaration).toMatchObject({
      kind: "declare",
      type: { kind: "unknown" },
    });

    const readValue = lifted.value.program.functions.find(
      (fn) => fn.name === "read_value",
    );
    expect(readValue?.async).toBe(true);
    expect(readValue?.parameters[0]?.type).toMatchObject({
      kind: "function",
      returns: {
        kind: "promise",
        value: { kind: "string" },
      },
    });

    expect(lifted.value.sourceBindings.length).toBeGreaterThan(10);
    for (const binding of lifted.value.sourceBindings) {
      expect(binding.sourceId).toBe("m13-lift");
      if (binding.start !== undefined && binding.end !== undefined) {
        expect(binding.end).toBeGreaterThanOrEqual(binding.start);
      }
    }
  });

  it("lowers every verified M10 PIR fixture to Python accepted by compile()", () => {
    const backend = createPythonBackend();
    expect(backend.ok).toBe(true);
    if (!backend.ok) return;

    for (const [id, program] of Object.entries(m10ProgramCorpus())) {
      const lowered = backend.value.lower(program);
      expect(lowered.ok, id).toBe(true);
      if (!lowered.ok) continue;

      const printed = backend.value.print(lowered.value);
      expect(printed.ok, id).toBe(true);
      if (!printed.ok) continue;

      const checked = backend.value.typecheck(
        pythonDocument(`lower-${id}`, printed.value),
      );
      expect(
        checked.diagnostics.map(
          (diagnostic) =>
            `${diagnostic.code}: ${diagnostic.message}`,
        ),
        id,
      ).toEqual([]);
      expect(checked.ok, id).toBe(true);
    }
  });

  it("normalizes Python syntax diagnostics with stable codes and coordinates", () => {
    const parsed = parsePythonDocument(
      pythonDocument(
        "syntax-error",
        "def broken(:\n    return 1\n",
      ),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PY_SYNTAX_SYNTAXERROR",
          severity: "error",
          sourceId: "/virtual/syntax-error.py",
          line: 1,
          category: "SyntaxError",
        }),
      ]),
    );

    const backend = createPythonBackend();
    expect(backend.ok).toBe(true);
    if (!backend.ok) return;
    const lifted = backend.value.lift(parsed.value);
    expect(lifted.ok).toBe(false);
    if (!lifted.ok) {
      expect(lifted.error.code).toBe("PY_LIFT_PARSE_ERRORS");
    }
  });

  it("generates and applies a minimal deterministic Python source patch", () => {
    const backend = createPythonBackend();
    expect(backend.ok).toBe(true);
    if (!backend.ok) return;

    const program = m10ProgramCorpus()["pure-arithmetic"];
    const original = pythonDocument(
      "patch-python",
      "# keep\nobsolete = 1\n",
    );

    const lowered = backend.value.lower(program);
    expect(lowered.ok).toBe(true);
    if (!lowered.ok) return;
    const printed = backend.value.print(lowered.value);
    expect(printed.ok).toBe(true);
    if (!printed.ok) return;

    const patches = backend.value.patch(original, program);
    expect(patches.ok).toBe(true);
    if (!patches.ok) return;
    expect(patches.value.length).toBeLessThanOrEqual(1);

    const applied = applySourcePatches(original, patches.value);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.text).toBe(printed.value);
  });

  it("uses the stdlib AST printer as a deterministic Python formatter", () => {
    const formatted = formatPythonDocument(
      pythonDocument(
        "format-python",
        "def add(a:float,b:float)->float:\n return a+b\n",
      ),
    );
    expect(formatted.ok).toBe(true);
    if (!formatted.ok) return;
    expect(formatted.value).toContain(
      "def add(a: float, b: float) -> float:",
    );

    const second = formatPythonDocument(
      pythonDocument("format-python-again", formatted.value),
    );
    expect(second).toEqual({
      ok: true,
      value: formatted.value,
    });
  });

  it("preserves shared PIR semantics across TypeScript and Python for portable cross-backend fixtures", () => {
    const python = createPythonBackend();
    const typescript = createTypeScriptBackend();
    expect(python.ok).toBe(true);
    expect(typescript.ok).toBe(true);
    if (!python.ok || !typescript.ok) return;

    for (const id of [
      "pure-arithmetic",
      "conditional-validation",
      "error-handling",
      "async-call",
      "multi-function-module",
      "simple-generic-function",
    ] as const) {
      const original = m10ProgramCorpus()[id];
      const expected = portableProgramSemanticsDigest(original);

      const pyLowered = python.value.lower(original);
      expect(pyLowered.ok, `python lower ${id}`).toBe(true);
      if (!pyLowered.ok) continue;
      const pyText = python.value.print(pyLowered.value);
      expect(pyText.ok, `python print ${id}`).toBe(true);
      if (!pyText.ok) continue;
      const pyParsed = python.value.parse(
        pythonDocument(`cross-python-${id}`, pyText.value),
      );
      expect(pyParsed.ok, `python parse ${id}`).toBe(true);
      if (!pyParsed.ok) continue;
      const pyLifted = python.value.lift(pyParsed.value);
      expect(pyLifted.ok, `python lift ${id}`).toBe(true);
      if (!pyLifted.ok) continue;

      const tsLowered = typescript.value.lower(original);
      expect(tsLowered.ok, `typescript lower ${id}`).toBe(true);
      if (!tsLowered.ok) continue;
      const tsText = typescript.value.print(tsLowered.value);
      expect(tsText.ok, `typescript print ${id}`).toBe(true);
      if (!tsText.ok) continue;
      const tsParsed = typescript.value.parse(
        typeScriptDocument(`cross-typescript-${id}`, tsText.value),
      );
      expect(tsParsed.ok, `typescript parse ${id}`).toBe(true);
      if (!tsParsed.ok) continue;
      const tsLifted = typescript.value.lift(tsParsed.value);
      expect(tsLifted.ok, `typescript lift ${id}`).toBe(true);
      if (!tsLifted.ok) continue;

      expect(
        portableProgramSemanticsDigest(pyLifted.value.program),
        `python semantic projection ${id}`,
      ).toBe(expected);
      expect(
        portableProgramSemanticsDigest(tsLifted.value.program),
        `typescript semantic projection ${id}`,
      ).toBe(expected);
    }
  });
});
