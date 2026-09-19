import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import {
  resolveUtf16Span,
  type GroundingSource,
} from "../../open-world-values/src/index.ts";
import type {
  EntityNode,
  EventNode,
  GraphSnapshot,
  QuantityNode,
  RoleBinding,
} from "../../semantic-graph/src/index.ts";

export type ExpandedDocumentSurfaceKind =
  | "relative-clause"
  | "multi-sentence"
  | "unknown-name-exact"
  | "unknown-name-synonym";

export interface ExpandedDocumentAlternative {
  id: string;
  kind: ExpandedDocumentSurfaceKind;
  text: string;
  semanticJustificationRuleIds: string[];
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

const eventSemantics = (
  snapshot: GraphSnapshot,
  event: EventNode,
):
  | {
      actor: EntityNode;
      quantity: QuantityNode;
    }
  | undefined => {
  if (
    event.predicate !== "concept:core.delete" ||
    event.polarity !== "positive"
  ) {
    return undefined;
  }
  const actor = entityById(
    snapshot,
    refForRole(event.roles, "role:core.agent"),
  );
  const quantity = quantityById(
    snapshot,
    refForRole(event.roles, "role:core.quantity-limit"),
  );
  if (
    actor === undefined ||
    quantity === undefined ||
    quantity.unit !== "concept:core.file" ||
    quantity.comparator !== "exact"
  ) {
    return undefined;
  }
  return { actor, quantity };
};

const noun = (amount: number): string =>
  amount === 1 ? "file" : "files";

const resolveActorName = (
  actor: EntityNode,
  sources: readonly GroundingSource[],
): Result<string> => {
  const spanValue = actor.names?.find(
    (value) => value.kind === "span-ref",
  );
  if (spanValue === undefined || spanValue.kind !== "span-ref") {
    return err(
      new StructuredError(
        "REALIZE_M6_NAME_MISSING",
        "Expanded unknown-name realization requires an exact source span.",
      ),
    );
  }
  const source = sources.find(
    (entry) =>
      entry.id === spanValue.span.sourceId &&
      entry.version === spanValue.span.sourceVersion,
  );
  if (source === undefined) {
    return err(
      new StructuredError(
        "REALIZE_M6_SOURCE_MISSING",
        "Grounding source required by the unknown-name span is unavailable.",
      ),
    );
  }
  const resolved = resolveUtf16Span(source, spanValue.span);
  return resolved.ok ? ok(resolved.value) : err(resolved.error);
};

export const realizeExpandedEnglishDocument = (
  snapshot: GraphSnapshot,
  sources: readonly GroundingSource[] = [],
): Result<ExpandedDocumentAlternative[]> => {
  const events = snapshot.nodes.filter(
    (node): node is EventNode => node.kind === "event",
  );
  const semantics = events
    .map((event) => ({ event, semantics: eventSemantics(snapshot, event) }))
    .filter(
      (
        entry,
      ): entry is {
        event: EventNode;
        semantics: { actor: EntityNode; quantity: QuantityNode };
      } => entry.semantics !== undefined,
    );

  if (semantics.length === 2) {
    const [first, second] = semantics;
    if (
      first === undefined ||
      second === undefined ||
      first.semantics.actor.id !== second.semantics.actor.id ||
      first.semantics.actor.concept !== "concept:core.software-service"
    ) {
      return err(
        new StructuredError(
          "REALIZE_M6_DUAL_EVENT",
          "Dual-event realization requires one shared software-service actor.",
        ),
      );
    }
    const a = first.semantics.quantity.amount;
    const b = second.semantics.quantity.amount;
    return ok([
      {
        id: "expanded:relative-clause",
        kind: "relative-clause",
        text: `The service, which deletes exactly ${a} ${noun(a)}, deletes exactly ${b} ${noun(b)}.`,
        semanticJustificationRuleIds: [
          "sem:relative-clause-shared-actor-preservation",
          "sem:event-quantity-preservation",
        ],
      },
      {
        id: "expanded:multi-sentence",
        kind: "multi-sentence",
        text: `The service deletes exactly ${a} ${noun(a)}. It deletes exactly ${b} ${noun(b)}.`,
        semanticJustificationRuleIds: [
          "sem:pronoun-shared-actor-recoverability",
          "sem:multi-sentence-event-preservation",
        ],
      },
    ]);
  }

  if (semantics.length === 1) {
    const entry = semantics[0];
    if (entry === undefined) {
      return err(
        new StructuredError(
          "REALIZE_M6_EVENT_MISSING",
          "Expanded English realization did not find its event.",
        ),
      );
    }
    const actor = entry.semantics.actor;
    if (actor.concept !== "concept:core.software-service") {
      return err(
        new StructuredError(
          "REALIZE_M6_ACTOR_UNSUPPORTED",
          "Expanded named-event realization supports software-service actors only.",
        ),
      );
    }
    const resolvedName = resolveActorName(actor, sources);
    if (!resolvedName.ok) return resolvedName;
    if (resolvedName.value.toLocaleLowerCase() === "service") {
      return err(
        new StructuredError(
          "REALIZE_M6_CANONICAL_SERVICE",
          "Canonical service events belong to the controlled realizer, not the expanded unknown-name path.",
        ),
      );
    }
    const amount = entry.semantics.quantity.amount;
    const unit = noun(amount);
    return ok([
      {
        id: "expanded:unknown-name-delete",
        kind: "unknown-name-exact",
        text: `${resolvedName.value} deletes exactly ${amount} ${unit}.`,
        semanticJustificationRuleIds: [
          "sem:opaque-name-exact-preservation",
          "sem:event-quantity-preservation",
        ],
      },
      {
        id: "expanded:unknown-name-remove",
        kind: "unknown-name-synonym",
        text: `${resolvedName.value} removes exactly ${amount} ${unit}.`,
        semanticJustificationRuleIds: [
          "sem:opaque-name-exact-preservation",
          "sem:lexeme-core-delete-equivalence",
        ],
      },
    ]);
  }

  return err(
    new StructuredError(
      "REALIZE_M6_EXPANDED_UNSUPPORTED",
      "Snapshot is outside the expanded relative/multi-sentence/unknown-name subset.",
    ),
  );
};
