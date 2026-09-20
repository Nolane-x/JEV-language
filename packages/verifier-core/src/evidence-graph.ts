import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  EvidenceGrade,
  EvidenceRef,
} from "./framework.ts";

export type EvidenceNodeKind =
  | "formal-proof"
  | "compiler"
  | "test"
  | "heuristic"
  | "jev-judgment"
  | "artifact"
  | "observation";

export interface EvidenceGraphNode {
  id: EvidenceRef;
  kind: EvidenceNodeKind;
  grade: EvidenceGrade;
  sourceRef?: string;
  digest?: string;
  metadata?: Record<string, JsonValue>;
}

export type EvidenceEdgeRelation =
  | "supports"
  | "contradicts"
  | "derived-from"
  | "verifies";

export interface EvidenceGraphEdge {
  id: string;
  from: EvidenceRef;
  to: EvidenceRef;
  relation: EvidenceEdgeRelation;
  rationale?: string;
}

export interface EvidenceGraph {
  schemaVersion: "jl-evidence-graph-1";
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
}

const nonEmptyUnique = (values: readonly string[]): boolean =>
  values.every((value) => value.trim() !== "") &&
  new Set(values).size === values.length;

export const validateEvidenceGraph = (
  graph: EvidenceGraph,
): Result<EvidenceGraph> => {
  if (graph.schemaVersion !== "jl-evidence-graph-1") {
    return err(
      new StructuredError(
        "VERIFY_EVIDENCE_GRAPH_SCHEMA",
        "Evidence graph schema version is invalid.",
      ),
    );
  }

  const nodeIds = graph.nodes.map((node) => node.id);
  const edgeIds = graph.edges.map((edge) => edge.id);
  if (!nonEmptyUnique(nodeIds) || !nonEmptyUnique(edgeIds)) {
    return err(
      new StructuredError(
        "VERIFY_EVIDENCE_GRAPH_IDS",
        "Evidence graph node/edge ids must be unique and non-empty.",
      ),
    );
  }

  const known = new Set(nodeIds);
  for (const node of graph.nodes) {
    if (
      ![
        "formal-proof",
        "compiler",
        "test",
        "heuristic",
        "jev-judgment",
        "artifact",
        "observation",
      ].includes(node.kind) ||
      ![
        "formal-deterministic-proof",
        "compiler-static-guarantee",
        "executable-test-evidence",
        "structured-heuristic-evidence",
        "jev-judgment",
        "unverified",
      ].includes(node.grade) ||
      (node.sourceRef !== undefined && node.sourceRef.trim() === "") ||
      (node.digest !== undefined && node.digest.trim() === "")
    ) {
      return err(
        new StructuredError(
          "VERIFY_EVIDENCE_GRAPH_NODE",
          `Invalid evidence node ${node.id}.`,
        ),
      );
    }
  }

  for (const edge of graph.edges) {
    if (
      !known.has(edge.from) ||
      !known.has(edge.to) ||
      edge.from === edge.to ||
      !["supports", "contradicts", "derived-from", "verifies"].includes(
        edge.relation,
      ) ||
      (edge.rationale !== undefined && edge.rationale.trim() === "")
    ) {
      return err(
        new StructuredError(
          "VERIFY_EVIDENCE_GRAPH_EDGE",
          `Invalid evidence edge ${edge.id}.`,
        ),
      );
    }
  }

  const derivedAdjacency = new Map<string, string[]>();
  for (const edge of graph.edges.filter(
    (entry) => entry.relation === "derived-from",
  )) {
    const list = derivedAdjacency.get(edge.from) ?? [];
    list.push(edge.to);
    derivedAdjacency.set(edge.from, list);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return false;
    if (visited.has(node)) return true;
    visiting.add(node);
    for (const next of derivedAdjacency.get(node) ?? []) {
      if (!visit(next)) return false;
    }
    visiting.delete(node);
    visited.add(node);
    return true;
  };
  for (const node of nodeIds) {
    if (!visit(node)) {
      return err(
        new StructuredError(
          "VERIFY_EVIDENCE_GRAPH_CYCLE",
          "derived-from evidence edges must be acyclic.",
        ),
      );
    }
  }

  return ok({
    schemaVersion: graph.schemaVersion,
    nodes: [...graph.nodes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((node) => structuredClone(node)),
    edges: [...graph.edges]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((edge) => structuredClone(edge)),
  });
};

export const evidenceAncestors = (
  graph: EvidenceGraph,
  nodeId: EvidenceRef,
): Result<EvidenceRef[]> => {
  const valid = validateEvidenceGraph(graph);
  if (!valid.ok) return err(valid.error);
  if (!valid.value.nodes.some((node) => node.id === nodeId)) {
    return err(
      new StructuredError(
        "VERIFY_EVIDENCE_GRAPH_UNKNOWN_NODE",
        `Unknown evidence node ${nodeId}.`,
      ),
    );
  }

  const reverse = new Map<string, string[]>();
  for (const edge of valid.value.edges) {
    if (edge.relation !== "derived-from" && edge.relation !== "supports") {
      continue;
    }
    const list = reverse.get(edge.from) ?? [];
    list.push(edge.to);
    reverse.set(edge.from, list);
  }

  const output = new Set<EvidenceRef>();
  const stack: string[] = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const parent of reverse.get(current) ?? []) {
      if (output.has(parent)) continue;
      output.add(parent);
      stack.push(parent);
    }
  }
  return ok([...output].sort());
};
