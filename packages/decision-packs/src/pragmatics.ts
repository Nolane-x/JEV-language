import type {
  DecisionPackManifest,
} from "./index.ts";

export const pragmaticDiscourseStrategyPack: DecisionPackManifest = {
  id: "nlg.discourse.strategy.v1",
  version: "1.0.0",
  maturity: "candidate",
  stateProjector: "pragmatics.discourse.compact-v1",
  questions: {
    strategy: {
      type: "choice",
      instruction:
        "Select the discourse strategy that best expresses the supplied semantic plan for the stated audience without changing truth conditions.",
      options: {
        direct: {
          description: "State the main content directly with minimal framing.",
        },
        "cause-first": {
          description:
            "Lead with an explicit cause or reason when the semantic plan contains one.",
        },
        "evidence-first": {
          description:
            "Lead with supporting evidence before the main conclusion.",
        },
        "definition-first": {
          description:
            "Introduce a needed definition before relying on the concept.",
        },
        stepwise: {
          description:
            "Explain the semantic units in prerequisite-respecting steps.",
        },
        contrastive: {
          description:
            "Organize content around an explicit semantic contrast.",
        },
      },
    },
  },
  fallback: { onLowConfidence: "deterministic-fallback" },
  fixtures: [
    "pragmatics:strategy:direct",
    "pragmatics:strategy:cause",
    "pragmatics:strategy:evidence",
    "pragmatics:strategy:definition",
    "pragmatics:strategy:stepwise",
    "pragmatics:strategy:contrast",
  ],
  semanticPurpose:
    "Choose among pre-generated discourse strategies while preserving the JSG truth conditions and required semantic relations.",
  inputSchema: {
    type: "object",
    required: ["goal", "relations", "audience"],
  },
  candidateSemantics: [
    "direct",
    "cause-first",
    "evidence-first",
    "definition-first",
    "stepwise",
    "contrastive",
  ],
  candidateSources: [
    {
      id: "candidate-source:pragmatics:strategy",
      kind: "configured",
      sourceRef: "pragmatics.strategy-enumeration.v1",
      questionIds: ["strategy"],
    },
  ],
  candidateRecallReport: {
    datasetRef: "fixtures:pragmatics:strategy:v1",
    recall: 1,
    cases: 6,
  },
  hardConstraints: [
    "selected strategy must be present in the configured candidate set",
    "strategy must not remove required semantic units",
    "strategy must not invert cause, condition, polarity, modality, or attribution",
  ],
  counterexamples: [
    "select cause-first when no causal relation exists",
    "select contrastive when no contrast is represented",
  ],
  knownFailureModes: [
    "state projection omits a discourse relation needed to discriminate strategies",
    "multiple strategies remain equally appropriate for the audience",
  ],
  traceOutput: true,
};

export const pragmaticDetailLevelPack: DecisionPackManifest = {
  id: "nlg.detail.level.v1",
  version: "1.0.0",
  maturity: "candidate",
  stateProjector: "pragmatics.detail.compact-v1",
  questions: {
    detail: {
      type: "choice",
      instruction:
        "Choose the appropriate detail level for the supplied audience and semantic content without omitting required claims.",
      options: {
        minimal: {
          description:
            "Include required content only; omit optional elaboration.",
        },
        concise: {
          description:
            "Include required content plus only high-relevance optional detail.",
        },
        normal: {
          description:
            "Include a balanced amount of relevant evidence and explanation.",
        },
        detailed: {
          description:
            "Include most relevant supporting detail while preserving coherence.",
        },
        exhaustive: {
          description:
            "Include all supported relevant detail that fits the configured budget.",
        },
      },
    },
  },
  fallback: { onLowConfidence: "deterministic-fallback" },
  fixtures: [
    "pragmatics:detail:minimal",
    "pragmatics:detail:concise",
    "pragmatics:detail:normal",
    "pragmatics:detail:detailed",
    "pragmatics:detail:exhaustive",
  ],
  semanticPurpose:
    "Choose among bounded audience-detail profiles after required semantic content has been protected.",
  inputSchema: {
    type: "object",
    required: ["audience", "requiredCount", "optionalCount"],
  },
  candidateSemantics: [
    "minimal",
    "concise",
    "normal",
    "detailed",
    "exhaustive",
  ],
  candidateSources: [
    {
      id: "candidate-source:pragmatics:detail",
      kind: "configured",
      sourceRef: "pragmatics.detail-enumeration.v1",
      questionIds: ["detail"],
    },
  ],
  candidateRecallReport: {
    datasetRef: "fixtures:pragmatics:detail:v1",
    recall: 1,
    cases: 5,
  },
  hardConstraints: [
    "required semantic content must remain included at every detail level",
    "selected detail level must be one of the configured bounded profiles",
  ],
  counterexamples: [
    "minimal detail removes a required condition",
    "detailed mode invents unsupported evidence",
  ],
  knownFailureModes: [
    "audience projection is too coarse to discriminate adjacent detail levels",
  ],
  traceOutput: true,
};

export const pragmaticDecisionPacks = [
  pragmaticDiscourseStrategyPack,
  pragmaticDetailLevelPack,
] as const;
