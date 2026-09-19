import type {
  DecisionPackManifest,
} from "./index.ts";

export const referenceResolutionDecisionPack: DecisionPackManifest = {
  id: "dialogue.reference-resolution.v1",
  version: "1.0.0",
  maturity: "candidate",
  stateProjector: "dialogue.reference-candidates.v1",
  questions: {
    referent: {
      type: "choice",
      instruction:
        "Select the intended referent only from the bounded discourse candidate set using semantic compatibility, active topic, mention history, and recency. Do not invent a referent outside the candidate set.",
      options: {
        dynamic_candidate: {
          description:
            "Runtime placeholder; dialogue-state injects the bounded candidate set for each request.",
        },
      },
    },
  },
  fallback: { onLowConfidence: "preserve-ambiguity" },
  fixtures: [
    "dialogue:reference:single-candidate",
    "dialogue:reference:recent-compatible",
    "dialogue:reference:old-entity-after-topic-shift",
    "dialogue:reference:low-confidence-preserved",
    "dialogue:reference:type-filter",
    "dialogue:reference:no-candidate-error",
  ],
  semanticPurpose:
    "Resolve an anaphoric or referring expression to one already-grounded discourse entity without generating new entity identity.",
  inputSchema: {
    type: "object",
    required: ["mention", "candidates"],
  },
  candidateSemantics: [
    "one of the bounded semantic entity ids supplied by dialogue-state",
  ],
  candidateSources: [
    {
      id: "candidate-source:dialogue:salience",
      kind: "configured",
      sourceRef: "dialogue-state.referenceCandidatesFromState.v1",
      questionIds: ["referent"],
    },
  ],
  candidateRecallReport: {
    datasetRef: "fixtures:dialogue:reference-resolution:v1",
    recall: 1,
    cases: 6,
  },
  hardConstraints: [
    "selected referent must be present in the supplied candidate map",
    "candidate identity must remain a SemanticId from existing dialogue state",
    "low confidence must preserve ambiguity rather than invent a referent",
  ],
  counterexamples: [
    "select an entity not present in the supplied candidate set",
    "resolve low-confidence ambiguity as certain",
    "prefer recency over an incompatible semantic type",
  ],
  knownFailureModes: [
    "candidate generation omitted the intended entity",
    "multiple semantically compatible entities remain equally salient",
    "state projection lacks a discourse feature needed to distinguish candidates",
  ],
  traceOutput: true,
};
