import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  Diagnostic,
  GraphSnapshot,
  JsgNode,
  QuantifierNode,
  QuantityConstraint,
  ScopeConstraintNode,
  ScopeNode,
  ScopeRelation,
} from "./nodes.ts";

const nodeMap = (snapshot: GraphSnapshot): Map<SemanticId, JsgNode> =>
  new Map(snapshot.nodes.map((node) => [node.id, node] as const));

const scopeMap = (snapshot: GraphSnapshot): Map<SemanticId, ScopeNode> =>
  new Map(
    snapshot.nodes
      .filter((node): node is ScopeNode => node.kind === "scope")
      .map((node) => [node.id, node] as const),
  );

const hardConstraint = (constraint: ScopeConstraintNode): boolean =>
  constraint.status === "asserted" || constraint.status === "derived";

const canonicalPair = (left: SemanticId, right: SemanticId): string =>
  left.localeCompare(right) <= 0 ? `${left}|${right}` : `${right}|${left}`;

const quantityConstraintDiagnostic = (
  node: QuantifierNode,
  constraint: QuantityConstraint,
): Diagnostic | undefined => {
  const finiteNonNegative = (value: number): boolean =>
    Number.isFinite(value) && value >= 0;

  switch (constraint.kind) {
    case "exact":
    case "at-least":
    case "at-most":
      return finiteNonNegative(constraint.value)
        ? undefined
        : {
            code: "JSG066_QUANTIFIER_CARDINALITY_INVALID",
            severity: "error",
            message: `Quantifier ${node.id} has invalid ${constraint.kind} cardinality.`,
            nodeRefs: [node.id],
          };
    case "between":
      return finiteNonNegative(constraint.minimum) &&
        finiteNonNegative(constraint.maximum) &&
        constraint.minimum <= constraint.maximum
        ? undefined
        : {
            code: "JSG066_QUANTIFIER_CARDINALITY_INVALID",
            severity: "error",
            message: `Quantifier ${node.id} has an invalid between cardinality interval.`,
            nodeRefs: [node.id],
          };
    case "proportion":
      return Number.isFinite(constraint.value) &&
        constraint.value >= 0 &&
        constraint.value <= 1
        ? undefined
        : {
            code: "JSG066_QUANTIFIER_CARDINALITY_INVALID",
            severity: "error",
            message: `Quantifier ${node.id} has a proportional value outside [0, 1].`,
            nodeRefs: [node.id],
          };
    case "comparative":
      return finiteNonNegative(constraint.value)
        ? undefined
        : {
            code: "JSG066_QUANTIFIER_CARDINALITY_INVALID",
            severity: "error",
            message: `Quantifier ${node.id} has invalid comparative cardinality.`,
            nodeRefs: [node.id],
          };
    case "approximate":
      return finiteNonNegative(constraint.value) &&
        (constraint.tolerance === undefined ||
          finiteNonNegative(constraint.tolerance))
        ? undefined
        : {
            code: "JSG066_QUANTIFIER_CARDINALITY_INVALID",
            severity: "error",
            message: `Quantifier ${node.id} has invalid approximate cardinality metadata.`,
            nodeRefs: [node.id],
          };
  }
};

const expectedCardinalityKind = (
  node: QuantifierNode,
): QuantityConstraint["kind"] | undefined => {
  switch (node.quantifierKind) {
    case "exactly-N":
      return "exact";
    case "at-least-N":
      return "at-least";
    case "at-most-N":
      return "at-most";
    case "between-N-M":
      return "between";
    case "proportional":
      return "proportion";
    default:
      return undefined;
  }
};

const validateQuantifier = (
  node: QuantifierNode,
  scopes: ReadonlyMap<SemanticId, ScopeNode>,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const scope = scopes.get(node.scope);
  if (scope === undefined) {
    diagnostics.push({
      code: "JSG063_QUANTIFIER_SCOPE_INVALID",
      severity: "error",
      message: `Quantifier ${node.id} references missing/non-scope node ${node.scope}.`,
      nodeRefs: [node.id, node.scope],
    });
  } else {
    if (scope.operatorRef !== node.id) {
      diagnostics.push({
        code: "JSG063_QUANTIFIER_SCOPE_INVALID",
        severity: "error",
        message: `Scope ${scope.id} does not identify quantifier ${node.id} as its operator.`,
        nodeRefs: [node.id, scope.id],
      });
    }
    if (scope.bodyRef !== undefined && scope.bodyRef !== node.body) {
      diagnostics.push({
        code: "JSG063_QUANTIFIER_SCOPE_INVALID",
        severity: "error",
        message: `Scope ${scope.id} body does not match quantifier ${node.id} body.`,
        nodeRefs: [node.id, scope.id, node.body],
      });
    }
  }

  const expected = expectedCardinalityKind(node);
  if (expected !== undefined && node.cardinality === undefined) {
    diagnostics.push({
      code: "JSG065_QUANTIFIER_CARDINALITY_REQUIRED",
      severity: "error",
      message: `Quantifier ${node.id} requires ${expected} cardinality semantics.`,
      nodeRefs: [node.id],
    });
  } else if (
    expected !== undefined &&
    node.cardinality !== undefined &&
    node.cardinality.kind !== expected
  ) {
    diagnostics.push({
      code: "JSG065_QUANTIFIER_CARDINALITY_REQUIRED",
      severity: "error",
      message: `Quantifier ${node.id} requires ${expected} cardinality but carries ${node.cardinality.kind}.`,
      nodeRefs: [node.id],
    });
  }

  if (node.quantifierKind === "cardinal" && node.cardinality === undefined) {
    diagnostics.push({
      code: "JSG065_QUANTIFIER_CARDINALITY_REQUIRED",
      severity: "error",
      message: `Cardinal quantifier ${node.id} requires an explicit quantity constraint.`,
      nodeRefs: [node.id],
    });
  }

  if (node.cardinality !== undefined) {
    const invalid = quantityConstraintDiagnostic(node, node.cardinality);
    if (invalid !== undefined) diagnostics.push(invalid);
  }

  return diagnostics;
};

const outscopeCycleDiagnostics = (
  constraints: readonly ScopeConstraintNode[],
): Diagnostic[] => {
  const adjacency = new Map<SemanticId, SemanticId[]>();
  for (const constraint of constraints) {
    if (
      constraint.relation !== "outscopes" ||
      !hardConstraint(constraint)
    ) {
      continue;
    }
    const values = adjacency.get(constraint.left) ?? [];
    values.push(constraint.right);
    values.sort();
    adjacency.set(constraint.left, values);
    if (!adjacency.has(constraint.right)) adjacency.set(constraint.right, []);
  }

  const visiting = new Set<SemanticId>();
  const visited = new Set<SemanticId>();
  const path: SemanticId[] = [];
  const diagnostics: Diagnostic[] = [];
  const emitted = new Set<string>();

  const visit = (id: SemanticId): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      const cycle = [...path.slice(start), id];
      const key = [...new Set(cycle)].sort().join("|");
      if (!emitted.has(key)) {
        emitted.add(key);
        diagnostics.push({
          code: "JSG062_SCOPE_OUTSCOPES_CYCLE",
          severity: "error",
          message: `Hard outscopes constraints form a cycle: ${cycle.join(" -> ")}.`,
          nodeRefs: [...new Set(cycle)],
        });
      }
      return;
    }

    visiting.add(id);
    path.push(id);
    for (const next of adjacency.get(id) ?? []) visit(next);
    path.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of [...adjacency.keys()].sort()) visit(id);
  return diagnostics;
};

export const validateScopeGraph = (snapshot: GraphSnapshot): Diagnostic[] => {
  const nodes = nodeMap(snapshot);
  const scopes = scopeMap(snapshot);
  const constraints = snapshot.nodes.filter(
    (node): node is ScopeConstraintNode => node.kind === "scope-constraint",
  );
  const diagnostics: Diagnostic[] = [];

  for (const scope of scopes.values()) {
    if (!nodes.has(scope.operatorRef)) {
      diagnostics.push({
        code: "JSG060_SCOPE_OPERATOR_INVALID",
        severity: "error",
        message: `Scope ${scope.id} references missing operator ${scope.operatorRef}.`,
        nodeRefs: [scope.id, scope.operatorRef],
      });
    }
    if (scope.bodyRef !== undefined && !nodes.has(scope.bodyRef)) {
      diagnostics.push({
        code: "JSG060_SCOPE_OPERATOR_INVALID",
        severity: "error",
        message: `Scope ${scope.id} references missing body ${scope.bodyRef}.`,
        nodeRefs: [scope.id, scope.bodyRef],
      });
    }
  }

  const hardRelations = new Map<string, Set<ScopeRelation>>();
  for (const constraint of constraints) {
    const left = scopes.get(constraint.left);
    const right = scopes.get(constraint.right);
    if (left === undefined || right === undefined) {
      diagnostics.push({
        code: "JSG061_SCOPE_CONSTRAINT_TARGET_INVALID",
        severity: "error",
        message: `Scope constraint ${constraint.id} must reference two ScopeNode values.`,
        nodeRefs: [constraint.id, constraint.left, constraint.right],
      });
      continue;
    }

    if (
      constraint.left === constraint.right &&
      (constraint.relation === "outscopes" ||
        constraint.relation === "disjoint")
    ) {
      diagnostics.push({
        code: "JSG064_SCOPE_RELATION_SELF_CONTRADICTION",
        severity: "error",
        message: `Scope constraint ${constraint.id} applies impossible ${constraint.relation} relation to one scope.`,
        nodeRefs: [constraint.id, constraint.left],
      });
    }

    if (hardConstraint(constraint) && constraint.relation !== "unknown") {
      const key = canonicalPair(constraint.left, constraint.right);
      const relations = hardRelations.get(key) ?? new Set<ScopeRelation>();
      relations.add(constraint.relation);
      hardRelations.set(key, relations);
    }
  }

  for (const [pair, relations] of hardRelations.entries()) {
    if (relations.has("same-scope") && relations.has("disjoint")) {
      diagnostics.push({
        code: "JSG067_SCOPE_CONSTRAINT_CONFLICT",
        severity: "error",
        message: `Hard scope constraints conflict for ${pair}: same-scope and disjoint.`,
        details: {
          pair,
          relations: [...relations].sort(),
        } as JsonValue,
      });
    }
  }

  diagnostics.push(...outscopeCycleDiagnostics(constraints));

  for (const node of snapshot.nodes) {
    if (node.kind === "quantifier") {
      diagnostics.push(...validateQuantifier(node, scopes));
      continue;
    }
    if (node.kind === "negation") {
      const scope = scopes.get(node.scope);
      if (
        scope === undefined ||
        scope.operatorRef !== node.id ||
        (scope.bodyRef !== undefined && scope.bodyRef !== node.body)
      ) {
        diagnostics.push({
          code: "JSG068_NEGATION_SCOPE_INVALID",
          severity: "error",
          message: `Negation ${node.id} does not have a matching explicit scope object.`,
          nodeRefs: [node.id, node.scope, node.body],
        });
      }
    }
  }

  return diagnostics;
};

export const createUnresolvedScopeConstraint = (input: {
  id: SemanticId;
  left: SemanticId;
  right: SemanticId;
  schemaVersion: string;
  ontologyVersion: string;
  provenance: ScopeConstraintNode["provenance"];
  trust: ScopeConstraintNode["trust"];
}): ScopeConstraintNode => ({
  id: input.id,
  kind: "scope-constraint",
  schemaVersion: input.schemaVersion,
  ontologyVersion: input.ontologyVersion,
  provenance: [...input.provenance],
  trust: input.trust,
  left: input.left,
  relation: "unknown",
  right: input.right,
  status: "candidate",
});

export const SCOPE_RESOLUTION_TIERS = [
  "hard-grammar",
  "explicit-lexical",
  "discourse",
  "ontology",
  "contextual",
  "jev-judgment",
] as const;

export type ScopeResolutionTier = (typeof SCOPE_RESOLUTION_TIERS)[number];

export interface ScopeResolutionRule {
  id: string;
  tier: ScopeResolutionTier;
  priority?: number;
  kind: "deterministic" | "jev";
  resolve(input: {
    snapshot: GraphSnapshot;
    constraint: ScopeConstraintNode;
  }): ScopeRelation | undefined;
}

export interface ScopeResolutionTraceEntry {
  constraintId: SemanticId;
  ruleId: string;
  tier: ScopeResolutionTier;
  relation: ScopeRelation;
}

export interface ScopeResolutionResult {
  constraints: ScopeConstraintNode[];
  unresolvedConstraintIds: SemanticId[];
  trace: ScopeResolutionTraceEntry[];
}

const tierRank = new Map(
  SCOPE_RESOLUTION_TIERS.map((tier, index) => [tier, index] as const),
);

export const resolveScopeConstraints = (
  snapshot: GraphSnapshot,
  rules: readonly ScopeResolutionRule[],
): Result<ScopeResolutionResult> => {
  const scopeDiagnostics = validateScopeGraph(snapshot).filter(
    (diagnostic) =>
      diagnostic.severity === "error" || diagnostic.severity === "fatal",
  );
  if (scopeDiagnostics.length > 0) {
    return err(
      new StructuredError(
        "JSG_SCOPE_RESOLUTION_INVALID_GRAPH",
        "Cannot resolve scope constraints on an invalid scope graph.",
        scopeDiagnostics as unknown as JsonValue,
      ),
    );
  }

  const ids = new Set<string>();
  for (const rule of rules) {
    if (rule.id.trim() === "" || ids.has(rule.id)) {
      return err(
        new StructuredError(
          "JSG_SCOPE_RULE_INVALID",
          "Scope resolution rules require unique non-empty ids.",
        ),
      );
    }
    ids.add(rule.id);
  }

  const orderedRules = [...rules].sort(
    (left, right) =>
      (tierRank.get(left.tier) ?? Number.MAX_SAFE_INTEGER) -
        (tierRank.get(right.tier) ?? Number.MAX_SAFE_INTEGER) ||
      (right.priority ?? 0) - (left.priority ?? 0) ||
      left.id.localeCompare(right.id),
  );

  const constraints = snapshot.nodes
    .filter(
      (node): node is ScopeConstraintNode => node.kind === "scope-constraint",
    )
    .map((constraint) => structuredClone(constraint))
    .sort((a, b) => a.id.localeCompare(b.id));

  const trace: ScopeResolutionTraceEntry[] = [];
  for (const constraint of constraints) {
    if (constraint.relation !== "unknown") continue;

    for (const tier of SCOPE_RESOLUTION_TIERS) {
      const proposals = orderedRules
        .filter((rule) => rule.tier === tier)
        .map((rule) => ({
          rule,
          relation: rule.resolve({ snapshot, constraint }),
        }))
        .filter(
          (
            value,
          ): value is {
            rule: ScopeResolutionRule;
            relation: Exclude<ScopeRelation, "unknown">;
          } =>
            value.relation !== undefined && value.relation !== "unknown",
        );

      if (proposals.length === 0) continue;
      const relations = [...new Set(proposals.map((item) => item.relation))];
      if (relations.length > 1) {
        return err(
          new StructuredError(
            "JSG_SCOPE_RESOLUTION_CONFLICT",
            `Scope rules at tier ${tier} disagree for ${constraint.id}.`,
            {
              constraintId: constraint.id,
              tier,
              proposals: proposals.map((item) => ({
                ruleId: item.rule.id,
                relation: item.relation,
              })),
            } as JsonValue,
          ),
        );
      }

      const selected = proposals[0];
      if (selected === undefined) continue;
      constraint.relation = selected.relation;
      constraint.status = "derived";
      trace.push({
        constraintId: constraint.id,
        ruleId: selected.rule.id,
        tier,
        relation: selected.relation,
      });
      break;
    }
  }

  return ok({
    constraints,
    unresolvedConstraintIds: constraints
      .filter((constraint) => constraint.relation === "unknown")
      .map((constraint) => constraint.id),
    trace,
  });
};
