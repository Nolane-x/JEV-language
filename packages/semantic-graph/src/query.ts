import type {
  GraphSnapshot,
  JsgNode,
  JsgNodeKind,
} from "./nodes.ts";

export interface SemanticSelector {
  kind?: JsgNodeKind | JsgNodeKind[];
  idPrefix?: string;
  predicate?: (node: JsgNode) => boolean;
}

export const selectNodes = (
  snapshot: GraphSnapshot,
  selector: SemanticSelector,
): JsgNode[] => {
  const kinds =
    selector.kind === undefined
      ? undefined
      : new Set(
          Array.isArray(selector.kind) ? selector.kind : [selector.kind],
        );
  return snapshot.nodes
    .filter((node) => kinds === undefined || kinds.has(node.kind))
    .filter(
      (node) =>
        selector.idPrefix === undefined || node.id.startsWith(selector.idPrefix),
    )
    .filter((node) => selector.predicate?.(node) ?? true)
    .map((node) => structuredClone(node));
};
