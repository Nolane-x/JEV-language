import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type { DecisionRuntime } from "../../decision-runtime/src/index.ts";
import { referenceResolutionDecisionPack } from "../../decision-packs/src/index.ts";

export interface ReferenceCandidate {
  id: SemanticId;
  label: string;
  semanticType: string;
  recencyRank: number;
}

export interface ReferenceResolution {
  candidates: SemanticId[];
  resolved?: SemanticId;
  confidence?: number;
  source: "deterministic" | "jev" | "unresolved";
}

export const resolveReference = async (input: {
  requestId: string;
  mention: string;
  candidates: ReferenceCandidate[];
  runtime: DecisionRuntime;
  minimumConfidence?: number;
  modelProfile?: string;
}): Promise<Result<ReferenceResolution>> => {
  const candidates = [...input.candidates].sort(
    (a, b) =>
      a.recencyRank - b.recencyRank ||
      a.id.localeCompare(b.id),
  );
  if (candidates.length === 0) {
    return err(
      new StructuredError(
        "GROUNDING_NO_REFERENCE_CANDIDATES",
        "Reference resolution has no compatible candidates.",
      ),
    );
  }
  if (candidates.length === 1) {
    return ok({
      candidates: [candidates[0]!.id],
      resolved: candidates[0]!.id,
      confidence: 1,
      source: "deterministic",
    });
  }

  const optionToId = new Map<string, SemanticId>();
  const options: Record<string, { description: { label: string; semanticType: string; recencyRank: number } }> = {};
  candidates.forEach((candidate, index) => {
    const key = `candidate_${index}`;
    optionToId.set(key, candidate.id);
    options[key] = {
      description: {
        label: candidate.label,
        semanticType: candidate.semanticType,
        recencyRank: candidate.recencyRank,
      },
    };
  });

  const packQuestion = referenceResolutionDecisionPack.questions.referent;
  if (packQuestion === undefined || packQuestion.type !== "choice") {
    return err(
      new StructuredError(
        "GROUNDING_REFERENCE_PACK_INVALID",
        "Reference-resolution Decision Pack does not expose the expected Choice question.",
      ),
    );
  }

  const response = await input.runtime.execute({
    id: input.requestId,
    modelProfile: input.modelProfile ?? "jev-latest",
    state: {
      mention: input.mention,
      candidates: candidates.map((candidate, index) => ({
        key: `candidate_${index}`,
        label: candidate.label,
        semanticType: candidate.semanticType,
        recencyRank: candidate.recencyRank,
      })),
    },
    questions: {
      referent: {
        ...packQuestion,
        options,
      },
    },
  });

  const answer = response.answers.find(
    (candidate) => candidate.questionId === "referent" && candidate.type === "choice",
  );
  if (answer === undefined || typeof answer.selected !== "string") {
    return err(
      new StructuredError(
        "GROUNDING_REFERENCE_NO_CHOICE",
        "Reference decision did not return a normalized Choice answer.",
      ),
    );
  }
  const selected = optionToId.get(answer.selected);
  if (selected === undefined) {
    return err(
      new StructuredError(
        "GROUNDING_REFERENCE_INVALID_CHOICE",
        "Reference decision selected an option outside the candidate map.",
      ),
    );
  }
  const minimumConfidence = input.minimumConfidence ?? 0.65;
  if (answer.confidence === undefined || answer.confidence < minimumConfidence) {
    return ok({
      candidates: candidates.map((candidate) => candidate.id),
      ...(answer.confidence === undefined
        ? {}
        : { confidence: answer.confidence }),
      source: "unresolved",
    });
  }

  return ok({
    candidates: candidates.map((candidate) => candidate.id),
    resolved: selected,
    confidence: answer.confidence,
    source: "jev",
  });
};
