import {
  err,
  isSemanticId,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type { ProvenanceRef } from "../../provenance/src/index.ts";

export type ConceptRef = SemanticId;
export type RelationRef = SemanticId;
export type RoleRef = SemanticId;

export interface ConceptDefinition {
  id: ConceptRef;
  namespace: string;
  labels: Record<string, string>;
  parents: ConceptRef[];
  status: "core" | "domain" | "provisional" | "deprecated";
  definition?: JsonValue;
  provenance?: ProvenanceRef[];
  aliases?: ConceptRef[];
  replacedBy?: ConceptRef;
}

export interface RelationDefinition {
  id: RelationRef;
  namespace: string;
  labels: Record<string, string>;
  domain?: ConceptRef[];
  range?: ConceptRef[];
  provenance?: ProvenanceRef[];
}

export interface RoleDefinition extends RelationDefinition {
  cardinality?: "zero-or-one" | "exactly-one" | "zero-or-many" | "one-or-many";
}

export class NamespaceRegistry {
  #owners = new Map<string, string>();

  register(namespace: string, owner: string): Result<void> {
    const existing = this.#owners.get(namespace);
    if (existing !== undefined && existing !== owner) {
      return err(
        new StructuredError(
          "ONTO_NAMESPACE_COLLISION",
          `Namespace ${namespace} is already owned by ${existing}`,
        ),
      );
    }
    this.#owners.set(namespace, owner);
    return ok(undefined);
  }

  owner(namespace: string): string | undefined {
    return this.#owners.get(namespace);
  }
}

export class OntologyStore {
  #concepts = new Map<ConceptRef, ConceptDefinition>();
  #relations = new Map<RelationRef, RelationDefinition>();
  #roles = new Map<RoleRef, RoleDefinition>();

  addConcept(definition: ConceptDefinition): Result<void> {
    if (!isSemanticId(definition.id)) {
      return err(
        new StructuredError("ONTO_INVALID_CONCEPT_ID", "Concept ID is invalid."),
      );
    }
    if (this.#concepts.has(definition.id)) {
      return err(
        new StructuredError(
          "ONTO_CONCEPT_EXISTS",
          `Concept already exists: ${definition.id}`,
        ),
      );
    }
    for (const parent of definition.parents) {
      if (!this.#concepts.has(parent)) {
        return err(
          new StructuredError(
            "ONTO_INVALID_PARENT",
            `Unknown parent concept: ${parent}`,
          ),
        );
      }
    }
    this.#concepts.set(definition.id, structuredClone(definition));
    return ok(undefined);
  }

  upsertRelation(definition: RelationDefinition): void {
    this.#relations.set(definition.id, structuredClone(definition));
  }

  upsertRole(definition: RoleDefinition): void {
    this.#roles.set(definition.id, structuredClone(definition));
  }

  getConcept(id: ConceptRef): ConceptDefinition | undefined {
    const value = this.#concepts.get(id);
    return value === undefined ? undefined : structuredClone(value);
  }

  getRelation(id: RelationRef): RelationDefinition | undefined {
    const value = this.#relations.get(id);
    return value === undefined ? undefined : structuredClone(value);
  }

  getRole(id: RoleRef): RoleDefinition | undefined {
    const value = this.#roles.get(id);
    return value === undefined ? undefined : structuredClone(value);
  }

  isA(child: ConceptRef, ancestor: ConceptRef): boolean {
    if (child === ancestor) return true;
    const seen = new Set<ConceptRef>();
    const queue: ConceptRef[] = [child];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      const def = this.#concepts.get(current);
      if (def === undefined) continue;
      for (const parent of def.parents) {
        if (parent === ancestor) return true;
        queue.push(parent);
      }
    }
    return false;
  }

  ancestorsOf(id: ConceptRef): ConceptRef[] {
    const output = new Set<ConceptRef>();
    const queue = [...(this.#concepts.get(id)?.parents ?? [])];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || output.has(current)) continue;
      output.add(current);
      queue.push(...(this.#concepts.get(current)?.parents ?? []));
    }
    return [...output].sort();
  }

  relationDomain(id: RelationRef): ConceptRef[] {
    return [...(this.#relations.get(id)?.domain ?? [])];
  }

  relationRange(id: RelationRef): ConceptRef[] {
    return [...(this.#relations.get(id)?.range ?? [])];
  }

  resolveConcept(id: ConceptRef): ConceptDefinition | undefined {
    const direct = this.#concepts.get(id);
    if (direct !== undefined) {
      if (direct.status === "deprecated" && direct.replacedBy !== undefined) {
        return this.resolveConcept(direct.replacedBy);
      }
      return structuredClone(direct);
    }
    for (const definition of this.#concepts.values()) {
      if (definition.aliases?.includes(id)) {
        return structuredClone(definition);
      }
    }
    return undefined;
  }

  deprecateConcept(
    id: ConceptRef,
    replacement?: ConceptRef,
  ): Result<void> {
    const current = this.#concepts.get(id);
    if (current === undefined) {
      return err(
        new StructuredError(
          "ONTO_CONCEPT_NOT_FOUND",
          `Cannot deprecate missing concept: ${id}`,
        ),
      );
    }
    if (replacement !== undefined && !this.#concepts.has(replacement)) {
      return err(
        new StructuredError(
          "ONTO_REPLACEMENT_NOT_FOUND",
          `Replacement concept does not exist: ${replacement}`,
        ),
      );
    }
    this.#concepts.set(id, {
      ...structuredClone(current),
      status: "deprecated",
      ...(replacement === undefined ? {} : { replacedBy: replacement }),
    });
    return ok(undefined);
  }

  mergeConcepts(definitions: ConceptDefinition[]): Result<void> {
    const staged = new Map<ConceptRef, ConceptDefinition>();
    for (const [id, definition] of this.#concepts.entries()) {
      staged.set(id, structuredClone(definition));
    }

    const incoming = new Set<ConceptRef>();
    for (const definition of definitions) {
      if (incoming.has(definition.id) || staged.has(definition.id)) {
        return err(
          new StructuredError(
            "ONTO_CONCEPT_EXISTS",
            `Concept already exists in merge transaction: ${definition.id}`,
          ),
        );
      }
      incoming.add(definition.id);
      staged.set(definition.id, structuredClone(definition));
    }

    for (const definition of definitions) {
      for (const parent of definition.parents) {
        if (!staged.has(parent)) {
          return err(
            new StructuredError(
              "ONTO_INVALID_PARENT",
              `Unknown parent concept in merge transaction: ${parent}`,
            ),
          );
        }
      }
    }

    const visiting = new Set<ConceptRef>();
    const visited = new Set<ConceptRef>();
    const visit = (id: ConceptRef): boolean => {
      if (visiting.has(id)) return false;
      if (visited.has(id)) return true;
      visiting.add(id);
      for (const parent of staged.get(id)?.parents ?? []) {
        if (!visit(parent)) return false;
      }
      visiting.delete(id);
      visited.add(id);
      return true;
    };

    for (const id of staged.keys()) {
      if (!visit(id)) {
        return err(
          new StructuredError(
            "ONTO_PARENT_CYCLE",
            "Ontology merge would introduce a parent cycle.",
          ),
        );
      }
    }

    this.#concepts = staged;
    return ok(undefined);
  }

  snapshot(): {
    concepts: ConceptDefinition[];
    relations: RelationDefinition[];
    roles: RoleDefinition[];
  } {
    const sortById = <T extends { id: string }>(values: T[]): T[] =>
      values.sort((a, b) => a.id.localeCompare(b.id));
    return {
      concepts: sortById(
        [...this.#concepts.values()].map((value) => structuredClone(value)),
      ),
      relations: sortById(
        [...this.#relations.values()].map((value) => structuredClone(value)),
      ),
      roles: sortById(
        [...this.#roles.values()].map((value) => structuredClone(value)),
      ),
    };
  }
}

const coreConcept = (id: ConceptRef, label: string): ConceptDefinition => ({
  id,
  namespace: "core",
  labels: { en: label },
  parents: [],
  status: "core",
});

export const createCoreOntology = (): OntologyStore => {
  const store = new OntologyStore();
  const concepts: Array<[ConceptRef, string]> = [
    ["concept:core.entity", "entity"],
    ["concept:core.event", "event"],
    ["concept:core.action", "action"],
    ["concept:core.software-service", "software service"],
    ["concept:core.file", "file"],
    ["concept:core.delete", "delete"],
    ["concept:core.maximum-cardinality", "maximum cardinality"],
    ["concept:core.requirement", "requirement"],
    ["concept:core.unknown", "unknown"],
  ];
  for (const [id, label] of concepts) {
    const result = store.addConcept(coreConcept(id, label));
    if (!result.ok) throw result.error;
  }
  store.upsertRole({
    id: "role:core.agent",
    namespace: "core",
    labels: { en: "agent" },
    cardinality: "zero-or-one",
  });
  store.upsertRole({
    id: "role:core.quantity-limit",
    namespace: "core",
    labels: { en: "quantity limit" },
    cardinality: "zero-or-one",
  });
  return store;
};

export const provisionalConcept = (
  localId: string,
  label: string,
  parents: ConceptRef[],
  provenance: ProvenanceRef[] = [],
): ConceptDefinition => ({
  id: `concept:provisional.${localId}` as ConceptRef,
  namespace: "provisional",
  labels: { source: label },
  parents,
  status: "provisional",
  provenance,
});
