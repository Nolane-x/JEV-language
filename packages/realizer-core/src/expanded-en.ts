import {
  err,
  ok,
  type Result,
} from "../../core-types/src/index.ts";
import type { StyleProfile } from "../../pragmatics/src/index.ts";
import type { GraphSnapshot } from "../../semantic-graph/src/index.ts";
import {
  realizeControlledEnglishCorpusArtifact,
} from "./controlled-corpus-en.ts";

export type ExpandedEnglishFrame =
  | "active"
  | "passive"
  | "fronted-temporal"
  | "conditional-tail"
  | "cause-front"
  | "reported-speech";

export interface ExpandedEnglishAlternative {
  id: string;
  text: string;
  syntacticFrame: ExpandedEnglishFrame;
  lexicalChoice: "delete" | "remove";
  semanticJustificationRuleIds: string[];
  baseCost: number;
  preferenceScore: number;
}

const withRemove = (
  text: string,
): string =>
  text
    .replace(/\bdeletes\b/gi, "removes")
    .replace(/\bdelete\b/gi, "remove")
    .replace(/\bdeleted\b/gi, "removed");

const lexicalChoiceOf = (
  text: string,
): "delete" | "remove" =>
  /\bremov(?:e|es|ed)\b/i.test(text) ? "remove" : "delete";

const pushAlternative = (
  output: ExpandedEnglishAlternative[],
  input: Omit<ExpandedEnglishAlternative, "lexicalChoice" | "preferenceScore">,
): void => {
  if (output.some((entry) => entry.text === input.text)) return;
  output.push({
    ...input,
    lexicalChoice: lexicalChoiceOf(input.text),
    preferenceScore: 0,
  });
};

const deriveAlternatives = (
  canonical: string,
): ExpandedEnglishAlternative[] => {
  const output: ExpandedEnglishAlternative[] = [];
  pushAlternative(output, {
    id: "surface:canonical",
    text: canonical,
    syntacticFrame: "active",
    semanticJustificationRuleIds: ["sem:canonical-controlled-realization"],
    baseCost: 0,
  });

  const removed = withRemove(canonical);
  if (removed !== canonical) {
    pushAlternative(output, {
      id: "surface:lexical-remove",
      text: removed,
      syntacticFrame: "active",
      semanticJustificationRuleIds: [
        "sem:lexeme-core-delete-equivalence",
      ],
      baseCost: 0.1,
    });
  }

  let match = /^The service deletes exactly (\d+) (file|files)(?: on (\d{4}-\d{2}-\d{2}))?\.$/.exec(
    canonical,
  );
  if (match !== null) {
    const amount = match[1]!;
    const noun = match[2]!;
    const date = match[3];
    pushAlternative(output, {
      id: "surface:passive-event",
      text: `Exactly ${amount} ${noun} ${noun === "file" ? "is" : "are"} deleted by the service${date === undefined ? "" : ` on ${date}`}.`,
      syntacticFrame: "passive",
      semanticJustificationRuleIds: ["sem:voice-role-preservation"],
      baseCost: 0.15,
    });
    if (date !== undefined) {
      pushAlternative(output, {
        id: "surface:fronted-temporal",
        text: `On ${date}, the service deletes exactly ${amount} ${noun}.`,
        syntacticFrame: "fronted-temporal",
        semanticJustificationRuleIds: [
          "sem:temporal-adjunct-order-preservation",
        ],
        baseCost: 0.12,
      });
    }
  }

  match = /^The service does not delete exactly (\d+) (file|files)\.$/.exec(
    canonical,
  );
  if (match !== null) {
    const amount = match[1]!;
    const noun = match[2]!;
    pushAlternative(output, {
      id: "surface:passive-negative-event",
      text: `Exactly ${amount} ${noun} ${noun === "file" ? "is" : "are"} not deleted by the service.`,
      syntacticFrame: "passive",
      semanticJustificationRuleIds: [
        "sem:voice-role-preservation",
        "sem:negation-scope-preservation",
      ],
      baseCost: 0.2,
    });
  }

  match = /^The service must delete exactly (\d+) (file|files)\.$/.exec(
    canonical,
  );
  if (match !== null) {
    const amount = match[1]!;
    const noun = match[2]!;
    pushAlternative(output, {
      id: "surface:passive-requirement",
      text: `Exactly ${amount} ${noun} must be deleted by the service.`,
      syntacticFrame: "passive",
      semanticJustificationRuleIds: [
        "sem:voice-role-preservation",
        "sem:required-modality-preservation",
      ],
      baseCost: 0.15,
    });
  }

  match = /^The service may delete at most (\d+) (file|files)\.$/.exec(
    canonical,
  );
  if (match !== null) {
    const amount = match[1]!;
    const noun = match[2]!;
    pushAlternative(output, {
      id: "surface:passive-permission",
      text: `At most ${amount} ${noun} may be deleted by the service.`,
      syntacticFrame: "passive",
      semanticJustificationRuleIds: [
        "sem:voice-role-preservation",
        "sem:permission-modality-preservation",
      ],
      baseCost: 0.15,
    });
  }

  if (canonical === "The service must not delete any files.") {
    pushAlternative(output, {
      id: "surface:passive-prohibition",
      text: "No files may be deleted by the service.",
      syntacticFrame: "passive",
      semanticJustificationRuleIds: [
        "sem:prohibition-preservation",
        "sem:voice-role-preservation",
      ],
      baseCost: 0.18,
    });
  }

  match =
    /^The service must not delete more than (\d+) (file|files)\.$/.exec(
      canonical,
    );
  if (match !== null) {
    const amount = match[1]!;
    const noun = match[2]!;
    pushAlternative(output, {
      id: "surface:formal-max-cardinality",
      text: `The service is required to delete no more than ${amount} ${noun}.`,
      syntacticFrame: "active",
      semanticJustificationRuleIds: [
        "sem:maximum-cardinality-preservation",
        "sem:required-modality-preservation",
      ],
      baseCost: 0.2,
    });
  }

  match =
    /^If deletion is prohibited, the service must not delete more than (\d+) (file|files)\.$/.exec(
      canonical,
    );
  if (match !== null) {
    const amount = match[1]!;
    const noun = match[2]!;
    pushAlternative(output, {
      id: "surface:conditional-tail",
      text: `The service must not delete more than ${amount} ${noun} if deletion is prohibited.`,
      syntacticFrame: "conditional-tail",
      semanticJustificationRuleIds: [
        "sem:condition-scope-preservation",
      ],
      baseCost: 0.12,
    });
  }

  match =
    /^The service must not delete more than (\d+) (file|files) because deletion is prohibited\.$/.exec(
      canonical,
    );
  if (match !== null) {
    const amount = match[1]!;
    const noun = match[2]!;
    pushAlternative(output, {
      id: "surface:cause-front",
      text: `Because deletion is prohibited, the service must not delete more than ${amount} ${noun}.`,
      syntacticFrame: "cause-front",
      semanticJustificationRuleIds: [
        "sem:causal-direction-preservation",
      ],
      baseCost: 0.12,
    });
  }

  match = /^May the service delete exactly (\d+) (file|files)\?$/.exec(
    canonical,
  );
  if (match !== null) {
    const amount = match[1]!;
    const noun = match[2]!;
    pushAlternative(output, {
      id: "surface:permission-question",
      text: `Is the service permitted to delete exactly ${amount} ${noun}?`,
      syntacticFrame: "passive",
      semanticJustificationRuleIds: [
        "sem:question-force-preservation",
        "sem:permission-modality-preservation",
      ],
      baseCost: 0.15,
    });
  }

  match =
    /^According to the service, the service deletes exactly (\d+) (file|files)\.$/.exec(
      canonical,
    );
  if (match !== null) {
    const amount = match[1]!;
    const noun = match[2]!;
    pushAlternative(output, {
      id: "surface:reported-speech",
      text: `The service reports that it deletes exactly ${amount} ${noun}.`,
      syntacticFrame: "reported-speech",
      semanticJustificationRuleIds: [
        "sem:reported-attribution-preservation",
      ],
      baseCost: 0.12,
    });
  }

  return output;
};

const preferenceScore = (
  alternative: ExpandedEnglishAlternative,
  style: StyleProfile,
): number => {
  let score = 0;
  const preferredDeleteTerm =
    style.preferredTerms?.["concept:core.delete"];
  if (preferredDeleteTerm === "remove") {
    score += alternative.lexicalChoice === "remove" ? 1 : -0.2;
  } else if (preferredDeleteTerm === "delete") {
    score += alternative.lexicalChoice === "delete" ? 0.5 : -0.1;
  }

  if ((style.formality ?? 0.5) >= 0.7) {
    if (
      alternative.syntacticFrame === "passive" ||
      alternative.syntacticFrame === "reported-speech"
    ) {
      score += 0.25;
    }
  }
  if ((style.directness ?? 0.5) >= 0.7) {
    if (
      alternative.syntacticFrame === "active" &&
      alternative.id === "surface:canonical"
    ) {
      score += 0.3;
    }
  }
  return score;
};

export const realizeExpandedEnglishAlternatives = (
  snapshot: GraphSnapshot,
  style: StyleProfile = {},
): Result<ExpandedEnglishAlternative[]> => {
  const canonical = realizeControlledEnglishCorpusArtifact(snapshot);
  if (!canonical.ok) return err(canonical.error);

  const alternatives = deriveAlternatives(canonical.value.text).map(
    (alternative) => ({
      ...alternative,
      preferenceScore: preferenceScore(alternative, style),
    }),
  );

  return ok(
    alternatives.sort(
      (a, b) =>
        b.preferenceScore - a.preferenceScore ||
        a.baseCost - b.baseCost ||
        a.id.localeCompare(b.id),
    ),
  );
};
