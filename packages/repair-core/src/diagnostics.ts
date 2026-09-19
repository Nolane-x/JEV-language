import {
  sha256,
  type JsonValue,
} from "../../core-types/src/index.ts";
import type {
  NormalizedCompilerDiagnostic,
  SourceDocument,
} from "../../code-backend-core/src/backend.ts";
import type {
  PirProgram,
  PirStatement,
  ProgramRef,
  SourceBinding,
} from "../../program-ir/src/index.ts";
import type {
  ImplicatedProgramNode,
  RepairDiagnostic,
  RepairDiagnosticKind,
} from "./model.ts";

const messageIncludes = (
  diagnostic: NormalizedCompilerDiagnostic,
  pattern: RegExp,
): boolean => pattern.test(diagnostic.message);

export const classifyRepairDiagnostic = (
  diagnostic: NormalizedCompilerDiagnostic,
): RepairDiagnosticKind => {
  const code = diagnostic.code.toUpperCase();

  if (
    code.startsWith("PY_SYNTAX_") ||
    /^TS1\d{3}$/u.test(code) ||
    messageIncludes(diagnostic, /syntax|expected token|unexpected token/iu)
  ) {
    return "syntax";
  }

  if (
    code === "TS2307" ||
    messageIncludes(diagnostic, /cannot find module|no module named/iu)
  ) {
    return "import";
  }

  if (
    ["TS2304", "TS2552", "TS2580"].includes(code) ||
    messageIncludes(
      diagnostic,
      /cannot find name|name .* is not defined|unknown symbol/iu,
    )
  ) {
    return "missing-symbol";
  }

  if (
    ["TS2554", "TS2345"].includes(code) ||
    messageIncludes(
      diagnostic,
      /argument|positional argument|keyword argument|expected .* arguments/iu,
    )
  ) {
    return "argument";
  }

  if (
    ["TS18047", "TS18048", "TS2531", "TS2532"].includes(code) ||
    messageIncludes(
      diagnostic,
      /possibly ['"]?null|possibly ['"]?undefined|nonetype|none is not/iu,
    )
  ) {
    return "nullability";
  }

  if (
    code.includes("RETURN") ||
    messageIncludes(diagnostic, /return type|returned value|must return/iu)
  ) {
    return "return";
  }

  if (
    code.startsWith("TEST_") ||
    diagnostic.category?.toLocaleLowerCase() === "test"
  ) {
    return "test-failure";
  }

  if (
    code.startsWith("RUNTIME_") ||
    diagnostic.category?.toLocaleLowerCase() === "runtime"
  ) {
    return "runtime";
  }

  if (
    code.startsWith("TS") ||
    messageIncludes(
      diagnostic,
      /type .* is not assignable|incompatible type|type mismatch/iu,
    )
  ) {
    return "type";
  }

  return "unknown";
};

const lineColumnOffset = (
  text: string,
  line: number | undefined,
  column: number | undefined,
): number | undefined => {
  if (line === undefined || column === undefined || line < 1 || column < 1) {
    return undefined;
  }
  const lines = text.split(/(?<=\n)/u);
  if (line > lines.length) return undefined;
  const before = lines
    .slice(0, line - 1)
    .reduce((sum, value) => sum + value.length, 0);
  return before + Math.max(0, column - 1);
};

interface BoundNode {
  refId: ProgramRef;
  nodeKind: ImplicatedProgramNode["nodeKind"];
  binding: SourceBinding;
}

const statementBindings = (
  statements: readonly PirStatement[],
  output: BoundNode[],
): void => {
  for (const statement of statements) {
    switch (statement.kind) {
      case "declare":
        if (statement.symbol.sourceBinding !== undefined) {
          output.push({
            refId: statement.symbol.id,
            nodeKind: "symbol",
            binding: statement.symbol.sourceBinding,
          });
        }
        break;
      case "for-each":
        if (statement.item.sourceBinding !== undefined) {
          output.push({
            refId: statement.item.id,
            nodeKind: "parameter",
            binding: statement.item.sourceBinding,
          });
        }
        statementBindings(statement.body, output);
        break;
      case "if":
        statementBindings(statement.then, output);
        statementBindings(statement.else ?? [], output);
        break;
      case "loop":
      case "defer":
        statementBindings(statement.body, output);
        break;
      case "match":
        statement.cases.forEach((entry) =>
          statementBindings(entry.body, output),
        );
        statementBindings(statement.default ?? [], output);
        break;
      case "try":
        statementBindings(statement.body, output);
        if (statement.catch?.parameter?.sourceBinding !== undefined) {
          output.push({
            refId: statement.catch.parameter.id,
            nodeKind: "parameter",
            binding: statement.catch.parameter.sourceBinding,
          });
        }
        statementBindings(statement.catch?.body ?? [], output);
        statementBindings(statement.finally ?? [], output);
        break;
      case "block":
        statementBindings(statement.statements, output);
        break;
      case "assign":
      case "expression":
      case "return":
      case "throw":
      case "assert":
      case "break":
      case "continue":
      case "hole":
        break;
    }
  }
};

export const collectProgramBindings = (
  program: PirProgram,
): BoundNode[] => {
  const output: BoundNode[] = [];

  for (const module of program.modules ?? []) {
    if (module.sourceBinding !== undefined) {
      output.push({
        refId: module.id,
        nodeKind: "module",
        binding: module.sourceBinding,
      });
    }
  }

  for (const fn of program.functions) {
    if (fn.sourceBinding !== undefined) {
      output.push({
        refId: fn.id,
        nodeKind: "function",
        binding: fn.sourceBinding,
      });
    }
    for (const parameter of fn.parameters) {
      if (parameter.sourceBinding !== undefined) {
        output.push({
          refId: parameter.id,
          nodeKind: "parameter",
          binding: parameter.sourceBinding,
        });
      }
    }
    statementBindings(fn.statements ?? [], output);
  }

  for (const symbol of program.symbols ?? []) {
    if (symbol.sourceBinding !== undefined) {
      output.push({
        refId: symbol.id,
        nodeKind: "symbol",
        binding: symbol.sourceBinding,
      });
    }
  }

  for (const hole of program.holes ?? []) {
    if (hole.sourceBinding !== undefined) {
      output.push({
        refId: hole.id,
        nodeKind: "hole",
        binding: hole.sourceBinding,
      });
    }
  }

  return output;
};

const sameSource = (
  binding: SourceBinding,
  source: SourceDocument,
  diagnostic: NormalizedCompilerDiagnostic,
): boolean =>
  binding.sourceId === source.sourceId &&
  (diagnostic.sourceId === undefined ||
    diagnostic.sourceId === source.sourceId ||
    diagnostic.sourceId === source.path);

export const locateImplicatedProgramNodes = (
  source: SourceDocument,
  program: PirProgram,
  diagnostic: NormalizedCompilerDiagnostic,
): ImplicatedProgramNode[] => {
  const start =
    diagnostic.start ??
    lineColumnOffset(source.text, diagnostic.line, diagnostic.column);
  if (start === undefined) return [];
  const end = start + Math.max(1, diagnostic.length ?? 1);

  const candidates = collectProgramBindings(program)
    .filter(
      (entry) =>
        sameSource(entry.binding, source, diagnostic) &&
        entry.binding.start !== undefined &&
        entry.binding.end !== undefined,
    )
    .map((entry) => {
      const bindingStart = entry.binding.start!;
      const bindingEnd = entry.binding.end!;
      const overlap =
        Math.max(start, bindingStart) < Math.min(end, bindingEnd);
      const distance = overlap
        ? 0
        : end <= bindingStart
          ? bindingStart - end
          : start - bindingEnd;
      return {
        ...entry,
        relation: overlap ? "overlap" as const : "nearest" as const,
        distance: Math.max(0, distance),
      };
    })
    .sort(
      (a, b) =>
        (a.relation === "overlap" ? 0 : 1) -
          (b.relation === "overlap" ? 0 : 1) ||
        a.distance - b.distance ||
        ((a.binding.end ?? 0) - (a.binding.start ?? 0)) -
          ((b.binding.end ?? 0) - (b.binding.start ?? 0)) ||
        a.refId.localeCompare(b.refId),
    );

  const overlapping = candidates.filter(
    (candidate) => candidate.relation === "overlap",
  );
  return (overlapping.length > 0 ? overlapping : candidates.slice(0, 3)).map(
    (candidate) => ({
      refId: candidate.refId,
      nodeKind: candidate.nodeKind,
      binding: structuredClone(candidate.binding),
      relation: candidate.relation,
      distance: candidate.distance,
    }),
  );
};

export const normalizeRepairDiagnostic = (input: {
  backendId: string;
  source: SourceDocument;
  compiler: NormalizedCompilerDiagnostic;
  program?: PirProgram;
  metadata?: Record<string, JsonValue>;
}): RepairDiagnostic => {
  const kind = classifyRepairDiagnostic(input.compiler);
  const implicated =
    input.program === undefined
      ? []
      : locateImplicatedProgramNodes(
          input.source,
          input.program,
          input.compiler,
        );
  const id = sha256(
    JSON.stringify({
      backendId: input.backendId,
      code: input.compiler.code,
      message: input.compiler.message,
      sourceId: input.compiler.sourceId ?? input.source.sourceId,
      start: input.compiler.start ?? null,
      line: input.compiler.line ?? null,
      column: input.compiler.column ?? null,
    }),
  );

  return {
    id,
    kind,
    backendId: input.backendId,
    compiler: structuredClone(input.compiler),
    implicated,
    ...(input.metadata === undefined
      ? {}
      : { metadata: structuredClone(input.metadata) }),
  };
};

export const normalizeRepairDiagnostics = (input: {
  backendId: string;
  source: SourceDocument;
  diagnostics: readonly NormalizedCompilerDiagnostic[];
  program?: PirProgram;
}): RepairDiagnostic[] =>
  input.diagnostics.map((compiler) =>
    normalizeRepairDiagnostic({
      backendId: input.backendId,
      source: input.source,
      compiler,
      ...(input.program === undefined ? {} : { program: input.program }),
    }),
  );
