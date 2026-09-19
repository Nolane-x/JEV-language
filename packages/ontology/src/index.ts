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

export type ConceptKind =
  | "entity"
  | "event"
  | "property"
  | "relation"
  | "action"
  | "abstract";

export interface ConceptConstraint {
  kind: string;
  value?: JsonValue;
}

export interface ConceptComposition {
  components: ConceptRef[];
  definingRelations: Array<{
    relation: RelationRef | RoleRef;
    target: ConceptRef;
  }>;
}

export interface ConceptDefinition {
  id: ConceptRef;
  namespace: string;
  labels: Record<string, string>;
  parents: ConceptRef[];
  status: "core" | "domain" | "provisional" | "deprecated";
  kind?: ConceptKind;
  constraints?: ConceptConstraint[];
  composition?: ConceptComposition;
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

  composeConcept(input: {
    id: ConceptRef;
    namespace: string;
    labels: Record<string, string>;
    components: ConceptRef[];
    definingRelations?: ConceptComposition["definingRelations"];
    parents?: ConceptRef[];
    status?: "domain" | "provisional";
    kind?: ConceptKind;
    constraints?: ConceptConstraint[];
    provenance?: ProvenanceRef[];
  }): Result<ConceptDefinition> {
    if (input.components.length === 0) {
      return err(
        new StructuredError(
          "ONTO_COMPOSITION_EMPTY",
          "A composite concept requires at least one existing component.",
        ),
      );
    }
    if (new Set(input.components).size !== input.components.length) {
      return err(
        new StructuredError(
          "ONTO_COMPOSITION_DUPLICATE_COMPONENT",
          "Composite concept components must be unique.",
        ),
      );
    }
    if (input.components.includes(input.id)) {
      return err(
        new StructuredError(
          "ONTO_COMPOSITION_SELF_REFERENCE",
          "A composite concept cannot include itself as a component.",
        ),
      );
    }

    for (const component of input.components) {
      if (!this.#concepts.has(component)) {
        return err(
          new StructuredError(
            "ONTO_COMPOSITION_UNKNOWN_COMPONENT",
            `Unknown composition component: ${component}`,
          ),
        );
      }
    }

    const definingRelations = input.definingRelations ?? [];
    for (const relation of definingRelations) {
      if (
        !this.#relations.has(relation.relation) &&
        !this.#roles.has(relation.relation)
      ) {
        return err(
          new StructuredError(
            "ONTO_COMPOSITION_UNKNOWN_RELATION",
            `Unknown composition relation: ${relation.relation}`,
          ),
        );
      }
      if (!this.#concepts.has(relation.target)) {
        return err(
          new StructuredError(
            "ONTO_COMPOSITION_UNKNOWN_TARGET",
            `Unknown composition target: ${relation.target}`,
          ),
        );
      }
    }

    const definition: ConceptDefinition = {
      id: input.id,
      namespace: input.namespace,
      labels: structuredClone(input.labels),
      parents: [...(input.parents ?? input.components.slice(0, 1))],
      status: input.status ?? "domain",
      kind: input.kind ?? "abstract",
      constraints: structuredClone(input.constraints ?? []),
      composition: {
        components: [...input.components],
        definingRelations: structuredClone(definingRelations),
      },
      provenance: [...(input.provenance ?? [])],
    };
    const added = this.addConcept(definition);
    return added.ok ? ok(structuredClone(definition)) : err(added.error);
  }

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
    const seen = new Set<ConceptRef>();
    let currentId: ConceptRef = id;

    while (true) {
      if (seen.has(currentId)) return undefined;
      seen.add(currentId);

      const direct = this.#concepts.get(currentId);
      if (direct !== undefined) {
        if (direct.status === "deprecated" && direct.replacedBy !== undefined) {
          currentId = direct.replacedBy;
          continue;
        }
        return structuredClone(direct);
      }

      const aliasTarget = [...this.#concepts.values()].find((definition) =>
        definition.aliases?.includes(currentId),
      );
      if (aliasTarget === undefined) return undefined;
      currentId = aliasTarget.id;
    }
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
    if (replacement === id) {
      return err(
        new StructuredError(
          "ONTO_REPLACEMENT_CYCLE",
          "A concept cannot replace itself.",
        ),
      );
    }
    if (replacement !== undefined) {
      const seen = new Set<ConceptRef>([id]);
      let cursor: ConceptRef | undefined = replacement;
      while (cursor !== undefined) {
        if (seen.has(cursor)) {
          return err(
            new StructuredError(
              "ONTO_REPLACEMENT_CYCLE",
              "Concept deprecation would introduce a replacement cycle.",
            ),
          );
        }
        seen.add(cursor);
        const definition = this.#concepts.get(cursor);
        cursor =
          definition?.status === "deprecated"
            ? definition.replacedBy
            : undefined;
      }
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

const coreConcept = (
  id: ConceptRef,
  label: string,
  input: {
    kind?: ConceptKind;
    parents?: ConceptRef[];
  } = {},
): ConceptDefinition => ({
  id,
  namespace: "core",
  labels: { en: label },
  parents: [...(input.parents ?? [])],
  status: "core",
  kind: input.kind ?? "abstract",
  constraints: [],
  provenance: [],
});

export const createCoreOntology = (): OntologyStore => {
  const store = new OntologyStore();
  const concepts: ConceptDefinition[] = [
    coreConcept("concept:core.entity", "entity", { kind: "entity" }),
    coreConcept("concept:core.physical-object", "physical object", {
      kind: "entity",
      parents: ["concept:core.entity"],
    }),
    coreConcept("concept:core.abstract-object", "abstract object", {
      parents: ["concept:core.entity"],
    }),
    coreConcept("concept:core.person", "person", {
      kind: "entity",
      parents: ["concept:core.entity"],
    }),
    coreConcept("concept:core.organization", "organization", {
      kind: "entity",
      parents: ["concept:core.entity"],
    }),
    coreConcept("concept:core.location", "location", {
      kind: "entity",
      parents: ["concept:core.entity"],
    }),
    coreConcept("concept:core.time", "time"),
    coreConcept("concept:core.quantity", "quantity"),
    coreConcept("concept:core.information", "information"),
    coreConcept("concept:core.artifact", "artifact", {
      kind: "entity",
      parents: ["concept:core.entity"],
    }),
    coreConcept("concept:core.software-artifact", "software artifact", {
      kind: "entity",
      parents: ["concept:core.artifact"],
    }),
    coreConcept("concept:core.state", "state", { kind: "property" }),
    coreConcept("concept:core.event", "event", { kind: "event" }),
    coreConcept("concept:core.action", "action", {
      kind: "action",
      parents: ["concept:core.event"],
    }),
    coreConcept("concept:core.change", "change", {
      kind: "event",
      parents: ["concept:core.event"],
    }),
    coreConcept("concept:core.creation", "creation", {
      kind: "action",
      parents: ["concept:core.change"],
    }),
    coreConcept("concept:core.destruction", "destruction", {
      kind: "action",
      parents: ["concept:core.change"],
    }),
    coreConcept("concept:core.transfer", "transfer", {
      kind: "action",
      parents: ["concept:core.action"],
    }),
    coreConcept("concept:core.communication", "communication", {
      kind: "action",
      parents: ["concept:core.action"],
    }),
    coreConcept("concept:core.perception", "perception", {
      kind: "event",
      parents: ["concept:core.event"],
    }),
    coreConcept("concept:core.cognition", "cognition", {
      kind: "event",
      parents: ["concept:core.event"],
    }),
    coreConcept("concept:core.possession", "possession", { kind: "relation" }),
    coreConcept("concept:core.comparison", "comparison", { kind: "relation" }),
    coreConcept("concept:core.membership", "membership", { kind: "relation" }),
    coreConcept("concept:core.part-whole", "part-whole", { kind: "relation" }),
    coreConcept("concept:core.cause", "cause", { kind: "relation" }),
    coreConcept("concept:core.condition", "condition", { kind: "relation" }),
    coreConcept("concept:core.purpose", "purpose", { kind: "relation" }),
    coreConcept("concept:core.permission", "permission"),
    coreConcept("concept:core.requirement", "requirement"),
    coreConcept("concept:core.prohibition", "prohibition"),
    coreConcept("concept:core.possibility", "possibility"),
    coreConcept("concept:core.certainty", "certainty"),
    coreConcept("concept:core.truth", "truth"),
    coreConcept("concept:core.falsehood", "falsehood"),
    coreConcept("concept:core.unknown", "unknown"),
    coreConcept("concept:core.software-service", "software service", {
      kind: "entity",
      parents: ["concept:core.software-artifact"],
    }),
    coreConcept("concept:core.file", "file", {
      kind: "entity",
      parents: ["concept:core.artifact"],
    }),
    coreConcept("concept:core.delete", "delete", {
      kind: "action",
      parents: ["concept:core.destruction"],
    }),
    coreConcept("concept:core.maximum-cardinality", "maximum cardinality", {
      kind: "property",
      parents: ["concept:core.quantity"],
    }),
  ];

  const merged = store.mergeConcepts(concepts);
  if (!merged.ok) throw merged.error;

  store.upsertRelation({
    id: "relation:core.function",
    namespace: "core",
    labels: { en: "function" },
    domain: ["concept:core.artifact"],
    range: ["concept:core.action"],
  });
  store.upsertRelation({
    id: "relation:core.object",
    namespace: "core",
    labels: { en: "object" },
    range: ["concept:core.entity"],
  });
  store.upsertRelation({
    id: "relation:core.context",
    namespace: "core",
    labels: { en: "context" },
    range: ["concept:core.entity"],
  });
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
  kind: "abstract",
  constraints: [],
  provenance,
});
