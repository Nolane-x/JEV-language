import {
  samePirType,
  type EffectSpec,
  type PirExpression,
  type PirProgram,
  type PirStatement,
  type ProgramHole,
} from "../../program-ir/src/index.ts";
import type {
  CandidateGenerationContext,
  ExpansionCandidate,
} from "./model.ts";
import { applyExpansionCandidate } from "./apply.ts";

const allowedEffectKinds = (hole: ProgramHole): Set<string> | undefined => {
  if (hole.expectedEffect === undefined) return undefined;
  return new Set(
    Array.isArray(hole.expectedEffect)
      ? hole.expectedEffect
      : [hole.expectedEffect],
  );
};

const candidateEffectKinds = (effects: readonly EffectSpec[]): string[] =>
  effects
    .map((effect) => effect.kind)
    .filter((kind) => kind !== "pure");

const collectRefs = (
  expression: PirExpression,
  into: Set<string> = new Set<string>(),
): Set<string> => {
  switch (expression.kind) {
    case "variable":
    case "symbol-ref":
      into.add(expression.symbolId);
      break;
    case "property":
    case "field-access":
      collectRefs(expression.object, into);
      break;
    case "index-access":
      collectRefs(expression.object, into);
      collectRefs(expression.index, into);
      break;
    case "call":
      collectRefs(expression.callee, into);
      expression.arguments.forEach((value) => collectRefs(value, into));
      break;
    case "construct":
      expression.arguments.forEach((value) => collectRefs(value, into));
      break;
    case "unary":
      collectRefs(expression.operand, into);
      break;
    case "binary":
    case "comparison":
      collectRefs(expression.left, into);
      collectRefs(expression.right, into);
      break;
    case "logical":
      expression.values.forEach((value) => collectRefs(value, into));
      break;
    case "conditional":
      collectRefs(expression.condition, into);
      collectRefs(expression.whenTrue, into);
      collectRefs(expression.whenFalse, into);
      break;
    case "lambda":
      collectRefs(expression.body, into);
      expression.parameters.forEach((parameter) => into.delete(parameter.id));
      break;
    case "await":
    case "cast":
      collectRefs(expression.value, into);
      break;
    case "collection":
      expression.elements.forEach((value) => collectRefs(value, into));
      break;
    case "record":
      Object.values(expression.fields).forEach((value) => collectRefs(value, into));
      break;
    case "match":
      collectRefs(expression.value, into);
      expression.cases.forEach((entry) => collectRefs(entry.expression, into));
      break;
    case "filter":
      collectRefs(expression.collection, into);
      collectRefs(expression.predicate, into);
      into.delete(expression.item.id);
      break;
    case "map":
      collectRefs(expression.collection, into);
      collectRefs(expression.mapper, into);
      into.delete(expression.item.id);
      break;
    case "hole":
    case "literal":
      break;
  }
  return into;
};

const collectStatementRefs = (
  statements: readonly PirStatement[],
  into: Set<string> = new Set<string>(),
): Set<string> => {
  for (const statement of statements) {
    switch (statement.kind) {
      case "declare":
        if (statement.initializer !== undefined) {
          collectRefs(statement.initializer, into);
        }
        into.delete(statement.symbol.id);
        break;
      case "assign":
        collectRefs(statement.target, into);
        collectRefs(statement.value, into);
        break;
      case "expression":
        collectRefs(statement.expression, into);
        break;
      case "return":
        if (statement.value !== undefined) collectRefs(statement.value, into);
        break;
      case "if":
        collectRefs(statement.condition, into);
        collectStatementRefs(statement.then, into);
        collectStatementRefs(statement.else ?? [], into);
        break;
      case "loop":
        if (statement.condition !== undefined) {
          collectRefs(statement.condition, into);
        }
        collectStatementRefs(statement.body, into);
        break;
      case "for-each":
        collectRefs(statement.collection, into);
        collectStatementRefs(statement.body, into);
        into.delete(statement.item.id);
        break;
      case "match":
        collectRefs(statement.value, into);
        statement.cases.forEach((entry) =>
          collectStatementRefs(entry.body, into),
        );
        collectStatementRefs(statement.default ?? [], into);
        break;
      case "try":
        collectStatementRefs(statement.body, into);
        collectStatementRefs(statement.catch?.body ?? [], into);
        if (statement.catch?.parameter !== undefined) {
          into.delete(statement.catch.parameter.id);
        }
        collectStatementRefs(statement.finally ?? [], into);
        break;
      case "throw":
        collectRefs(statement.value, into);
        break;
      case "assert":
        collectRefs(statement.condition, into);
        break;
      case "defer":
        collectStatementRefs(statement.body, into);
        break;
      case "block":
        collectStatementRefs(statement.statements, into);
        break;
      case "break":
      case "continue":
      case "hole":
        break;
    }
  }
  return into;
};

const programCallableIds = (program: PirProgram): Set<string> =>
  new Set(program.functions.map((fn) => fn.id));

export interface PruningDecision {
  accepted: boolean;
  reasons: string[];
}

export const evaluateHardConstraints = (
  context: CandidateGenerationContext,
  candidate: ExpansionCandidate,
): PruningDecision => {
  const reasons: string[] = [];

  if (!samePirType(candidate.resultType, context.expectedType)) {
    reasons.push("TYPE_MISMATCH");
  }

  const allowed = allowedEffectKinds(context.hole);
  if (allowed !== undefined) {
    for (const effect of candidateEffectKinds(candidate.effects)) {
      if (!allowed.has(effect)) reasons.push(`FORBIDDEN_EFFECT:${effect}`);
    }
  }

  const legalRefs = new Set([
    ...context.scopeSymbols,
    ...programCallableIds(context.state.program),
  ]);
  const referenced =
    candidate.replacement.kind === "expression"
      ? collectRefs(candidate.replacement.value)
      : collectStatementRefs(candidate.replacement.value);
  for (const ref of referenced) {
    if (!legalRefs.has(ref)) reasons.push(`OUT_OF_SCOPE:${ref}`);
  }

  const applied = applyExpansionCandidate(
    context.state.program,
    context.functionId,
    context.hole.id,
    candidate,
  );
  if (!applied.ok) {
    reasons.push(`PIR_INVALID:${applied.error.code}`);
  }

  return {
    accepted: reasons.length === 0,
    reasons: [...new Set(reasons)].sort(),
  };
};

export const hardPruneCandidates = (
  context: CandidateGenerationContext,
  candidates: readonly ExpansionCandidate[],
): {
  accepted: ExpansionCandidate[];
  rejected: Array<{ candidate: ExpansionCandidate; reasons: string[] }>;
} => {
  const accepted: ExpansionCandidate[] = [];
  const rejected: Array<{
    candidate: ExpansionCandidate;
    reasons: string[];
  }> = [];

  for (const candidate of candidates) {
    const decision = evaluateHardConstraints(context, candidate);
    if (decision.accepted) accepted.push(structuredClone(candidate));
    else {
      rejected.push({
        candidate: structuredClone(candidate),
        reasons: decision.reasons,
      });
    }
  }

  return {
    accepted: accepted.sort(
      (a, b) =>
        a.heuristicCost - b.heuristicCost || a.id.localeCompare(b.id),
    ),
    rejected,
  };
};
