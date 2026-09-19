import {
  canonicalJson,
  err,
  ok,
  sha256,
  StructuredError,
  type JsonValue,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type { ProvenanceRef } from "../../provenance/src/index.ts";
import type {
  Diagnostic,
  GraphSnapshot,
  JsgNode,
} from "./nodes.ts";

export type GraphOperation =
  | { kind: "add-node"; node: JsgNode }
  | { kind: "remove-node"; id: SemanticId }
  | { kind: "replace-node"; node: JsgNode }
  | { kind: "attach-provenance"; id: SemanticId; provenance: ProvenanceRef }
  | { kind: "attach-annotation"; id: SemanticId; key: string; value: JsonValue };

export type GraphPrecondition =
  | { kind: "revision-is"; revision: string }
  | { kind: "node-exists"; id: SemanticId }
  | { kind: "node-absent"; id: SemanticId };

export interface GraphTransaction {
  baseRevision: string;
  operations: GraphOperation[];
  preconditions: GraphPrecondition[];
}

export interface GraphCommit {
  revision: string;
  parentRevision: string;
  snapshot: GraphSnapshot;
}

export type GraphValidator = (snapshot: GraphSnapshot) => Diagnostic[];

/** Stable public semantic-graph value used at package boundaries. */
export type JsgGraph = GraphSnapshot;

const cloneNode = <T extends JsgNode>(node: T): T => structuredClone(node);

const snapshotToJson = (snapshot: GraphSnapshot): JsonValue => ({
  schemaVersion: snapshot.schemaVersion,
  ontologyVersion: snapshot.ontologyVersion,
  revision: snapshot.revision,
  ...(snapshot.parentRevision === undefined
    ? {}
    : { parentRevision: snapshot.parentRevision }),
  nodes: snapshot.nodes
    .map((node) => structuredClone(node) as unknown as JsonValue)
    .sort((a, b) => {
      const aId = (a as { id: string }).id;
      const bId = (b as { id: string }).id;
      return aId.localeCompare(bId);
    }),
});

export const canonicalSnapshotJson = (snapshot: GraphSnapshot): string =>
  canonicalJson(snapshotToJson(snapshot));

export class InMemorySemanticGraph {
  #nodes = new Map<SemanticId, JsgNode>();
  #revision: string;
  readonly schemaVersion: string;
  readonly ontologyVersion: string;

  constructor(
    schemaVersion = "0.1.0",
    ontologyVersion = "0.1.0",
    initial: JsgNode[] = [],
  ) {
    this.schemaVersion = schemaVersion;
    this.ontologyVersion = ontologyVersion;
    for (const node of initial) this.#nodes.set(node.id, cloneNode(node));
    this.#revision = this.#deriveRevision("genesis", []);
  }

  static fromSnapshot(snapshot: GraphSnapshot): InMemorySemanticGraph {
    const graph = new InMemorySemanticGraph(
      snapshot.schemaVersion,
      snapshot.ontologyVersion,
      snapshot.nodes,
    );
    graph.#revision = snapshot.revision;
    return graph;
  }

  get revision(): string {
    return this.#revision;
  }

  get(id: SemanticId): JsgNode | undefined {
    const value = this.#nodes.get(id);
    return value === undefined ? undefined : cloneNode(value);
  }

  has(id: SemanticId): boolean {
    return this.#nodes.has(id);
  }

  snapshot(): GraphSnapshot {
    return {
      schemaVersion: this.schemaVersion,
      ontologyVersion: this.ontologyVersion,
      revision: this.#revision,
      nodes: [...this.#nodes.values()]
        .map(cloneNode)
        .sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  beginTransaction(operations: GraphOperation[] = []): GraphTransaction {
    return {
      baseRevision: this.#revision,
      operations,
      preconditions: [{ kind: "revision-is", revision: this.#revision }],
    };
  }

  commit(
    transaction: GraphTransaction,
    validate: GraphValidator,
  ): Result<GraphCommit> {
    const preconditionError = this.#checkPreconditions(transaction);
    if (preconditionError !== undefined) return err(preconditionError);

    const candidate = new Map<SemanticId, JsgNode>();
    for (const [id, node] of this.#nodes.entries()) candidate.set(id, cloneNode(node));

    for (const operation of transaction.operations) {
      const applyError = this.#apply(candidate, operation);
      if (applyError !== undefined) return err(applyError);
    }

    const parentRevision = this.#revision;
    const revision = this.#deriveRevision(
      parentRevision,
      transaction.operations,
    );
    const candidateSnapshot: GraphSnapshot = {
      schemaVersion: this.schemaVersion,
      ontologyVersion: this.ontologyVersion,
      revision,
      parentRevision,
      nodes: [...candidate.values()]
        .map(cloneNode)
        .sort((a, b) => a.id.localeCompare(b.id)),
    };

    const diagnostics = validate(candidateSnapshot);
    const blocking = diagnostics.filter(
      (diagnostic) =>
        diagnostic.severity === "error" || diagnostic.severity === "fatal",
    );
    if (blocking.length > 0) {
      return err(
        new StructuredError(
          "JSG_TRANSACTION_VALIDATION_FAILED",
          "Graph transaction failed semantic validation.",
          blocking as unknown as JsonValue,
        ),
      );
    }

    this.#nodes = candidate;
    this.#revision = revision;
    return ok({
      revision,
      parentRevision,
      snapshot: candidateSnapshot,
    });
  }

  #checkPreconditions(transaction: GraphTransaction): StructuredError | undefined {
    if (transaction.baseRevision !== this.#revision) {
      return new StructuredError(
        "JSG_REVISION_CONFLICT",
        "Transaction base revision does not match current graph revision.",
      );
    }
    for (const precondition of transaction.preconditions) {
      switch (precondition.kind) {
        case "revision-is":
          if (precondition.revision !== this.#revision) {
            return new StructuredError(
              "JSG_PRECONDITION_REVISION",
              "Revision precondition failed.",
            );
          }
          break;
        case "node-exists":
          if (!this.#nodes.has(precondition.id)) {
            return new StructuredError(
              "JSG_PRECONDITION_NODE_MISSING",
              `Required node does not exist: ${precondition.id}`,
            );
          }
          break;
        case "node-absent":
          if (this.#nodes.has(precondition.id)) {
            return new StructuredError(
              "JSG_PRECONDITION_NODE_PRESENT",
              `Node must be absent: ${precondition.id}`,
            );
          }
          break;
      }
    }
    return undefined;
  }

  #apply(
    candidate: Map<SemanticId, JsgNode>,
    operation: GraphOperation,
  ): StructuredError | undefined {
    switch (operation.kind) {
      case "add-node":
        if (candidate.has(operation.node.id)) {
          return new StructuredError(
            "JSG_NODE_EXISTS",
            `Node already exists: ${operation.node.id}`,
          );
        }
        candidate.set(operation.node.id, cloneNode(operation.node));
        return undefined;
      case "remove-node":
        if (!candidate.delete(operation.id)) {
          return new StructuredError(
            "JSG_NODE_NOT_FOUND",
            `Cannot remove missing node: ${operation.id}`,
          );
        }
        return undefined;
      case "replace-node":
        if (!candidate.has(operation.node.id)) {
          return new StructuredError(
            "JSG_NODE_NOT_FOUND",
            `Cannot replace missing node: ${operation.node.id}`,
          );
        }
        candidate.set(operation.node.id, cloneNode(operation.node));
        return undefined;
      case "attach-provenance": {
        const node = candidate.get(operation.id);
        if (node === undefined) {
          return new StructuredError(
            "JSG_NODE_NOT_FOUND",
            `Cannot attach provenance to missing node: ${operation.id}`,
          );
        }
        const provenance = [...new Set([...node.provenance, operation.provenance])];
        candidate.set(operation.id, { ...cloneNode(node), provenance });
        return undefined;
      }
      case "attach-annotation": {
        const node = candidate.get(operation.id);
        if (node === undefined) {
          return new StructuredError(
            "JSG_NODE_NOT_FOUND",
            `Cannot annotate missing node: ${operation.id}`,
          );
        }
        candidate.set(operation.id, {
          ...cloneNode(node),
          annotations: { ...(node.annotations ?? {}), [operation.key]: operation.value },
        });
        return undefined;
      }
    }
  }

  #deriveRevision(parent: string, operations: GraphOperation[]): string {
    const payload = canonicalJson({
      parent,
      schemaVersion: this.schemaVersion,
      ontologyVersion: this.ontologyVersion,
      operations: operations as unknown as JsonValue,
    });
    return `rev:${sha256(payload).slice("sha256:".length)}`;
  }
}

export interface SemanticDiff {
  added: SemanticId[];
  removed: SemanticId[];
  changed: SemanticId[];
}

export const semanticDiff = (
  before: GraphSnapshot,
  after: GraphSnapshot,
): SemanticDiff => {
  const left = new Map(before.nodes.map((node) => [node.id, node]));
  const right = new Map(after.nodes.map((node) => [node.id, node]));
  const ids = [...new Set([...left.keys(), ...right.keys()])].sort();

  const diff: SemanticDiff = { added: [], removed: [], changed: [] };
  for (const id of ids) {
    const a = left.get(id);
    const b = right.get(id);
    if (a === undefined && b !== undefined) diff.added.push(id);
    else if (a !== undefined && b === undefined) diff.removed.push(id);
    else if (
      a !== undefined &&
      b !== undefined &&
      canonicalJson(a as unknown as JsonValue) !==
        canonicalJson(b as unknown as JsonValue)
    ) {
      diff.changed.push(id);
    }
  }
  return diff;
};
