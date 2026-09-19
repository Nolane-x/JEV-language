import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  ContextNode,
  DeicticReferenceSpec,
  Diagnostic,
  EvidenceNode,
  GraphSnapshot,
  JsgNode,
  PropositionNode,
  ReferenceNode,
} from "./nodes.ts";

const contextMap = (
  snapshot: GraphSnapshot,
): Map<SemanticId, ContextNode> =>
  new Map(
    snapshot.nodes
      .filter((node): node is ContextNode => node.kind === "context")
      .map((node) => [node.id, node] as const),
  );

const nodeMap = (snapshot: GraphSnapshot): Map<SemanticId, JsgNode> =>
  new Map(snapshot.nodes.map((node) => [node.id, node] as const));

const contextRefs = (context: ContextNode): SemanticId[] => {
  const refs: Array<SemanticId | undefined> = [
    context.parentContext,
    context.deictic?.speaker,
    context.deictic?.addressee,
    context.deictic?.speakerTime,
    context.deictic?.speakerLocation,
    context.deictic?.discourseTime,
    context.deictic?.discourseFocus,
    context.deictic?.participantPerspective,
    context.quotation?.quotedSpeaker,
    context.quotation?.quotedAddressee,
    context.quotation?.quotedTimeAnchor,
    context.quotation?.quotedLocationAnchor,
    context.quotation?.reporter,
    context.attitude?.holder,
  ];
  refs.push(
    ...(context.deictic?.socialAnchors ?? []).map((anchor) => anchor.participant),
    ...(context.attitude?.contentRefs ?? []),
  );
  return refs.filter((ref): ref is SemanticId => ref !== undefined);
};

const validateContextPayload = (
  context: ContextNode,
  nodes: ReadonlyMap<SemanticId, JsgNode>,
  contexts: ReadonlyMap<SemanticId, ContextNode>,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const add = (code: string, message: string, refs: SemanticId[] = []): void => {
    diagnostics.push({
      code,
      severity: "error",
      message,
      nodeRefs: [context.id, ...refs],
    });
  };

  if (
    context.parentContext !== undefined &&
    !contexts.has(context.parentContext)
  ) {
    add(
      "JSG090_CONTEXT_PARENT_INVALID",
      `Context ${context.id} parent must reference another ContextNode.`,
      [context.parentContext],
    );
  }

  const expectedPayload =
    context.contextKind === "deictic"
      ? context.deictic !== undefined &&
        context.quotation === undefined &&
        context.attitude === undefined
      : context.contextKind === "quotation"
        ? context.quotation !== undefined &&
          context.attitude === undefined
        : context.attitude !== undefined &&
          context.quotation === undefined;

  if (!expectedPayload) {
    add(
      "JSG091_CONTEXT_PAYLOAD_MISMATCH",
      `Context ${context.id} payload does not match contextKind ${context.contextKind}.`,
    );
  }

  for (const ref of contextRefs(context)) {
    if (context.parentContext === ref) continue;
    if (!nodes.has(ref)) {
      add(
        "JSG092_CONTEXT_REFERENCE_INVALID",
        `Context ${context.id} references missing semantic object ${ref}.`,
        [ref],
      );
    }
  }

  const quote = context.quotation;
  if (quote !== undefined) {
    if (
      quote.attributionConfidence !== undefined &&
      (!Number.isFinite(quote.attributionConfidence) ||
        quote.attributionConfidence < 0 ||
        quote.attributionConfidence > 1)
    ) {
      add(
        "JSG093_ATTRIBUTION_CONFIDENCE_INVALID",
        `Quotation context ${context.id} attribution confidence must be in [0, 1].`,
      );
    }
    if (quote.mode === "direct") {
      if (quote.exactWording !== true) {
        add(
          "JSG094_DIRECT_QUOTE_EXACTNESS_REQUIRED",
          `Direct quotation context ${context.id} must preserve exact wording.`,
        );
      }
      if (quote.sourceSpan === undefined) {
        add(
          "JSG095_DIRECT_QUOTE_SOURCE_SPAN_REQUIRED",
          `Direct quotation context ${context.id} must retain its source span.`,
        );
      }
    }
    if (quote.mode === "indirect" && quote.exactWording) {
      add(
        "JSG096_INDIRECT_SPEECH_EXACTNESS_FORBIDDEN",
        `Indirect speech context ${context.id} cannot claim exact quoted wording.`,
      );
    }
  }

  const attitude = context.attitude;
  if (attitude !== undefined) {
    if (attitude.contentRefs.length === 0) {
      add(
        "JSG097_ATTITUDE_CONTENT_REQUIRED",
        `Attitude context ${context.id} requires embedded content.`,
      );
    }
    for (const ref of attitude.contentRefs) {
      const content = nodes.get(ref);
      if (content?.kind !== "proposition") {
        add(
          "JSG098_ATTITUDE_CONTENT_INVALID",
          `Attitude context ${context.id} content must reference PropositionNode values.`,
          [ref],
        );
        continue;
      }
      if (content.context !== context.id) {
        add(
          "JSG099_ATTITUDE_CONTEXT_ISOLATION_INVALID",
          `Embedded proposition ${ref} must explicitly belong to attitude context ${context.id}.`,
          [ref],
        );
      }
    }
  }

  return diagnostics;
};

const contextCycleDiagnostics = (
  contexts: ReadonlyMap<SemanticId, ContextNode>,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const visiting = new Set<SemanticId>();
  const visited = new Set<SemanticId>();

  const visit = (id: SemanticId, path: SemanticId[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const at = path.indexOf(id);
      const cycle = [...path.slice(Math.max(0, at)), id];
      diagnostics.push({
        code: "JSG100_CONTEXT_PARENT_CYCLE",
        severity: "error",
        message: `Context parent chain contains a cycle: ${cycle.join(" -> ")}.`,
        nodeRefs: [...new Set(cycle)],
      });
      return;
    }

    visiting.add(id);
    const parent = contexts.get(id)?.parentContext;
    if (parent !== undefined && contexts.has(parent)) {
      visit(parent, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of [...contexts.keys()].sort()) visit(id, []);
  return diagnostics;
};

const validatePropositionContexts = (
  snapshot: GraphSnapshot,
  contexts: ReadonlyMap<SemanticId, ContextNode>,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  for (const proposition of snapshot.nodes.filter(
    (node): node is PropositionNode => node.kind === "proposition",
  )) {
    if (
      proposition.context !== undefined &&
      !contexts.has(proposition.context)
    ) {
      diagnostics.push({
        code: "JSG101_PROPOSITION_CONTEXT_INVALID",
        severity: "error",
        message: `Proposition ${proposition.id} references missing/non-context ${proposition.context}.`,
        nodeRefs: [proposition.id, proposition.context],
      });
    }
  }

  return diagnostics;
};

const validateDeicticReferences = (
  snapshot: GraphSnapshot,
  contexts: ReadonlyMap<SemanticId, ContextNode>,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  for (const reference of snapshot.nodes.filter(
    (node): node is ReferenceNode => node.kind === "reference",
  )) {
    if (reference.deictic === undefined) continue;
    const context = contexts.get(reference.deictic.context);
    if (context === undefined) {
      diagnostics.push({
        code: "JSG102_DEICTIC_CONTEXT_INVALID",
        severity: "error",
        message: `Deictic reference ${reference.id} requires a valid context.`,
        nodeRefs: [reference.id, reference.deictic.context],
      });
      continue;
    }
    if (context.deictic === undefined) {
      diagnostics.push({
        code: "JSG103_DEICTIC_FRAME_MISSING",
        severity: "error",
        message: `Context ${context.id} has no deictic frame for reference ${reference.id}.`,
        nodeRefs: [reference.id, context.id],
      });
    }
  }

  return diagnostics;
};

const validateEvidentiality = (snapshot: GraphSnapshot): Diagnostic[] => {
  const nodes = nodeMap(snapshot);
  const diagnostics: Diagnostic[] = [];

  for (const evidence of snapshot.nodes.filter(
    (node): node is EvidenceNode => node.kind === "evidence",
  )) {
    const source = evidence.evidentiality?.source;
    if (source !== undefined && !nodes.has(source)) {
      diagnostics.push({
        code: "JSG104_EVIDENTIAL_SOURCE_INVALID",
        severity: "error",
        message: `Evidence ${evidence.id} references missing evidential source ${source}.`,
        nodeRefs: [evidence.id, source],
      });
    }
  }

  return diagnostics;
};

export const validateContextSemantics = (
  snapshot: GraphSnapshot,
): Diagnostic[] => {
  const nodes = nodeMap(snapshot);
  const contexts = contextMap(snapshot);
  const diagnostics: Diagnostic[] = [];

  for (const context of contexts.values()) {
    diagnostics.push(...validateContextPayload(context, nodes, contexts));
  }
  diagnostics.push(...contextCycleDiagnostics(contexts));
  diagnostics.push(...validatePropositionContexts(snapshot, contexts));
  diagnostics.push(...validateDeicticReferences(snapshot, contexts));
  diagnostics.push(...validateEvidentiality(snapshot));
  return diagnostics;
};

const anchorForReference = (
  context: ContextNode,
  deictic: DeicticReferenceSpec,
): SemanticId | undefined => {
  const frame = context.deictic;
  if (frame === undefined) return undefined;

  switch (deictic.anchorRole) {
    case "speaker":
      return frame.speaker;
    case "addressee":
      return frame.addressee;
    case "speaker-location":
      return frame.speakerLocation;
    case "speaker-time":
      return frame.speakerTime;
    case "discourse-time":
      return frame.discourseTime;
    case "discourse-focus":
      return frame.discourseFocus;
    case "participant-perspective":
      return frame.participantPerspective;
    case "social-anchor":
      return frame.socialAnchors?.find(
        (anchor) =>
          deictic.socialRelation === undefined ||
          anchor.relation === deictic.socialRelation,
      )?.participant;
  }
};

export interface DeicticResolution {
  referenceId: SemanticId;
  contextId: SemanticId;
  resolved?: SemanticId;
  status: "resolved" | "unresolved";
}

export const resolveDeicticReference = (
  snapshot: GraphSnapshot,
  referenceId: SemanticId,
): Result<DeicticResolution> => {
  const nodes = nodeMap(snapshot);
  const reference = nodes.get(referenceId);
  if (reference?.kind !== "reference" || reference.deictic === undefined) {
    return err(
      new StructuredError(
        "DEIXIS_REFERENCE_INVALID",
        "Deictic resolution requires a ReferenceNode with deictic metadata.",
      ),
    );
  }

  const context = nodes.get(reference.deictic.context);
  if (context?.kind !== "context") {
    return err(
      new StructuredError(
        "DEIXIS_CONTEXT_INVALID",
        "Deictic reference context does not resolve to ContextNode.",
      ),
    );
  }

  const resolved = anchorForReference(context, reference.deictic);
  return ok({
    referenceId,
    contextId: context.id,
    ...(resolved === undefined ? {} : { resolved }),
    status: resolved === undefined ? "unresolved" : "resolved",
  });
};

export class QuotationContextStack {
  readonly #frames: ContextNode[] = [];

  push(frame: ContextNode): Result<void> {
    if (frame.contextKind !== "quotation" || frame.quotation === undefined) {
      return err(
        new StructuredError(
          "QUOTE_STACK_FRAME_INVALID",
          "Quotation stack accepts quotation ContextNode values only.",
        ),
      );
    }
    const parent = this.current();
    if (
      parent !== undefined &&
      frame.parentContext !== parent.id
    ) {
      return err(
        new StructuredError(
          "QUOTE_STACK_PARENT_MISMATCH",
          "Nested quotation frame must point to the active quotation context.",
        ),
      );
    }
    this.#frames.push(structuredClone(frame));
    return ok(undefined);
  }

  pop(): ContextNode | undefined {
    const value = this.#frames.pop();
    return value === undefined ? undefined : structuredClone(value);
  }

  current(): ContextNode | undefined {
    const value = this.#frames.at(-1);
    return value === undefined ? undefined : structuredClone(value);
  }

  snapshot(): ContextNode[] {
    return this.#frames.map((frame) => structuredClone(frame));
  }
}

const embeddedByContext = (
  proposition: PropositionNode,
  contexts: ReadonlyMap<SemanticId, ContextNode>,
): boolean => {
  let current = proposition.context;
  const seen = new Set<SemanticId>();

  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const context = contexts.get(current);
    if (context === undefined) break;
    if (
      context.contextKind === "quotation" ||
      context.contextKind === "attitude"
    ) {
      return true;
    }
    current = context.parentContext;
  }
  return false;
};

export const globalAssertionPropositions = (
  snapshot: GraphSnapshot,
): PropositionNode[] => {
  const contexts = contextMap(snapshot);
  return snapshot.nodes
    .filter((node): node is PropositionNode => node.kind === "proposition")
    .filter((node) => !embeddedByContext(node, contexts))
    .filter(
      (node) =>
        node.presupposition === undefined &&
        node.pragmaticInference === undefined,
    )
    .filter((node) => {
      const commitment = node.epistemic?.commitment;
      return (
        commitment === undefined ||
        commitment === "asserted-by-speaker" ||
        commitment === "verified"
      );
    })
    .map((node) => structuredClone(node))
    .sort((a, b) => a.id.localeCompare(b.id));
};
