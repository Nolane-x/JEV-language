import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import {
  samePirType,
  validatePirProgram,
  type PirExpression,
  type PirFunction,
  type PirProgram,
  type PirType,
} from "../../program-ir/src/index.ts";

export interface SynthesisCandidate {
  id: string;
  program: PirProgram;
  cost: number;
  strategy: string;
}

const replaceHole = (
  expression: PirExpression,
  holeId: string,
  replacement: PirExpression,
): PirExpression => {
  if (expression.kind === "hole" && expression.id === holeId) {
    return structuredClone(replacement);
  }
  if (expression.kind === "property") {
    return {
      ...expression,
      object: replaceHole(expression.object, holeId, replacement),
    };
  }
  if (expression.kind === "filter") {
    return {
      ...expression,
      collection: replaceHole(expression.collection, holeId, replacement),
      predicate: replaceHole(expression.predicate, holeId, replacement),
    };
  }
  return structuredClone(expression);
};

const replaceFunctionBody = (
  program: PirProgram,
  functionId: string,
  body: PirExpression,
  resolvedHoleId?: string,
): PirProgram => {
  const next = structuredClone(program);
  next.functions = next.functions.map((fn) => {
    if (fn.id !== functionId) return fn;
    delete fn.statements;
    fn.body = structuredClone(body);
    return fn;
  });
  if (resolvedHoleId !== undefined && next.holes !== undefined) {
    next.holes = next.holes.filter((hole) => hole.id !== resolvedHoleId);
  }
  return next;
};

export const expandFilterHole = (input: {
  program: PirProgram;
  functionId: string;
  holeId: string;
  property: string;
}): Result<SynthesisCandidate[]> => {
  const fn = input.program.functions.find((candidate) => candidate.id === input.functionId);
  if (
    fn === undefined ||
    fn.body === undefined ||
    fn.body.kind !== "hole" ||
    fn.body.id !== input.holeId
  ) {
    return err(
      new StructuredError(
        "SYNTH_HOLE_NOT_FOUND",
        "Requested top-level typed hole was not found.",
      ),
    );
  }
  const expected = fn.body.expected;
  if (expected.kind !== "list") {
    return err(
      new StructuredError(
        "SYNTH_FILTER_EXPECTED_LIST",
        "Filter synthesis requires a list-typed hole.",
      ),
    );
  }

  const candidates: SynthesisCandidate[] = [];
  for (const parameter of fn.parameters) {
    if (!samePirType(parameter.type, expected) || parameter.type.kind !== "list") {
      continue;
    }
    const itemType: PirType = parameter.type.element;
    if (itemType.kind !== "record") continue;
    const propertyType = itemType.fields[input.property];
    if (propertyType?.kind !== "boolean") continue;

    const item = {
      id: `symbol:${fn.id}:${input.property}:item`,
      name: "user",
      type: itemType,
    };
    const replacement: PirExpression = {
      kind: "filter",
      collection: { kind: "variable", symbolId: parameter.id },
      item,
      predicate: {
        kind: "property",
        object: { kind: "variable", symbolId: item.id },
        property: input.property,
      },
    };
    const program = replaceFunctionBody(
      input.program,
      fn.id,
      replacement,
      input.holeId,
    );
    const valid = validatePirProgram(program);
    if (!valid.ok) continue;
    candidates.push({
      id: `candidate:filter:${parameter.id}:${input.property}`,
      program,
      cost: 1,
      strategy: "FILTER_COLLECTION_BY_BOOLEAN_PROPERTY",
    });
  }

  if (candidates.length === 0) {
    return err(
      new StructuredError(
        "SYNTH_NO_LEGAL_CANDIDATE",
        "No type-correct filter candidate could be generated.",
      ),
    );
  }
  return ok(candidates.sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id)));
};

export const chooseLowestCostCandidate = (
  candidates: SynthesisCandidate[],
): Result<SynthesisCandidate> => {
  const candidate = [...candidates].sort(
    (a, b) => a.cost - b.cost || a.id.localeCompare(b.id),
  )[0];
  return candidate === undefined
    ? err(
        new StructuredError(
          "SYNTH_EMPTY_FRONTIER",
          "Cannot choose from an empty synthesis frontier.",
        ),
      )
    : ok(candidate);
};
