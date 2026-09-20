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

export const conversationalSurfaceRankerPack: DecisionPackManifest = {
  id: "nlg.conversation.surface-ranker.v1",
  version: "1.0.0",
  maturity: "candidate",
  stateProjector: "pragmatics.conversation-candidates.compact-v1",
  questions: {
    candidate: {
      type: "choice",
      instruction:
        "Choose the best reply only from the supplied bounded candidate set. Preserve the supplied meaning exactly, fit the dialogue context and social register, sound idiomatic in the target language, avoid translationese, unnecessary repetition, canned phrasing, and awkward code-switching. If candidates are semantically equivalent, prefer the one a native speaker would most naturally send in this exact conversation.",
      options: {
        dynamic_candidate: {
          description:
            "Runtime placeholder; the response planner injects verified candidate ids and their surfaces for this request.",
        },
      },
    },
  },
  fallback: { onLowConfidence: "preserve-ambiguity" },
  fixtures: [
    "conversation-ranker:vi-casual",
    "conversation-ranker:vi-correction",
    "conversation-ranker:vi-en-code-switch",
    "conversation-ranker:en-casual",
    "conversation-ranker:en-uncertainty",
    "conversation-ranker:en-correction",
    "conversation-ranker:zh-naturalness",
    "conversation-ranker:ja-register",
  ],
  semanticPurpose:
    "Rank already-generated and semantically verified reply candidates for conversational naturalness without asking Jev to generate strings.",
  inputSchema: {
    type: "object",
    required: [
      "targetLanguage",
      "dialogueContext",
      "responseSemantics",
      "candidates",
    ],
  },
  candidateSemantics: [
    "one of the bounded candidate ids supplied by the verified surface-candidate generator",
  ],
  candidateSources: [
    {
      id: "candidate-source:conversation:verified-surfaces",
      kind: "configured",
      sourceRef: "realizer-core.conversation-candidate-set.v1",
      questionIds: ["candidate"],
    },
  ],
  candidateRecallReport: {
    datasetRef: "fixtures:conversation-ranker:v1",
    recall: 1,
    cases: 8,
  },
  hardConstraints: [
    "selected candidate must exist in the supplied bounded candidate map",
    "selected candidate must already pass semantic-preservation verification",
    "selected candidate must preserve polarity, modality, reference, attribution, quantity, conditions, and requested action",
    "unknown or opaque terms must remain byte-preserved when the response semantics requires preservation",
    "low-confidence ranking must preserve ambiguity rather than fabricate a winner",
  ],
  counterexamples: [
    "prefer a fluent candidate that silently drops a negation over a slightly less fluent faithful candidate",
    "replace an unknown project name with a familiar word because it sounds more natural",
    "choose formal translationese for an informal Vietnamese developer chat",
    "choose casual address forms when the dialogue context requires respectful Vietnamese address",
  ],
  knownFailureModes: [
    "candidate generator did not include a genuinely natural semantic-preserving surface",
    "dialogue-state projection omitted social relation or prior wording needed to judge register and repetition",
    "two candidates are effectively tied but the decision margin is treated as decisive",
    "language variety or code-switch norm is outside the calibration set",
  ],
  traceOutput: true,
};

export const pragmaticDecisionPacks = [
  pragmaticDiscourseStrategyPack,
  pragmaticDetailLevelPack,
  conversationalSurfaceRankerPack,
] as const;
