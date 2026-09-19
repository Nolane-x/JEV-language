import {
  canonicalJson,
  err,
  ok,
  StructuredError,
  type Digest,
  type JsonValue,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  EntityNode,
  EventNode,
  GraphSnapshot,
  QuantityNode,
  RoleBinding,
} from "../../semantic-graph/src/index.ts";

export interface ExpandedEventProjection {
  predicate: string;
  polarity: EventNode["polarity"];
  amount: number;
  unit?: string;
  comparator: QuantityNode["comparator"];
}

export interface ExpandedEnglishProjection {
  actorConcept: string;
  actorNameDigest?: Digest;
  events: ExpandedEventProjection[];
}

const refForRole = (
  roles: readonly RoleBinding[],
  role: string,
): SemanticId | undefined => {
  const binding = roles.find(
    (entry) => entry.role === role && entry.value.kind === "ref",
  );
  return binding?.value.kind === "ref" ? binding.value.ref : undefined;
};

const entityById = (
  snapshot: GraphSnapshot,
  id: SemanticId | undefined,
): EntityNode | undefined =>
  id === undefined
    ? undefined
    : snapshot.nodes.find(
        (node): node is EntityNode =>
          node.kind === "entity" && node.id === id,
      );

const quantityById = (
  snapshot: GraphSnapshot,
  id: SemanticId | undefined,
): QuantityNode | undefined =>
  id === undefined
    ? undefined
    : snapshot.nodes.find(
        (node): node is QuantityNode =>
          node.kind === "quantity" && node.id === id,
      );

const actorDigest = (actor: EntityNode): Digest | undefined => {
  const span = actor.names?.find((name) => name.kind === "span-ref");
  return span?.kind === "span-ref" ? span.span.digest : undefined;
};

export const projectExpandedEnglishSemantics = (
  snapshot: GraphSnapshot,
): Result<ExpandedEnglishProjection> => {
  const events = snapshot.nodes.filter(
    (node): node is EventNode => node.kind === "event",
  );
  if (events.length === 0) {
    return err(
      new StructuredError(
        "VERIFY_M6_EVENT_MISSING",
        "Expanded English semantic projection requires at least one event.",
      ),
    );
  }

  let actor: EntityNode | undefined;
  const projected: ExpandedEventProjection[] = [];
  for (const event of events) {
    const eventActor = entityById(
      snapshot,
      refForRole(event.roles, "role:core.agent"),
    );
    const quantity = quantityById(
      snapshot,
      refForRole(event.roles, "role:core.quantity-limit"),
    );
    if (eventActor === undefined || quantity === undefined) {
      return err(
        new StructuredError(
          "VERIFY_M6_EVENT_INCOMPLETE",
          "Expanded English event is missing its actor or quantity.",
        ),
      );
    }
    if (actor === undefined) actor = eventActor;
    if (actor.id !== eventActor.id) {
      return err(
        new StructuredError(
          "VERIFY_M6_MULTIPLE_ACTORS",
          "Expanded English projection currently requires one shared actor.",
        ),
      );
    }
    projected.push({
      predicate: event.predicate,
      polarity: event.polarity,
      amount: quantity.amount,
      ...(quantity.unit === undefined ? {} : { unit: quantity.unit }),
      comparator: quantity.comparator,
    });
  }

  if (actor === undefined) {
    return err(
      new StructuredError(
        "VERIFY_M6_ACTOR_MISSING",
        "Expanded English semantic projection lost its actor.",
      ),
    );
  }

  projected.sort((a, b) =>
    canonicalJson(a as unknown as JsonValue).localeCompare(
      canonicalJson(b as unknown as JsonValue),
    ),
  );

  const digest = actorDigest(actor);
  return ok({
    actorConcept: actor.concept,
    ...(digest === undefined ? {} : { actorNameDigest: digest }),
    events: projected,
  });
};

export interface ExpandedEnglishEquivalenceReport {
  equivalent: boolean;
  left?: ExpandedEnglishProjection;
  right?: ExpandedEnglishProjection;
}

export const verifyExpandedEnglishEquivalence = (
  left: GraphSnapshot,
  right: GraphSnapshot,
): ExpandedEnglishEquivalenceReport => {
  const a = projectExpandedEnglishSemantics(left);
  const b = projectExpandedEnglishSemantics(right);
  if (!a.ok || !b.ok) {
    return {
      equivalent: false,
      ...(a.ok ? { left: a.value } : {}),
      ...(b.ok ? { right: b.value } : {}),
    };
  }
  return {
    equivalent:
      canonicalJson(a.value as unknown as JsonValue) ===
      canonicalJson(b.value as unknown as JsonValue),
    left: a.value,
    right: b.value,
  };
};
