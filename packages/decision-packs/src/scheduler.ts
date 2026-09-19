import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  DecisionPackManifest,
} from "./index.ts";

export type CandidateSourceKind =
  | "parsed-input"
  | "lexicon"
  | "grammar-rule"
  | "ontology-relation"
  | "program-grammar"
  | "consumer"
  | "configured";

export interface CandidateSourceBinding {
  id: string;
  kind: CandidateSourceKind;
  sourceRef: string;
  questionIds: string[];
}

export interface DecisionNode {
  id: string;
  questionId: string;
  dependsOn: string[];
  stateProjection: string;
}

export interface DecisionDag {
  nodes: DecisionNode[];
}

export interface DecisionBatchPlan {
  batchIndex: number;
  nodeIds: string[];
  questionIds: string[];
}

export const validateCandidateSourceBindings = (
  manifest: DecisionPackManifest,
  bindings: readonly CandidateSourceBinding[],
): Result<CandidateSourceBinding[]> => {
  const ids = new Set<string>();
  for (const binding of bindings) {
    if (binding.id.trim() === "" || binding.sourceRef.trim() === "") {
      return err(
        new StructuredError(
          "DPACK_CANDIDATE_SOURCE_REQUIRED",
          "Candidate-source bindings require non-empty ids and source references.",
        ),
      );
    }
    if (ids.has(binding.id)) {
      return err(
        new StructuredError(
          "DPACK_CANDIDATE_SOURCE_DUPLICATE",
          `Duplicate candidate-source binding id: ${binding.id}.`,
        ),
      );
    }
    ids.add(binding.id);
    for (const questionId of binding.questionIds) {
      if (manifest.questions[questionId] === undefined) {
        return err(
          new StructuredError(
            "DPACK_CANDIDATE_SOURCE_QUESTION",
            `Candidate-source binding ${binding.id} references unknown question ${questionId}.`,
          ),
        );
      }
    }
  }
  return ok(bindings.map((binding) => structuredClone(binding)));
};

export const scheduleDecisionDag = (
  manifest: DecisionPackManifest,
  dag: DecisionDag,
): Result<DecisionBatchPlan[]> => {
  const byId = new Map<string, DecisionNode>();
  for (const node of dag.nodes) {
    if (
      node.id.trim() === "" ||
      node.questionId.trim() === "" ||
      node.stateProjection.trim() === ""
    ) {
      return err(
        new StructuredError(
          "DPACK_DAG_NODE_REQUIRED",
          "Decision DAG nodes require id, questionId, and stateProjection.",
        ),
      );
    }
    if (byId.has(node.id)) {
      return err(
        new StructuredError(
          "DPACK_DAG_NODE_DUPLICATE",
          `Duplicate decision DAG node id: ${node.id}.`,
        ),
      );
    }
    if (manifest.questions[node.questionId] === undefined) {
      return err(
        new StructuredError(
          "DPACK_DAG_QUESTION_UNKNOWN",
          `Decision DAG node ${node.id} references unknown question ${node.questionId}.`,
        ),
      );
    }
    byId.set(node.id, structuredClone(node));
  }

  for (const node of byId.values()) {
    for (const dependency of node.dependsOn) {
      if (!byId.has(dependency)) {
        return err(
          new StructuredError(
            "DPACK_DAG_DEPENDENCY_UNKNOWN",
            `Decision DAG node ${node.id} depends on missing node ${dependency}.`,
          ),
        );
      }
      if (dependency === node.id) {
        return err(
          new StructuredError(
            "DPACK_DAG_CYCLE",
            `Decision DAG node ${node.id} cannot depend on itself.`,
          ),
        );
      }
    }
  }

  const indegree = new Map<string, number>(
    [...byId.keys()].map((id) => [id, 0]),
  );
  const outgoing = new Map<string, string[]>(
    [...byId.keys()].map((id) => [id, []]),
  );
  for (const node of byId.values()) {
    for (const dependency of node.dependsOn) {
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
      outgoing.get(dependency)?.push(node.id);
    }
  }

  const remaining = new Set(byId.keys());
  const batches: DecisionBatchPlan[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) => (indegree.get(id) ?? 0) === 0)
      .sort();
    if (ready.length === 0) {
      return err(
        new StructuredError(
          "DPACK_DAG_CYCLE",
          "Decision DAG dependencies contain a cycle.",
        ),
      );
    }

    batches.push({
      batchIndex: batches.length,
      nodeIds: ready,
      questionIds: ready.map((id) => byId.get(id)!.questionId),
    });
    for (const id of ready) {
      remaining.delete(id);
      for (const child of outgoing.get(id) ?? []) {
        indegree.set(child, (indegree.get(child) ?? 0) - 1);
      }
    }
  }

  return ok(batches);
};
