import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  ConstraintNode,
  GraphSnapshot,
  RelationNode,
  SemanticValue,
} from "../../semantic-graph/src/index.ts";
import type {
  ClausePlan,
  DiscoursePlan,
  DiscourseRelation,
  DiscourseUnit,
  OrderingConstraint,
} from "./index.ts";

const unitForSemanticRef = (
  units: readonly DiscourseUnit[],
  ref: SemanticId,
): DiscourseUnit | undefined =>
  units.find((unit) => unit.semanticRefs.includes(ref));

const relationNode = (
  snapshot: GraphSnapshot,
  ref: SemanticId,
): RelationNode | undefined =>
  snapshot.nodes.find(
    (node): node is RelationNode =>
      node.id === ref && node.kind === "relation",
  );

const conditionNode = (
  snapshot: GraphSnapshot,
  ref: SemanticId,
): ConstraintNode | undefined =>
  snapshot.nodes.find(
    (node): node is ConstraintNode =>
      node.id === ref &&
      node.kind === "constraint" &&
      node.constraintKind === "condition",
  );

export interface RichDiscoursePlanningResult {
  relations: DiscourseRelation[];
  orderingConstraints: OrderingConstraint[];
}

export const planSemanticDiscourseRelations = (
  snapshot: GraphSnapshot,
  units: readonly DiscourseUnit[],
): Result<RichDiscoursePlanningResult> => {
  const ids = new Set(units.map((unit) => unit.id));
  if (ids.size !== units.length) {
    return err(
      new StructuredError(
        "DIR_RICH_UNIT_DUPLICATE",
        "Richer discourse planning requires unique unit ids.",
      ),
    );
  }

  const relations: DiscourseRelation[] = [];
  const orderingConstraints: OrderingConstraint[] = [];

  for (const unit of units) {
    for (const ref of unit.semanticRefs) {
      const relation = relationNode(snapshot, ref);
      if (
        relation !== undefined &&
        relation.relation === "concept:core.cause"
      ) {
        const target = unitForSemanticRef(units, relation.target);
        if (target !== undefined && target.id !== unit.id) {
          relations.push({
            id: `disc-rel:cause:${unit.id}:${target.id}`,
            kind: "cause",
            nucleus: target.id,
            satellite: unit.id,
            annotations: {
              semanticRelationRef: relation.id,
            },
          });
          orderingConstraints.push({
            id: `disc-order:cause:${unit.id}:${target.id}`,
            before: target.id,
            after: unit.id,
            kind: "logical-prerequisite",
            hard: false,
            rationale:
              "State the affected proposition before a following causal explanation unless style overrides it.",
          });
        }
      }

      const condition = conditionNode(snapshot, ref);
      if (condition !== undefined) {
        const target = unitForSemanticRef(units, condition.subject);
        if (target !== undefined && target.id !== unit.id) {
          relations.push({
            id: `disc-rel:condition:${unit.id}:${target.id}`,
            kind: "condition",
            nucleus: target.id,
            satellite: unit.id,
            annotations: {
              semanticConditionRef: condition.id,
            },
          });
          orderingConstraints.push({
            id: `disc-order:condition:${unit.id}:${target.id}`,
            before: unit.id,
            after: target.id,
            kind: "logical-prerequisite",
            hard: true,
            rationale:
              "The controlled conditional antecedent must precede its consequence.",
          });
        }
      }
    }
  }

  return ok({
    relations: relations.sort((a, b) => a.id.localeCompare(b.id)),
    orderingConstraints: orderingConstraints.sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  });
};

export const enrichDiscoursePlan = (
  snapshot: GraphSnapshot,
  plan: DiscoursePlan,
): Result<DiscoursePlan> => {
  const planned = planSemanticDiscourseRelations(snapshot, plan.units);
  if (!planned.ok) return planned;

  const relationIds = new Set(plan.relations.map((relation) => relation.id));
  const orderingIds = new Set(
    plan.orderingConstraints.map((constraint) => constraint.id),
  );
  return ok({
    ...structuredClone(plan),
    relations: [
      ...structuredClone(plan.relations),
      ...planned.value.relations.filter(
        (relation) => !relationIds.has(relation.id),
      ),
    ],
    orderingConstraints: [
      ...structuredClone(plan.orderingConstraints),
      ...planned.value.orderingConstraints.filter(
        (constraint) => !orderingIds.has(constraint.id),
      ),
    ],
  });
};

const semanticValueKey = (value: SemanticValue): string =>
  JSON.stringify(value);

const roleValue = (
  clause: ClausePlan,
  role: SemanticId,
): SemanticValue | undefined =>
  clause.roles.find((entry) => entry.role === role)?.value;

const modalityKey = (clause: ClausePlan): string =>
  JSON.stringify(clause.modality ?? null);

export interface AggregationCandidate {
  id: string;
  kind:
    | "shared-subject-coordination"
    | "shared-predicate-coordination";
  clauseIds: string[];
  sharedRole?: SemanticId;
  semanticSafety: {
    samePolarity: true;
    sameModality: true;
    sameClauseType: true;
  };
  annotations?: Record<string, JsonValue>;
}

export const planSafeClauseAggregation = (
  plan: DiscoursePlan,
  clauses: readonly ClausePlan[],
): Result<AggregationCandidate[]> => {
  const unitById = new Map(plan.units.map((unit) => [unit.id, unit] as const));
  for (const clause of clauses) {
    if (!unitById.has(clause.sourceUnitId)) {
      return err(
        new StructuredError(
          "DIR_AGGREGATION_UNIT_MISSING",
          `Clause ${clause.id} references missing discourse unit ${clause.sourceUnitId}.`,
        ),
      );
    }
  }

  const output: AggregationCandidate[] = [];
  for (let leftIndex = 0; leftIndex < clauses.length; leftIndex += 1) {
    const left = clauses[leftIndex];
    if (left === undefined || left.clauseType !== "declarative") continue;
    const leftUnit = unitById.get(left.sourceUnitId);
    if (
      leftUnit === undefined ||
      leftUnit.kind === "condition" ||
      leftUnit.kind === "question"
    ) {
      continue;
    }

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < clauses.length;
      rightIndex += 1
    ) {
      const right = clauses[rightIndex];
      if (
        right === undefined ||
        right.clauseType !== left.clauseType ||
        right.polarity !== left.polarity ||
        modalityKey(right) !== modalityKey(left)
      ) {
        continue;
      }
      const rightUnit = unitById.get(right.sourceUnitId);
      if (
        rightUnit === undefined ||
        rightUnit.kind === "condition" ||
        rightUnit.kind === "question"
      ) {
        continue;
      }

      const agentRole = "role:core.agent" as SemanticId;
      const leftAgent = roleValue(left, agentRole);
      const rightAgent = roleValue(right, agentRole);
      if (
        leftAgent !== undefined &&
        rightAgent !== undefined &&
        semanticValueKey(leftAgent) === semanticValueKey(rightAgent)
      ) {
        output.push({
          id: `aggregation:shared-subject:${left.id}:${right.id}`,
          kind: "shared-subject-coordination",
          clauseIds: [left.id, right.id],
          sharedRole: agentRole,
          semanticSafety: {
            samePolarity: true,
            sameModality: true,
            sameClauseType: true,
          },
        });
        continue;
      }

      if (left.predicate === right.predicate) {
        output.push({
          id: `aggregation:shared-predicate:${left.id}:${right.id}`,
          kind: "shared-predicate-coordination",
          clauseIds: [left.id, right.id],
          semanticSafety: {
            samePolarity: true,
            sameModality: true,
            sameClauseType: true,
          },
        });
      }
    }
  }

  return ok(output.sort((a, b) => a.id.localeCompare(b.id)));
};
