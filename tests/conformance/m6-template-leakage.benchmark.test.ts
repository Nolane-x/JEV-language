import { describe, expect, it } from "vitest";
import {
  parseControlledEnglishCorpus,
  parseExpandedEnglishDocument,
} from "../../packages/grounding/src/index.ts";
import {
  evaluateTemplateLeakage,
} from "../../packages/pragmatics/src/index.ts";
import {
  realizeExpandedEnglishAlternatives,
  realizeExpandedEnglishDocument,
} from "../../packages/realizer-core/src/index.ts";

const trainingTemplates = [
  "The service deletes exactly 3 files.",
  "The service does not delete exactly 2 files.",
  "The service deletes exactly 4 files on 2026-09-19.",
  "The service must delete exactly 1 file.",
  "The service may delete at most 3 files.",
  "The service must not delete any files.",
  "The service must not delete more than 3 files.",
  "If deletion is prohibited, the service must not delete more than 3 files.",
  "The service must not delete more than 3 files because deletion is prohibited.",
  "May the service delete exactly 3 files?",
  "According to the service, the service deletes exactly 3 files.",
] as const;

const heldOut = [
  {
    input: "The service deletes exactly 7 files.",
    alternativeId: "surface:passive-event",
  },
  {
    input: "The service does not delete exactly 8 files.",
    alternativeId: "surface:passive-negative-event",
  },
  {
    input: "The service deletes exactly 9 files on 2027-01-23.",
    alternativeId: "surface:fronted-temporal",
  },
  {
    input: "The service must delete exactly 10 files.",
    alternativeId: "surface:passive-requirement",
  },
  {
    input: "The service may delete at most 11 files.",
    alternativeId: "surface:passive-permission",
  },
  {
    input: "The service must not delete any files.",
    alternativeId: "surface:passive-prohibition",
  },
  {
    input: "The service must not delete more than 12 files.",
    alternativeId: "surface:formal-max-cardinality",
  },
  {
    input:
      "If deletion is prohibited, the service must not delete more than 13 files.",
    alternativeId: "surface:conditional-tail",
  },
  {
    input:
      "The service must not delete more than 14 files because deletion is prohibited.",
    alternativeId: "surface:cause-front",
  },
  {
    input: "May the service delete exactly 15 files?",
    alternativeId: "surface:permission-question",
  },
  {
    input:
      "According to the service, the service deletes exactly 16 files.",
    alternativeId: "surface:reported-speech",
  },
] as const;

describe("M6 held-out template leakage benchmark", () => {
  it("stays below pre-registered structural leakage thresholds on held-out semantics", () => {
    const samples: Array<{ id: string; text: string }> = [];

    for (const [index, fixture] of heldOut.entries()) {
      const parsed = parseControlledEnglishCorpus(fixture.input);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const realized = realizeExpandedEnglishAlternatives(
        parsed.value.snapshot,
      );
      expect(realized.ok).toBe(true);
      if (!realized.ok) continue;
      const selected = realized.value.find(
        (entry) => entry.id === fixture.alternativeId,
      );
      expect(selected).toBeDefined();
      if (selected === undefined) continue;
      samples.push({
        id: `held-out:${index}`,
        text: selected.text,
      });
    }

    const relative = parseExpandedEnglishDocument(
      "The service, which deletes exactly 17 files, deletes exactly 18 files.",
    );
    expect(relative.ok).toBe(true);
    if (relative.ok) {
      const realized = realizeExpandedEnglishDocument(
        relative.value.snapshot,
        [relative.value.source],
      );
      expect(realized.ok).toBe(true);
      if (realized.ok) {
        samples.push({
          id: "held-out:relative",
          text:
            realized.value.find((entry) => entry.kind === "relative-clause")
              ?.text ?? "",
        });
        samples.push({
          id: "held-out:multi",
          text:
            realized.value.find((entry) => entry.kind === "multi-sentence")
              ?.text ?? "",
        });
      }
    }

    const unknown = parseExpandedEnglishDocument(
      "NovaBridge_7 deletes exactly 19 files.",
    );
    expect(unknown.ok).toBe(true);
    if (unknown.ok) {
      const realized = realizeExpandedEnglishDocument(
        unknown.value.snapshot,
        [unknown.value.source],
      );
      expect(realized.ok).toBe(true);
      if (realized.ok) {
        samples.push({
          id: "held-out:unknown",
          text:
            realized.value.find(
              (entry) => entry.kind === "unknown-name-synonym",
            )?.text ?? "",
        });
      }
    }

    expect(samples.every((sample) => sample.text.length > 0)).toBe(true);
    expect(samples).toHaveLength(14);

    const report = evaluateTemplateLeakage(
      samples,
      trainingTemplates,
      {
        maxKnownTemplateRate: 0,
        maxKnownStructuralTemplateRate: 0,
        maxDuplicateSurfaceRate: 0,
        maxStructuralTemplateReuseRate: 0.1,
        maxRepeatedOpeningRate: 0.25,
      },
    );
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    console.log(
      "M6_TEMPLATE_LEAKAGE_REPORT=" +
        JSON.stringify({
          ...report.value,
          corpus: {
            trainingTemplates: trainingTemplates.length,
            heldOutSamples: samples.length,
            exclusions: [
              "unrestricted open-domain English",
              "dialogue beyond the expanded fixture subset",
              "semantic domains outside the current controlled delete-event family",
            ],
          },
        }),
    );

    expect(report.value.passed).toBe(true);
  });
});
