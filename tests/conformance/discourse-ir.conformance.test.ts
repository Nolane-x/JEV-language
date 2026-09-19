import { describe, expect, it } from "vitest";
import {
  discourseRelationDefinition,
  orderDiscourse,
  selectContent,
  validateDiscoursePlan,
  type DiscoursePlan,
} from "../../packages/discourse-ir/src/index.ts";

const ref = (id: string) => id as `${string}:${string}`;

describe("Discourse IR contracts", () => {
  it("validates a graph-structured explanation plan", () => {
    const plan: DiscoursePlan = {
      id: "plan:explain-semantic-ir",
      goal: {
        kind: "explain",
        semanticRoots: [ref("proposition:root")],
        targetLength: "concise",
      },
      units: [
        {
          id: "u:claim",
          kind: "claim",
          semanticRefs: [ref("proposition:claim")],
          required: true,
        },
        {
          id: "u:evidence",
          kind: "evidence",
          semanticRefs: [ref("evidence:1")],
        },
        {
          id: "u:summary",
          kind: "summary",
          semanticRefs: [ref("proposition:summary")],
        },
      ],
      relations: [
        {
          id: "r:support",
          kind: "evidence",
          nucleus: "u:claim",
          satellite: "u:evidence",
        },
      ],
      orderingConstraints: [
        {
          id: "o:claim-before-summary",
          before: "u:claim",
          after: "u:summary",
          kind: "logical-prerequisite",
          hard: true,
        },
      ],
    };

    expect(validateDiscoursePlan(plan).ok).toBe(true);
  });

  it("rejects hard logical-ordering cycles", () => {
    const plan: DiscoursePlan = {
      id: "plan:cycle",
      goal: { kind: "explain", semanticRoots: [ref("proposition:root")] },
      units: [
        { id: "u:a", kind: "claim", semanticRefs: [ref("proposition:a")] },
        { id: "u:b", kind: "explanation", semanticRefs: [ref("proposition:b")] },
      ],
      relations: [],
      orderingConstraints: [
        {
          id: "o:a-b",
          before: "u:a",
          after: "u:b",
          kind: "logical-prerequisite",
          hard: true,
        },
        {
          id: "o:b-a",
          before: "u:b",
          after: "u:a",
          kind: "logical-prerequisite",
          hard: true,
        },
      ],
    };

    const result = validateDiscoursePlan(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DIR_ORDER_CYCLE");
  });

  it("never violates hard prerequisites to satisfy soft ordering preferences", () => {
    const result = orderDiscourse({
      units: [
        { id: "u:definition", kind: "definition", semanticRefs: [] },
        { id: "u:claim", kind: "claim", semanticRefs: [] },
        { id: "u:example", kind: "example", semanticRefs: [] },
      ],
      orderingConstraints: [
        {
          id: "hard:def-before-claim",
          before: "u:definition",
          after: "u:claim",
          kind: "logical-prerequisite",
          hard: true,
        },
        {
          id: "soft:example-first",
          before: "u:example",
          after: "u:definition",
          kind: "configured",
          hard: false,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.orderedUnitIds.indexOf("u:definition")).toBeLessThan(
      result.value.orderedUnitIds.indexOf("u:claim"),
    );
  });

  it("selects prerequisite content before dependent content", () => {
    const prerequisite = ref("proposition:definition");
    const dependent = ref("proposition:mechanism");

    const result = selectContent(
      [
        {
          semanticRef: dependent,
          unitKind: "explanation",
          relevance: 1,
          novelty: 1,
          evidenceStrength: 1,
          uncertainty: 0,
          prerequisiteRefs: [prerequisite],
        },
        {
          semanticRef: prerequisite,
          unitKind: "definition",
          relevance: 0.8,
          novelty: 0.8,
          evidenceStrength: 1,
          uncertainty: 0,
        },
      ],
      { maxUnits: 2 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selected.map((entry) => entry.semanticRef)).toEqual([
      prerequisite,
      dependent,
    ]);
  });

  it("rejects weak or overly uncertain optional content without deleting required content", () => {
    const result = selectContent(
      [
        {
          semanticRef: ref("proposition:required"),
          unitKind: "claim",
          relevance: 1,
          novelty: 1,
          evidenceStrength: 0.1,
          uncertainty: 0.9,
          required: true,
        },
        {
          semanticRef: ref("proposition:weak"),
          unitKind: "claim",
          relevance: 1,
          novelty: 1,
          evidenceStrength: 0.1,
          uncertainty: 0.1,
        },
        {
          semanticRef: ref("proposition:uncertain"),
          unitKind: "qualification",
          relevance: 1,
          novelty: 1,
          evidenceStrength: 1,
          uncertainty: 0.9,
        },
      ],
      {
        maxUnits: 3,
        minEvidenceStrength: 0.5,
        maxUncertainty: 0.5,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selected.map((entry) => entry.semanticRef)).toContain(
      ref("proposition:required"),
    );
    expect(result.value.rejected.map((entry) => entry.reason).sort()).toEqual([
      "too-uncertain",
      "weak-evidence",
    ]);
  });

  it("keeps rhetorical relations semantic rather than connective-specific", () => {
    expect(discourseRelationDefinition("contrast")).toContain(
      "semantically contrasted",
    );
    expect(discourseRelationDefinition("condition")).toContain("condition");
  });
});
