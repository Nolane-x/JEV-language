import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  Diagnostic,
  GraphSnapshot,
  PresuppositionSpec,
  PropositionNode,
} from "./nodes.ts";

export type AccommodationKind =
  | "global"
  | "local"
  | "link-existing"
  | "unresolved"
  | "clarify";

export interface AccommodationCandidate {
  id: string;
  kind: AccommodationKind;
  presuppositionRef: SemanticId;
  contextRef?: SemanticId;
  linkedRef?: SemanticId;
  deterministicRank: number;
}

export const generateAccommodationCandidates = (input: {
  presupposition: PropositionNode;
  localContextRef?: SemanticId;
  compatibleRefs?: readonly SemanticId[];
  allowGlobal?: boolean;
  allowClarification?: boolean;
}): Result<AccommodationCandidate[]> => {
  const spec = input.presupposition.presupposition;
  if (spec === undefined) {
    return err(
      new StructuredError(
        "PRAG_PRESUPPOSITION_REQUIRED",
        "Accommodation requires a proposition marked with presupposition metadata.",
      ),
    );
  }

  const candidates: AccommodationCandidate[] = [];
  let rank = 0;

  for (const ref of [...new Set(input.compatibleRefs ?? [])].sort()) {
    candidates.push({
      id: `accommodation:link:${input.presupposition.id}:${ref}`,
      kind: "link-existing",
      presuppositionRef: input.presupposition.id,
      linkedRef: ref,
      deterministicRank: rank++,
    });
  }

  if (input.localContextRef !== undefined) {
    candidates.push({
      id: `accommodation:local:${input.presupposition.id}`,
      kind: "local",
      presuppositionRef: input.presupposition.id,
      contextRef: input.localContextRef,
      deterministicRank: rank++,
    });
  }

  if (input.allowGlobal !== false) {
    candidates.push({
      id: `accommodation:global:${input.presupposition.id}`,
      kind: "global",
      presuppositionRef: input.presupposition.id,
      deterministicRank: rank++,
    });
  }

  candidates.push({
    id: `accommodation:unresolved:${input.presupposition.id}`,
    kind: "unresolved",
    presuppositionRef: input.presupposition.id,
    deterministicRank: rank++,
  });

  if (input.allowClarification !== false) {
    candidates.push({
      id: `accommodation:clarify:${input.presupposition.id}`,
      kind: "clarify",
      presuppositionRef: input.presupposition.id,
      deterministicRank: rank++,
    });
  }

  return ok(candidates);
};

export interface ScalarScale {
  id: string;
  version: string;
  terms: string[];
}

export interface ScalarInferenceRecord {
  id: string;
  scaleId: string;
  premiseRef: SemanticId;
  inferredRef: SemanticId;
  observedTerm: string;
  strongerTerm: string;
  strength: "defeasible";
  status: "active" | "cancelled";
  sourceRule: string;
  cancellationReason?: string;
}

export class ScalarInferenceRegistry {
  readonly #scales = new Map<string, ScalarScale>();

  register(scale: ScalarScale): Result<void> {
    if (
      scale.id.trim() === "" ||
      scale.version.trim() === "" ||
      scale.terms.length < 2 ||
      new Set(scale.terms).size !== scale.terms.length ||
      scale.terms.some((term) => term.trim() === "")
    ) {
      return err(
        new StructuredError(
          "PRAG_SCALE_INVALID",
          "Scalar scale requires id/version and at least two unique ordered terms.",
        ),
      );
    }
    if (this.#scales.has(scale.id)) {
      return err(
        new StructuredError(
          "PRAG_SCALE_DUPLICATE",
          `Scalar scale already exists: ${scale.id}`,
        ),
      );
    }
    this.#scales.set(scale.id, structuredClone(scale));
    return ok(undefined);
  }

  generate(input: {
    scaleId: string;
    premiseRef: SemanticId;
    inferredRef: SemanticId;
    observedTerm: string;
    strongerTerm: string;
    contextAllowsInference: boolean;
  }): Result<ScalarInferenceRecord | undefined> {
    const scale = this.#scales.get(input.scaleId);
    if (scale === undefined) {
      return err(
        new StructuredError(
          "PRAG_SCALE_NOT_FOUND",
          `Scalar scale not found: ${input.scaleId}`,
        ),
      );
    }
    if (!input.contextAllowsInference) return ok(undefined);

    const observedIndex = scale.terms.indexOf(input.observedTerm);
    const strongerIndex = scale.terms.indexOf(input.strongerTerm);
    if (
      observedIndex < 0 ||
      strongerIndex < 0 ||
      strongerIndex <= observedIndex
    ) {
      return err(
        new StructuredError(
          "PRAG_SCALE_ORDER_INVALID",
          "Scalar inference requires a stronger term later in the registered scale.",
        ),
      );
    }

    return ok({
      id: `scalar:${scale.id}:${input.premiseRef}:${input.inferredRef}`,
      scaleId: scale.id,
      premiseRef: input.premiseRef,
      inferredRef: input.inferredRef,
      observedTerm: input.observedTerm,
      strongerTerm: input.strongerTerm,
      strength: "defeasible",
      status: "active",
      sourceRule: `scalar-not-${input.strongerTerm}`,
    });
  }
}

export const cancelScalarInference = (
  inference: ScalarInferenceRecord,
  reason: string,
): Result<ScalarInferenceRecord> => {
  if (reason.trim() === "") {
    return err(
      new StructuredError(
        "PRAG_CANCELLATION_REASON_REQUIRED",
        "Cancelling a pragmatic inference requires an explicit reason.",
      ),
    );
  }
  return ok({
    ...structuredClone(inference),
    status: "cancelled",
    cancellationReason: reason,
  });
};

export interface SemanticCoercionRule {
  id: string;
  version: string;
  sourcePredicate: SemanticId;
  argumentConcept: SemanticId;
  coercedPredicate: SemanticId;
  mappingKind: "metaphor" | "metonymy" | "type-coercion";
}

export interface SemanticCoercionCandidate {
  ruleId: string;
  reading: "nonliteral";
  predicate: SemanticId;
  requiresDisambiguation: true;
}

export class SemanticCoercionRegistry {
  readonly #rules = new Map<string, SemanticCoercionRule>();

  register(rule: SemanticCoercionRule): Result<void> {
    if (rule.id.trim() === "" || rule.version.trim() === "") {
      return err(
        new StructuredError(
          "PRAG_COERCION_RULE_INVALID",
          "Semantic coercion rule requires non-empty id and version.",
        ),
      );
    }
    if (this.#rules.has(rule.id)) {
      return err(
        new StructuredError(
          "PRAG_COERCION_RULE_DUPLICATE",
          `Semantic coercion rule already exists: ${rule.id}`,
        ),
      );
    }
    this.#rules.set(rule.id, structuredClone(rule));
    return ok(undefined);
  }

  candidates(input: {
    predicate: SemanticId;
    argumentConcept: SemanticId;
  }): SemanticCoercionCandidate[] {
    return [...this.#rules.values()]
      .filter(
        (rule) =>
          rule.sourcePredicate === input.predicate &&
          rule.argumentConcept === input.argumentConcept,
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((rule) => ({
        ruleId: rule.id,
        reading: "nonliteral" as const,
        predicate: rule.coercedPredicate,
        requiresDisambiguation: true as const,
      }));
  }
}

const validatePresupposition = (
  node: PropositionNode,
  spec: PresuppositionSpec,
  ids: ReadonlySet<SemanticId>,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const add = (code: string, message: string, refs: SemanticId[] = []): void => {
    diagnostics.push({
      code,
      severity: "error",
      message,
      nodeRefs: [node.id, ...refs],
    });
  };

  if (spec.triggerId.trim() === "") {
    add(
      "JSG110_PRESUPPOSITION_TRIGGER_REQUIRED",
      `Presupposition ${node.id} requires a trigger identifier.`,
    );
  }
  for (const ref of [spec.host, spec.context, spec.linkedRef]) {
    if (ref !== undefined && !ids.has(ref)) {
      add(
        "JSG111_PRESUPPOSITION_REFERENCE_INVALID",
        `Presupposition ${node.id} references missing semantic object ${ref}.`,
        [ref],
      );
    }
  }
  if (spec.status === "linked" && spec.linkedRef === undefined) {
    add(
      "JSG112_PRESUPPOSITION_LINK_REQUIRED",
      `Linked presupposition ${node.id} must identify the compatible semantic referent.`,
    );
  }
  if (spec.status === "accommodated-local" && spec.context === undefined) {
    add(
      "JSG113_LOCAL_ACCOMMODATION_CONTEXT_REQUIRED",
      `Locally accommodated presupposition ${node.id} requires a context.`,
    );
  }
  if (node.epistemic?.commitment !== "presupposed") {
    add(
      "JSG114_PRESUPPOSITION_COMMITMENT_MISMATCH",
      `Presupposition ${node.id} must use presupposed commitment rather than asserted truth.`,
    );
  }
  return diagnostics;
};

export const validatePragmaticSemantics = (
  snapshot: GraphSnapshot,
): Diagnostic[] => {
  const ids = new Set(snapshot.nodes.map((node) => node.id));
  const diagnostics: Diagnostic[] = [];

  for (const node of snapshot.nodes) {
    if (node.kind !== "proposition") continue;

    if (node.presupposition !== undefined) {
      diagnostics.push(
        ...validatePresupposition(node, node.presupposition, ids),
      );
    }

    const inference = node.pragmaticInference;
    if (inference !== undefined) {
      if (inference.sourceId.trim() === "" || inference.premiseRefs.length === 0) {
        diagnostics.push({
          code: "JSG115_PRAGMATIC_INFERENCE_SOURCE_INVALID",
          severity: "error",
          message: `Pragmatic inference ${node.id} requires source identity and premises.`,
          nodeRefs: [node.id],
        });
      }
      for (const ref of inference.premiseRefs) {
        if (!ids.has(ref)) {
          diagnostics.push({
            code: "JSG116_PRAGMATIC_PREMISE_INVALID",
            severity: "error",
            message: `Pragmatic inference ${node.id} references missing premise ${ref}.`,
            nodeRefs: [node.id, ref],
          });
        }
      }
      if (
        inference.status === "cancelled" &&
        (inference.cancellationReason === undefined ||
          inference.cancellationReason.trim() === "")
      ) {
        diagnostics.push({
          code: "JSG117_PRAGMATIC_CANCELLATION_REASON_REQUIRED",
          severity: "error",
          message: `Cancelled pragmatic inference ${node.id} requires a cancellation reason.`,
          nodeRefs: [node.id],
        });
      }
      if (
        node.epistemic?.commitment === "asserted-by-speaker" ||
        node.epistemic?.commitment === "verified"
      ) {
        diagnostics.push({
          code: "JSG118_PRAGMATIC_INFERENCE_ASSERTION_COLLAPSE",
          severity: "error",
          message: `Pragmatic inference ${node.id} cannot simultaneously be asserted/verified truth.`,
          nodeRefs: [node.id],
        });
      }
    }
  }

  return diagnostics;
};
