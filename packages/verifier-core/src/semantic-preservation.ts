import {
  canonicalJson,
  type JsonValue,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  GraphSnapshot,
  JsgNode,
  SemanticValue,
} from "../../semantic-graph/src/index.ts";
import type {
  VerificationObligation,
  VerificationResult,
  Verifier,
  VerifierManifest,
  VerifyContext,
} from "./framework.ts";

export type PreservationInvariant =
  | "semantic-presence"
  | "negation"
  | "quantity-unit"
  | "identity-reference"
  | "scope"
  | "condition"
  | "modality"
  | "attribution"
  | "source-provenance"
  | "unknown-preservation"
  | "causal-direction"
  | "temporal-order"
  | "opaque-exactness";

export interface PreservationProfile {
  id: string;
  version: string;
  preserveNegation: boolean;
  preserveQuantities: "exact" | "meaning" | "relaxed";
  preserveModality: boolean;
  preserveAttribution: boolean;
  preserveTemporalRelations: boolean;
  preserveConditions: boolean;
  preserveIdentityReference: boolean;
  preserveScope: boolean;
  preserveSourceProvenance: boolean;
  preserveUnknowns: boolean;
  preserveCausalRelations: boolean;
  preserveOpaqueExactness: boolean;
  allowCompression: boolean;
  allowElaboration: boolean;
}

export const criticalSemanticPreservationProfile: PreservationProfile = {
  id: "semantic-preservation.critical-v1",
  version: "1.0.0",
  preserveNegation: true,
  preserveQuantities: "exact",
  preserveModality: true,
  preserveAttribution: true,
  preserveTemporalRelations: true,
  preserveConditions: true,
  preserveIdentityReference: true,
  preserveScope: true,
  preserveSourceProvenance: true,
  preserveUnknowns: true,
  preserveCausalRelations: true,
  preserveOpaqueExactness: true,
  allowCompression: false,
  allowElaboration: true,
};

export interface InvariantViolation {
  invariant: PreservationInvariant;
  code: string;
  message: string;
  sourceNodeId?: string;
  candidateNodeId?: string;
}

export interface PreservationReport {
  ok: boolean;
  profile: {
    id: string;
    version: string;
  };
  checked: PreservationInvariant[];
  violations: InvariantViolation[];
}

const asJson = (value: unknown): JsonValue => value as JsonValue;

const semanticEqual = (left: unknown, right: unknown): boolean =>
  canonicalJson(asJson(left)) === canonicalJson(asJson(right));

const semanticValueEqual = (
  left: SemanticValue,
  right: SemanticValue,
): boolean => semanticEqual(left, right);

const nodeMap = (snapshot: GraphSnapshot): Map<string, JsgNode> =>
  new Map(snapshot.nodes.map((node) => [node.id, node]));

const sorted = (values: readonly string[]): string[] => [...values].sort();

const hasPolarity = (
  node: JsgNode,
): node is Extract<JsgNode, { kind: "event" | "state" | "relation" | "proposition" }> =>
  node.kind === "event" ||
  node.kind === "state" ||
  node.kind === "relation" ||
  node.kind === "proposition";

const hasModality = (
  node: JsgNode,
): node is Extract<JsgNode, { kind: "event" | "proposition" }> =>
  node.kind === "event" || node.kind === "proposition";

const causalRelation = (relation: string): boolean =>
  /(?:^|[.:_-])(cause|enable|prevent|motivate|reason|evidence)(?:$|[.:_-])/i.test(
    relation,
  );

const temporalRelation = (relation: string): boolean =>
  /(?:^|[.:_-])(before|after|during|preced|follow)(?:$|[.:_-])/i.test(
    relation,
  );

const requestedInvariants = (
  profile: PreservationProfile,
): PreservationInvariant[] => {
  const invariants: PreservationInvariant[] = [];
  if (!profile.allowCompression) invariants.push("semantic-presence");
  if (profile.preserveNegation) invariants.push("negation");
  if (profile.preserveQuantities !== "relaxed") invariants.push("quantity-unit");
  if (profile.preserveIdentityReference) invariants.push("identity-reference");
  if (profile.preserveScope) invariants.push("scope");
  if (profile.preserveConditions) invariants.push("condition");
  if (profile.preserveModality) invariants.push("modality");
  if (profile.preserveAttribution) invariants.push("attribution");
  if (profile.preserveSourceProvenance) invariants.push("source-provenance");
  if (profile.preserveUnknowns) invariants.push("unknown-preservation");
  if (profile.preserveCausalRelations) invariants.push("causal-direction");
  if (profile.preserveTemporalRelations) invariants.push("temporal-order");
  if (profile.preserveOpaqueExactness) invariants.push("opaque-exactness");
  return invariants;
};

const missingNodeSpecificViolations = (
  node: JsgNode,
  enabled: ReadonlySet<PreservationInvariant>,
): InvariantViolation[] => {
  const violations: InvariantViolation[] = [];
  const add = (
    invariant: PreservationInvariant,
    code: string,
    message: string,
  ): void => {
    if (!enabled.has(invariant)) return;
    violations.push({
      invariant,
      code,
      message,
      sourceNodeId: node.id,
    });
  };

  if (enabled.has("semantic-presence")) {
    add(
      "semantic-presence",
      "SEM_SOURCE_NODE_DROPPED",
      "A source semantic node disappeared from a strict-preservation candidate.",
    );
  }
  if (node.kind === "quantity") {
    add(
      "quantity-unit",
      "SEM_QUANTITY_DROPPED",
      "A source quantity/unit semantic node was dropped.",
    );
  }
  if (node.kind === "reference" || node.kind === "entity") {
    add(
      "identity-reference",
      "SEM_REFERENCE_DROPPED",
      "A source identity/reference node was dropped.",
    );
  }
  if (node.kind === "unknown-concept") {
    add(
      "unknown-preservation",
      "SEM_UNKNOWN_DROPPED",
      "An unresolved source concept was dropped instead of preserved.",
    );
  }
  if (node.kind === "constraint" && node.constraintKind === "condition") {
    add(
      "condition",
      "SEM_CONDITION_DROPPED",
      "A source condition was dropped.",
    );
  }
  if (node.kind === "proposition") {
    if (node.scope !== undefined) {
      add("scope", "SEM_SCOPE_DROPPED", "A source scope constraint was dropped.");
    }
    if (node.attribution !== undefined) {
      add(
        "attribution",
        "SEM_ATTRIBUTION_DROPPED",
        "A source attribution was dropped.",
      );
    }
    if (node.modality !== undefined) {
      add(
        "modality",
        "SEM_MODALITY_DROPPED",
        "A source modality was dropped.",
      );
    }
  }
  return violations;
};

const compareMatchedNodes = (
  left: JsgNode,
  right: JsgNode,
  profile: PreservationProfile,
  enabled: ReadonlySet<PreservationInvariant>,
): InvariantViolation[] => {
  const violations: InvariantViolation[] = [];
  const add = (
    invariant: PreservationInvariant,
    code: string,
    message: string,
  ): void => {
    if (!enabled.has(invariant)) return;
    violations.push({
      invariant,
      code,
      message,
      sourceNodeId: left.id,
      candidateNodeId: right.id,
    });
  };

  if (left.kind !== right.kind) {
    add(
      "semantic-presence",
      "SEM_NODE_KIND_CHANGED",
      "A semantic node changed kind across a strict-preservation transformation.",
    );
    return violations;
  }

  if (
    enabled.has("negation") &&
    hasPolarity(left) &&
    hasPolarity(right) &&
    left.polarity !== right.polarity
  ) {
    add(
      "negation",
      "SEM_NEGATION_CHANGED",
      "Semantic polarity changed across the transformation.",
    );
  }

  if (left.kind === "quantity" && right.kind === "quantity") {
    const amountChanged = left.amount !== right.amount;
    const comparatorChanged = left.comparator !== right.comparator;
    const unitChanged = left.unit !== right.unit;
    const approximationChanged = left.approximate !== right.approximate;
    const changed =
      profile.preserveQuantities === "exact"
        ? amountChanged ||
          comparatorChanged ||
          unitChanged ||
          approximationChanged
        : amountChanged || comparatorChanged || unitChanged;
    if (changed) {
      add(
        "quantity-unit",
        "SEM_QUANTITY_CHANGED",
        "Quantity amount, comparator, unit, or exactness changed.",
      );
    }
  }

  if (left.kind === "entity" && right.kind === "entity") {
    if (left.concept !== right.concept) {
      add(
        "identity-reference",
        "SEM_ENTITY_IDENTITY_CHANGED",
        "Entity concept identity changed.",
      );
    }
  }

  if (left.kind === "reference" && right.kind === "reference") {
    if (
      !semanticEqual(sorted(left.candidates), sorted(right.candidates)) ||
      left.resolved !== right.resolved
    ) {
      add(
        "identity-reference",
        "SEM_REFERENCE_CHANGED",
        "Reference candidates or resolved identity changed.",
      );
    }
  }

  if (left.kind === "proposition" && right.kind === "proposition") {
    if (!semanticEqual(left.scope ?? null, right.scope ?? null)) {
      add("scope", "SEM_SCOPE_CHANGED", "Proposition scope changed.");
    }
    if (left.attribution !== right.attribution) {
      add(
        "attribution",
        "SEM_ATTRIBUTION_CHANGED",
        "Claim attribution changed or was removed.",
      );
    }
  }

  if (hasModality(left) && hasModality(right)) {
    if (!semanticEqual(left.modality ?? null, right.modality ?? null)) {
      add(
        "modality",
        "SEM_MODALITY_CHANGED",
        "Modal force changed across the transformation.",
      );
    }
  }

  if (left.kind === "constraint" && right.kind === "constraint") {
    if (
      left.constraintKind === "condition" &&
      (
        right.constraintKind !== "condition" ||
        left.subject !== right.subject ||
        left.predicate !== right.predicate ||
        !semanticEqual(left.parameters, right.parameters)
      )
    ) {
      add(
        "condition",
        "SEM_CONDITION_CHANGED",
        "A semantic condition changed its subject, predicate, or parameters.",
      );
    }
  }

  if (
    enabled.has("source-provenance") &&
    (
      left.trust !== right.trust ||
      !semanticEqual(sorted(left.provenance), sorted(right.provenance))
    )
  ) {
    add(
      "source-provenance",
      "SEM_PROVENANCE_CHANGED",
      "Source provenance or trust label changed.",
    );
  }

  if (left.kind === "unknown-concept" && right.kind === "unknown-concept") {
    if (
      !semanticEqual(left.mention, right.mention) ||
      !semanticEqual(sorted(left.expectedParents), sorted(right.expectedParents)) ||
      !semanticEqual(sorted(left.candidateConcepts), sorted(right.candidateConcepts))
    ) {
      add(
        "unknown-preservation",
        "SEM_UNKNOWN_CHANGED",
        "An unresolved concept was silently narrowed, renamed, or replaced.",
      );
    }
  }

  if (
    left.kind === "relation" &&
    right.kind === "relation" &&
    causalRelation(left.relation) &&
    (
      left.relation !== right.relation ||
      left.source !== right.source ||
      left.target !== right.target
    )
  ) {
    add(
      "causal-direction",
      "SEM_CAUSAL_DIRECTION_CHANGED",
      "A causal/evidential relation changed identity or direction.",
    );
  }

  if (
    left.kind === "relation" &&
    right.kind === "relation" &&
    temporalRelation(left.relation) &&
    (
      left.relation !== right.relation ||
      left.source !== right.source ||
      left.target !== right.target
    )
  ) {
    add(
      "temporal-order",
      "SEM_TEMPORAL_ORDER_CHANGED",
      "A temporal relation changed identity or direction.",
    );
  }

  if (left.kind === "definition" && right.kind === "definition") {
    if (!semanticValueEqual(left.definition, right.definition)) {
      add(
        "opaque-exactness",
        "SEM_DEFINITION_VALUE_CHANGED",
        "Definition payload changed under exact-preservation checking.",
      );
    }
  }

  return violations;
};

export const verifySemanticPreservation = (
  source: GraphSnapshot,
  candidate: GraphSnapshot,
  profile: PreservationProfile = criticalSemanticPreservationProfile,
): PreservationReport => {
  const checked = requestedInvariants(profile);
  const enabled = new Set<PreservationInvariant>(checked);
  const candidateById = nodeMap(candidate);
  const violations: InvariantViolation[] = [];

  for (const sourceNode of source.nodes) {
    const candidateNode = candidateById.get(sourceNode.id);
    if (candidateNode === undefined) {
      violations.push(...missingNodeSpecificViolations(sourceNode, enabled));
      continue;
    }
    violations.push(
      ...compareMatchedNodes(sourceNode, candidateNode, profile, enabled),
    );
  }

  if (!profile.allowElaboration) {
    const sourceById = nodeMap(source);
    for (const candidateNode of candidate.nodes) {
      if (sourceById.has(candidateNode.id)) continue;
      violations.push({
        invariant: "semantic-presence",
        code: "SEM_ELABORATION_NOT_ALLOWED",
        message:
          "Candidate introduced a new semantic node while elaboration is disabled.",
        candidateNodeId: candidateNode.id,
      });
    }
  }

  return {
    ok: violations.length === 0,
    profile: { id: profile.id, version: profile.version },
    checked,
    violations,
  };
};

export interface SemanticPreservationSubject {
  source: GraphSnapshot;
  candidate: GraphSnapshot;
  profile?: PreservationProfile;
}

export class SemanticPreservationVerifier
  implements Verifier<SemanticPreservationSubject>
{
  readonly manifest: VerifierManifest = {
    id: "verifier.semantic-preservation",
    version: "1.0.0",
    description:
      "Deterministically checks critical JSG semantic-preservation invariants.",
    mode: "deterministic",
    kinds: ["semantic-preservation"],
  };

  canVerify(
    obligation: VerificationObligation,
    subject: SemanticPreservationSubject,
  ): boolean {
    return (
      obligation.kind === "semantic-preservation" &&
      Array.isArray(subject.source.nodes) &&
      Array.isArray(subject.candidate.nodes)
    );
  }

  async verify(
    obligation: VerificationObligation,
    subject: SemanticPreservationSubject,
    _context: VerifyContext,
  ): Promise<VerificationResult> {
    const report = verifySemanticPreservation(
      subject.source,
      subject.candidate,
      subject.profile ?? criticalSemanticPreservationProfile,
    );
    const severity =
      obligation.severity === "required"
        ? "error"
        : obligation.severity === "recommended"
          ? "warning"
          : "info";

    return {
      obligationId: obligation.id,
      status: report.ok ? "pass" : "fail",
      evidence: [
        "evidence:semantic-preservation:" +
          report.profile.id +
          "@" +
          report.profile.version,
      ],
      diagnostics: report.violations.map((violation) => ({
        code: violation.code,
        severity,
        message: violation.message,
        nodeRefs: [
          ...(violation.sourceNodeId === undefined
            ? []
            : [violation.sourceNodeId]),
          ...(violation.candidateNodeId === undefined
            ? []
            : [violation.candidateNodeId]),
        ] as SemanticId[],
        details: {
          invariant: violation.invariant,
        },
      })),
      verifier: {
        id: this.manifest.id,
        version: this.manifest.version,
        mode: this.manifest.mode,
        evidenceGrade: "formal-deterministic-proof",
      },
    };
  }
}
