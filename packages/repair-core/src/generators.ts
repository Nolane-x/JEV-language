import type {
  NormalizedCompilerDiagnostic,
  SourcePatch,
} from "../../code-backend-core/src/backend.ts";
import type {
  RepairCandidate,
  RepairGenerationContext,
  RepairGenerator,
} from "./model.ts";

const diagnosticRange = (
  diagnostic: NormalizedCompilerDiagnostic,
): { start: number; end: number } | undefined => {
  if (
    diagnostic.start === undefined ||
    !Number.isInteger(diagnostic.start) ||
    diagnostic.start < 0
  ) {
    return undefined;
  }
  return {
    start: diagnostic.start,
    end: diagnostic.start + Math.max(1, diagnostic.length ?? 1),
  };
};

const missingName = (
  message: string,
): string | undefined => {
  const patterns = [
    /cannot find name ['"]?([A-Za-z_$][\w$]*)['"]?/iu,
    /cannot find name '([^']+)'/iu,
    /name ['"]([^'"]+)['"] is not defined/iu,
    /cannot find symbol ['"]?([A-Za-z_$][\w$]*)['"]?/iu,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(message);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
};

const insertImport = (
  language: string,
  module: string,
  imported: string,
  alias: string | undefined,
): string | undefined => {
  if (language === "typescript") {
    const target = alias === undefined
      ? imported
      : `${imported} as ${alias}`;
    return `import { ${target} } from ${JSON.stringify(module)};\n`;
  }
  if (language === "python") {
    return alias === undefined
      ? `from ${module} import ${imported}\n`
      : `from ${module} import ${imported} as ${alias}\n`;
  }
  return undefined;
};

const replaceDiagnosticRange = (
  sourceId: string,
  diagnostic: NormalizedCompilerDiagnostic,
  replacement: string,
  reason: string,
): SourcePatch[] => {
  const range = diagnosticRange(diagnostic);
  return range === undefined
    ? []
    : [
        {
          sourceId,
          start: range.start,
          end: range.end,
          replacement,
          reason,
        },
      ];
};

const findReturnExpressionEnd = (input: {
  text: string;
  start: number;
  lineEnd: number;
  language: string;
}): number => {
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;

  for (let index = input.start; index < input.lineEnd; index += 1) {
    const char = input.text[index]!;
    const next = input.text[index + 1];

    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    const atTopLevel =
      parentheses === 0 &&
      brackets === 0 &&
      braces === 0;

    if (atTopLevel) {
      if (char === ";") return index;
      if (char === "}") return index;
      if (input.language === "python" && char === "#") return index;
      if (
        input.language !== "python" &&
        char === "/" &&
        next === "/"
      ) {
        return index;
      }
    }

    switch (char) {
      case "(":
        parentheses += 1;
        break;
      case ")":
        parentheses = Math.max(0, parentheses - 1);
        break;
      case "[":
        brackets += 1;
        break;
      case "]":
        brackets = Math.max(0, brackets - 1);
        break;
      case "{":
        braces += 1;
        break;
      case "}":
        braces = Math.max(0, braces - 1);
        break;
    }
  }

  return input.lineEnd;
};

const returnExpressionRange = (
  context: RepairGenerationContext,
  diagnostic: NormalizedCompilerDiagnostic,
): { start: number; end: number } | undefined => {
  const anchorOffset = diagnostic.start;
  if (anchorOffset === undefined) return undefined;

  const text = context.source.text;
  const lineStart = text.lastIndexOf("\n", Math.max(0, anchorOffset - 1)) + 1;
  const newline = text.indexOf("\n", anchorOffset);
  const lineEnd = newline < 0 ? text.length : newline;
  const line = text.slice(lineStart, lineEnd);

  const returnMatch = /\breturn\b/u.exec(line);
  if (returnMatch === null) return undefined;

  const returnStart = lineStart + returnMatch.index;
  const diagnosticEnd =
    anchorOffset + Math.max(1, diagnostic.length ?? 1);
  if (
    diagnosticEnd < returnStart ||
    anchorOffset > lineEnd
  ) {
    return undefined;
  }

  let start =
    lineStart + returnMatch.index + returnMatch[0].length;
  while (start < lineEnd && /\s/u.test(text[start]!)) start += 1;
  if (start >= lineEnd) return undefined;

  let end = findReturnExpressionEnd({
    text,
    start,
    lineEnd,
    language: context.source.language,
  });
  while (end > start && /\s/u.test(text[end - 1]!)) end -= 1;

  return end > start ? { start, end } : undefined;
};

const replaceReturnExpression = (
  context: RepairGenerationContext,
  diagnostic: NormalizedCompilerDiagnostic,
  replacement: string,
): SourcePatch[] => {
  const range = returnExpressionRange(context, diagnostic);
  return range === undefined
    ? replaceDiagnosticRange(
        context.source.sourceId,
        diagnostic,
        replacement,
        "repair-return-or-type",
      )
    : [
        {
          sourceId: context.source.sourceId,
          start: range.start,
          end: range.end,
          replacement,
          reason: "repair-return-expression",
        },
      ];
};

export class AddGuardRepairGenerator implements RepairGenerator {
  readonly id = "repair.add-guard.v1";

  supports(context: RepairGenerationContext): boolean {
    return context.diagnostics.some(
      (diagnostic) => diagnostic.kind === "nullability",
    );
  }

  generate(context: RepairGenerationContext): RepairCandidate[] {
    const candidates: RepairCandidate[] = [];
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.kind !== "nullability") continue;
      const configured =
        context.knowledge.nullGuards[diagnostic.compiler.code] ?? [];
      for (let index = 0; index < configured.length; index += 1) {
        const option = configured[index]!;
        const patches = replaceDiagnosticRange(
          context.source.sourceId,
          diagnostic.compiler,
          option.source,
          "add-null-guard",
        );
        if (patches.length === 0) continue;
        candidates.push({
          id: `repair:add-guard:${diagnostic.id}:${index}`,
          kind: "add-guard",
          diagnosticIds: [diagnostic.id],
          pirOperations: [],
          sourcePatches: patches,
          expectedRemovedCodes: [diagnostic.compiler.code],
          cost: option.cost ?? 2,
          rationale:
            "Replace the implicated nullable expression with a configured guarded expression.",
          evidenceRefs: [`diagnostic:${diagnostic.id}`],
        });
      }
    }
    return candidates;
  }
}

export class ImportSymbolRepairGenerator implements RepairGenerator {
  readonly id = "repair.import-symbol.v1";

  supports(context: RepairGenerationContext): boolean {
    return context.diagnostics.some(
      (diagnostic) =>
        diagnostic.kind === "missing-symbol" ||
        diagnostic.kind === "import",
    );
  }

  generate(context: RepairGenerationContext): RepairCandidate[] {
    const candidates: RepairCandidate[] = [];
    for (const diagnostic of context.diagnostics) {
      if (
        diagnostic.kind !== "missing-symbol" &&
        diagnostic.kind !== "import"
      ) {
        continue;
      }
      const symbol =
        typeof diagnostic.metadata?.symbol === "string"
          ? diagnostic.metadata.symbol
          : missingName(diagnostic.compiler.message);
      if (symbol === undefined) continue;
      const configured = context.knowledge.symbolImports[symbol] ?? [];
      for (let index = 0; index < configured.length; index += 1) {
        const option = configured[index]!;
        const text = insertImport(
          context.source.language,
          option.module,
          option.imported,
          option.alias,
        );
        if (text === undefined) continue;
        candidates.push({
          id: `repair:import:${diagnostic.id}:${index}`,
          kind: "import-symbol",
          diagnosticIds: [diagnostic.id],
          pirOperations: [],
          sourcePatches: [
            {
              sourceId: context.source.sourceId,
              start: 0,
              end: 0,
              replacement: text,
              reason: "import-missing-symbol",
            },
          ],
          expectedRemovedCodes: [diagnostic.compiler.code],
          cost: option.cost ?? 1,
          rationale:
            `Import declared symbol ${symbol} from configured module ${option.module}.`,
          evidenceRefs: [
            `diagnostic:${diagnostic.id}`,
            `knowledge:symbol-import:${symbol}`,
          ],
        });
      }
    }
    return candidates;
  }
}

export class ArgumentRepairGenerator implements RepairGenerator {
  readonly id = "repair.argument.v1";

  supports(context: RepairGenerationContext): boolean {
    return context.diagnostics.some(
      (diagnostic) => diagnostic.kind === "argument",
    );
  }

  generate(context: RepairGenerationContext): RepairCandidate[] {
    const candidates: RepairCandidate[] = [];
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.kind !== "argument") continue;
      const key =
        typeof diagnostic.metadata?.callable === "string"
          ? diagnostic.metadata.callable
          : diagnostic.compiler.code;
      const configured = context.knowledge.argumentDefaults[key] ?? [];
      for (let index = 0; index < configured.length; index += 1) {
        const option = configured[index]!;
        const patches = replaceDiagnosticRange(
          context.source.sourceId,
          diagnostic.compiler,
          option.source,
          "repair-call-arguments",
        );
        if (patches.length === 0) continue;
        candidates.push({
          id: `repair:argument:${diagnostic.id}:${index}`,
          kind: "argument",
          diagnosticIds: [diagnostic.id],
          pirOperations: [],
          sourcePatches: patches,
          expectedRemovedCodes: [diagnostic.compiler.code],
          cost: option.cost ?? 2,
          rationale:
            "Replace the implicated call expression with a configured type-compatible call form.",
          evidenceRefs: [
            `diagnostic:${diagnostic.id}`,
            `knowledge:argument:${key}`,
          ],
        });
      }
    }
    return candidates;
  }
}

export class ReturnTypeRepairGenerator implements RepairGenerator {
  readonly id = "repair.return-type.v1";

  supports(context: RepairGenerationContext): boolean {
    return context.diagnostics.some(
      (diagnostic) =>
        diagnostic.kind === "return" ||
        diagnostic.kind === "type",
    );
  }

  generate(context: RepairGenerationContext): RepairCandidate[] {
    const candidates: RepairCandidate[] = [];
    for (const diagnostic of context.diagnostics) {
      if (
        diagnostic.kind !== "return" &&
        diagnostic.kind !== "type"
      ) {
        continue;
      }
      const key =
        typeof diagnostic.metadata?.returnTarget === "string"
          ? diagnostic.metadata.returnTarget
          : diagnostic.compiler.code;
      const configured = context.knowledge.returnReplacements[key] ?? [];
      for (let index = 0; index < configured.length; index += 1) {
        const option = configured[index]!;
        const patches = replaceReturnExpression(
          context,
          diagnostic.compiler,
          option.source,
        );
        if (patches.length === 0) continue;
        candidates.push({
          id: `repair:return-type:${diagnostic.id}:${index}`,
          kind: "return-type",
          diagnosticIds: [diagnostic.id],
          pirOperations: [],
          sourcePatches: patches,
          expectedRemovedCodes: [diagnostic.compiler.code],
          cost: option.cost ?? 2,
          rationale:
            "Replace the implicated return/type expression with a configured type-compatible form.",
          evidenceRefs: [
            `diagnostic:${diagnostic.id}`,
            `knowledge:return:${key}`,
          ],
        });
      }
    }
    return candidates;
  }
}

export const coreRepairGenerators = (): RepairGenerator[] => [
  new AddGuardRepairGenerator(),
  new ImportSymbolRepairGenerator(),
  new ArgumentRepairGenerator(),
  new ReturnTypeRepairGenerator(),
];

export const generateRepairCandidates = (
  context: RepairGenerationContext,
  generators: readonly RepairGenerator[] = coreRepairGenerators(),
): RepairCandidate[] => {
  const byId = new Map<string, RepairCandidate>();
  for (const generator of generators) {
    if (!generator.supports(context)) continue;
    for (const candidate of generator.generate(context)) {
      if (!byId.has(candidate.id)) {
        byId.set(candidate.id, structuredClone(candidate));
      }
    }
  }
  return [...byId.values()].sort(
    (a, b) => a.cost - b.cost || a.id.localeCompare(b.id),
  );
};
