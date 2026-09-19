import {
  StructuredError,
  type JsonValue,
} from "../../core-types/src/index.ts";
import type {
  DecisionBatchRequest,
  DecisionBatchResponse,
  DecisionInstruction,
} from "../../decision-runtime/src/index.ts";
import {
  validateDecisionPack,
  type DecisionPackManifest,
} from "../../decision-packs/src/index.ts";
import type {
  RepairCandidate,
  RepairCandidateRanker,
  RepairDiagnostic,
} from "./model.ts";

export const repairCandidateDecisionPack: DecisionPackManifest = {
  id: "repair.candidate.select",
  version: "1.0.0",
  maturity: "fixture-tested",
  stateProjector: "repair.candidate-state.v1",
  questions: {
    select_repair: {
      type: "choice",
      instruction: {
        task:
          "Choose the already-generated repair candidate most likely to remove the supplied diagnostics without introducing regressions. Do not invent a new repair.",
      },
      options: {
        placeholder: null,
      },
    },
  },
  fallback: {
    onLowConfidence: "deterministic-fallback",
  },
  fixtures: ["fixture:m14-repair-selection"],
  semanticPurpose:
    "Rank bounded, statically generated repair candidates after deterministic legality checks.",
  inputSchema: {
    diagnostics: "normalized repair diagnostics",
    candidates: "bounded repair candidate descriptors",
  },
  candidateSemantics: [
    "candidate must be one of the statically generated repairs",
    "candidate should remove implicated diagnostics",
    "candidate should minimize regression risk and edit cost",
  ],
  hardConstraints: [
    "selected candidate id must be present in the supplied option set",
    "Jev does not synthesize source text or PIR operations",
  ],
  counterexamples: [
    "provider returns an unknown candidate id",
    "provider attempts to propose source outside the option set",
  ],
  knownFailureModes: [
    "candidate generator omitted the correct repair",
    "diagnostic evidence is insufficient to distinguish valid candidates",
  ],
  traceOutput: true,
};

const packValidation = validateDecisionPack(
  repairCandidateDecisionPack,
);
if (!packValidation.ok) throw packValidation.error;

export interface RepairDecisionExecutor {
  execute(
    request: DecisionBatchRequest,
    signal?: AbortSignal,
  ): Promise<DecisionBatchResponse>;
}

const candidateDescriptor = (
  candidate: RepairCandidate,
): { description: DecisionInstruction } => ({
  description: {
    kind: candidate.kind,
    cost: candidate.cost,
    rationale: candidate.rationale,
    expectedRemovedCodes: candidate.expectedRemovedCodes,
    diagnosticIds: candidate.diagnosticIds,
    sourcePatchCount: candidate.sourcePatches.length,
    pirOperationCount: candidate.pirOperations.length,
    evidenceRefs: candidate.evidenceRefs,
  },
});

const diagnosticState = (
  diagnostics: readonly RepairDiagnostic[],
): JsonValue[] =>
  diagnostics.map((diagnostic) => ({
    id: diagnostic.id,
    kind: diagnostic.kind,
    code: diagnostic.compiler.code,
    severity: diagnostic.compiler.severity,
    message: diagnostic.compiler.message,
    implicated: diagnostic.implicated.map((node) => ({
      refId: node.refId,
      nodeKind: node.nodeKind,
      relation: node.relation,
      distance: node.distance,
    })),
  }));

export interface JevRepairCandidateRankerOptions {
  executor: RepairDecisionExecutor;
  modelProfile: string;
  minimumConfidence?: number;
  requestPrefix?: string;
}

export class JevRepairCandidateRanker
  implements RepairCandidateRanker
{
  readonly id = "repair.jev-choice-ranker.v1";

  constructor(
    readonly options: JevRepairCandidateRankerOptions,
  ) {
    if (options.modelProfile.trim() === "") {
      throw new StructuredError(
        "REPAIR_RANKER_MODEL",
        "Repair candidate ranker requires a model profile.",
      );
    }
    if (
      options.minimumConfidence !== undefined &&
      (!Number.isFinite(options.minimumConfidence) ||
        options.minimumConfidence < 0 ||
        options.minimumConfidence > 1)
    ) {
      throw new StructuredError(
        "REPAIR_RANKER_CONFIDENCE",
        "Repair ranker minimumConfidence must be in [0, 1].",
      );
    }
  }

  async rank(input: {
    diagnostics: RepairDiagnostic[];
    candidates: RepairCandidate[];
  }): Promise<string[]> {
    const deterministic = [...input.candidates]
      .sort(
        (a, b) =>
          a.cost - b.cost || a.id.localeCompare(b.id),
      )
      .map((candidate) => candidate.id);

    if (input.candidates.length < 2) return deterministic;

    const questionId = "select_repair";
    const requestId =
      `${this.options.requestPrefix ?? "repair-rank"}:` +
      input.diagnostics.map((entry) => entry.id).sort().join("+");

    const request: DecisionBatchRequest = {
      id: requestId,
      modelProfile: this.options.modelProfile,
      state: {
        diagnostics: diagnosticState(input.diagnostics),
        candidateCount: input.candidates.length,
      },
      questions: {
        [questionId]: {
          type: "choice",
          instruction:
            repairCandidateDecisionPack.questions[
              questionId
            ]!.instruction,
          options: Object.fromEntries(
            input.candidates.map((candidate) => [
              candidate.id,
              candidateDescriptor(candidate),
            ]),
          ),
        },
      },
    };

    const response = await this.options.executor.execute(request);
    const answer = response.answers.find(
      (entry) => entry.questionId === questionId,
    );
    if (
      answer === undefined ||
      answer.type !== "choice" ||
      typeof answer.selected !== "string"
    ) {
      throw new StructuredError(
        "REPAIR_RANKER_ANSWER",
        "Repair ranker did not return a bounded Choice answer.",
      );
    }

    const ids = new Set(
      input.candidates.map((candidate) => candidate.id),
    );
    if (!ids.has(answer.selected)) {
      throw new StructuredError(
        "REPAIR_RANKER_OUT_OF_SET",
        `Repair ranker selected unknown candidate ${answer.selected}.`,
      );
    }

    const confidence =
      answer.confidence ??
      answer.probabilities[answer.selected];
    if (
      this.options.minimumConfidence !== undefined &&
      (confidence === undefined ||
        !Number.isFinite(confidence) ||
        confidence < this.options.minimumConfidence)
    ) {
      return deterministic;
    }

    return [
      answer.selected,
      ...deterministic.filter(
        (candidateId) => candidateId !== answer.selected,
      ),
    ];
  }
}
