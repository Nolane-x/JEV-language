import { describe, expect, it } from "vitest";
import {
  applySourcePatches,
  createTypeScriptBackend,
  formatTypeScriptDocument,
  parseTypeScriptDocument,
  typeScriptBackendManifest,
  type SourceDocument,
} from "../../packages/code-backend-core/src/index.ts";
import {
  m10ProgramCorpus,
  validatePirProgram,
} from "../../packages/program-ir/src/index.ts";

const document = (
  sourceId: string,
  text: string,
): SourceDocument => ({
  sourceId,
  language: "typescript",
  path: `/virtual/${sourceId}.ts`,
  text,
});

describe("M12 TypeScript backend conformance", () => {
  it("exposes the complete T209 backend capability manifest", () => {
    const backend = createTypeScriptBackend();
    expect(backend.ok).toBe(true);
    if (!backend.ok) return;

    expect(backend.value.manifest).toEqual(typeScriptBackendManifest);
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
    expect(backend.value.manifest.language).toBe("typescript");
    expect(backend.value.manifest.extensions).toContain(".ts");
  });

  it("parses and lifts the M12 source subset into validated PIR with source bindings", () => {
    const source = document(
      "m12-lift",
      `
import { unused } from "./dependency";

export interface User {
  active: boolean;
  name: string;
}

export type Count = number;

export function identity<T>(value: T): T {
  return value;
}

function square(value: number): number {
  return value * value;
}

export function positiveSquare(value: number): number {
  if (value > 0) {
    return square(value);
  } else {
    return 0;
  }
}

export function makeRecord(value: number): { left: number; values: number[] } {
  const values: number[] = [value, 1];
  return { left: value, values: values };
}

export function sumTo(limit: number): number {
  let index: number = 0;
  let total: number = 0;
  while (index < limit) {
    total = total + index;
    index = index + 1;
  }
  return total;
}

export function sumList(values: number[]): number {
  let total: number = 0;
  for (const value of values) {
    total = total + value;
  }
  return total;
}

export async function readValue(fetcher: () => Promise<string>): Promise<string> {
  return await fetcher();
}

export function safeIdentity(value: string): string {
  try {
    return value;
  } catch (error) {
    throw error;
  }
}
`.trimStart(),
    );

    const backendResult = createTypeScriptBackend();
    expect(backendResult.ok).toBe(true);
    if (!backendResult.ok) return;
    const backend = backendResult.value;

    const parsed = backend.parse(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.diagnostics).toEqual([]);

    const lifted = backend.lift(parsed.value);
    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;

    expect(validatePirProgram(lifted.value.program).ok).toBe(true);
    expect(lifted.value.program.modules).toHaveLength(1);
    expect(lifted.value.program.modules?.[0]?.imports).toEqual([
      {
        module: "./dependency",
        symbols: ["unused"],
      },
    ]);
    expect(
      lifted.value.program.modules?.[0]?.exports.length,
    ).toBeGreaterThanOrEqual(7);

    const names = lifted.value.program.functions.map((fn) => fn.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "identity",
        "square",
        "positiveSquare",
        "makeRecord",
        "sumTo",
        "sumList",
        "readValue",
        "safeIdentity",
      ]),
    );

    const identity = lifted.value.program.functions.find(
      (fn) => fn.name === "identity",
    );
    expect(identity?.typeParameters?.[0]).toMatchObject({
      kind: "type-variable",
      name: "T",
    });

    const readValue = lifted.value.program.functions.find(
      (fn) => fn.name === "readValue",
    );
    expect(readValue).toMatchObject({
      async: true,
      returnType: { kind: "string" },
    });
    expect(readValue?.effects).toContainEqual({ kind: "async" });

    const typeNames = (lifted.value.program.symbols ?? []).map(
      (symbol) => symbol.existingName,
    );
    expect(typeNames).toEqual(
      expect.arrayContaining(["User", "Count"]),
    );

    expect(lifted.value.sourceBindings.length).toBeGreaterThan(8);
    for (const binding of lifted.value.sourceBindings) {
      expect(binding.sourceId).toBe("m12-lift");
      expect(binding.start).toBeGreaterThanOrEqual(0);
      expect(binding.end).toBeGreaterThanOrEqual(binding.start ?? 0);
    }
  });

  it("lowers every verified M10 PIR fixture to compilable TypeScript", () => {
    const backendResult = createTypeScriptBackend();
    expect(backendResult.ok).toBe(true);
    if (!backendResult.ok) return;
    const backend = backendResult.value;

    for (const [id, program] of Object.entries(m10ProgramCorpus())) {
      const lowered = backend.lower(program);
      expect(lowered.ok, id).toBe(true);
      if (!lowered.ok) continue;

      const printed = backend.print(lowered.value);
      expect(printed.ok, id).toBe(true);
      if (!printed.ok) continue;

      const checked = backend.typecheck(
        document(`lower-${id}`, printed.value),
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

  it("normalizes compiler diagnostics with stable codes and source coordinates", () => {
    const backendResult = createTypeScriptBackend();
    expect(backendResult.ok).toBe(true);
    if (!backendResult.ok) return;

    const checked = backendResult.value.typecheck(
      document(
        "diagnostic",
        'const value: number = "not-a-number";\n',
      ),
    );

    expect(checked.ok).toBe(false);
    expect(checked.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TS2322",
          severity: "error",
          sourceId: "/virtual/diagnostic.ts",
          line: 1,
        }),
      ]),
    );
  });

  it("reports parser diagnostics without attempting a lossy lift", () => {
    const parsed = parseTypeScriptDocument(
      document(
        "parse-error",
        "export function broken(: number { return 1; }",
      ),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      parsed.value.diagnostics.some(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ).toBe(true);

    const backendResult = createTypeScriptBackend();
    expect(backendResult.ok).toBe(true);
    if (!backendResult.ok) return;
    const lifted = backendResult.value.lift(parsed.value);
    expect(lifted.ok).toBe(false);
    if (!lifted.ok) {
      expect(lifted.error.code).toBe("TS_LIFT_PARSE_ERRORS");
    }
  });

  it("generates a minimal contiguous source patch and applies it deterministically", () => {
    const backendResult = createTypeScriptBackend();
    expect(backendResult.ok).toBe(true);
    if (!backendResult.ok) return;
    const backend = backendResult.value;

    const program = m10ProgramCorpus()["pure-arithmetic"];
    const original = document(
      "patch",
      "// keep this prefix\nexport const obsolete = 1;\n",
    );

    const lowered = backend.lower(program);
    expect(lowered.ok).toBe(true);
    if (!lowered.ok) return;
    const printed = backend.print(lowered.value);
    expect(printed.ok).toBe(true);
    if (!printed.ok) return;

    const patches = backend.patch(original, program);
    expect(patches.ok).toBe(true);
    if (!patches.ok) return;
    expect(patches.value.length).toBeLessThanOrEqual(1);

    const applied = applySourcePatches(original, patches.value);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.text).toBe(printed.value);
  });

  it("integrates the TypeScript printer as a deterministic formatter", () => {
    const formatted = formatTypeScriptDocument(
      document(
        "format",
        "export function add(a:number,b:number):number{return a+b}",
      ),
    );
    expect(formatted.ok).toBe(true);
    if (!formatted.ok) return;

    expect(formatted.value).toContain(
      "export function add(a: number, b: number): number",
    );
    const second = formatTypeScriptDocument(
      document("format-again", formatted.value),
    );
    expect(second).toEqual({
      ok: true,
      value: formatted.value,
    });
  });
});
