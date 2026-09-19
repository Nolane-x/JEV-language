import { describe, expect, it } from "vitest";
import {
  parseControlledEnglishCorpus,
  type ControlledCorpusPhenomenon,
} from "../../packages/grounding/src/index.ts";

interface CorpusCase {
  input: string;
  phenomena: ControlledCorpusPhenomenon[];
}

const corpus: CorpusCase[] = [
  {
    input: "The service deletes exactly 3 files.",
    phenomena: ["simple-event", "exact-quantity"],
  },
  {
    input: "The service does not delete exactly 2 files.",
    phenomena: ["simple-event", "negation", "exact-quantity"],
  },
  {
    input: "The service deletes exactly 4 files on 2026-09-19.",
    phenomena: ["simple-event", "exact-quantity", "time"],
  },
  {
    input: "The service must delete exactly 1 file.",
    phenomena: ["requirement", "exact-quantity"],
  },
  {
    input: "The service may delete at most 3 files.",
    phenomena: ["permission", "comparison"],
  },
  {
    input: "The service must not delete any files.",
    phenomena: ["prohibition", "negation"],
  },
  {
    input:
      "If deletion is prohibited, the service must not delete more than 3 files.",
    phenomena: ["condition", "requirement", "negation", "comparison"],
  },
  {
    input:
      "The service must not delete more than 3 files because deletion is prohibited.",
    phenomena: ["cause", "requirement", "negation", "comparison"],
  },
  {
    input: "May the service delete exactly 3 files?",
    phenomena: ["question", "permission", "exact-quantity"],
  },
];

describe("M4 controlled semantic corpus", () => {
  for (const fixture of corpus) {
    it(`parses: ${fixture.input}`, () => {
      const result = parseControlledEnglishCorpus(fixture.input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.roots.length).toBeGreaterThan(0);
      expect(result.value.phenomena).toEqual(fixture.phenomena);
      expect(
        result.value.snapshot.nodes.some((node) => node.kind === "entity"),
      ).toBe(true);
      expect(
        result.value.snapshot.nodes.some((node) => node.kind === "quantity"),
      ).toBe(true);
      expect(
        result.value.snapshot.nodes.every(
          (node) => node.provenance.length > 0,
        ),
      ).toBe(true);
    });
  }

  it("preserves explicit event negation", () => {
    const result = parseControlledEnglishCorpus(
      "The service does not delete exactly 2 files.",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const event = result.value.snapshot.nodes.find(
      (node) => node.kind === "event",
    );
    expect(event?.kind).toBe("event");
    if (event?.kind === "event") {
      expect(event.polarity).toBe("negative");
    }
  });

  it("preserves exact quantity and unit separately", () => {
    const result = parseControlledEnglishCorpus(
      "The service deletes exactly 3 files.",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const quantity = result.value.snapshot.nodes.find(
      (node) => node.kind === "quantity",
    );
    expect(quantity?.kind).toBe("quantity");
    if (quantity?.kind === "quantity") {
      expect(quantity.amount).toBe(3);
      expect(quantity.comparator).toBe("exact");
      expect(quantity.unit).toBe("concept:core.file");
    }
  });

  it("binds an absolute date through a temporal node rather than surface text", () => {
    const result = parseControlledEnglishCorpus(
      "The service deletes exactly 4 files on 2026-09-19.",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const event = result.value.snapshot.nodes.find(
      (node) => node.kind === "event",
    );
    const temporal = result.value.snapshot.nodes.find(
      (node) => node.kind === "temporal",
    );
    expect(event?.kind).toBe("event");
    expect(temporal?.kind).toBe("temporal");
    if (event?.kind === "event" && temporal?.kind === "temporal") {
      expect(event.temporal).toBe(temporal.id);
      expect(temporal.value).toEqual({
        iso: "2026-09-19",
        precision: "date",
      });
    }
  });

  it("distinguishes requirement, permission, and prohibition semantics", () => {
    const examples = [
      ["The service must delete exactly 1 file.", "requirement"],
      ["The service may delete at most 3 files.", "permission"],
      ["The service must not delete any files.", "prohibition"],
    ] as const;

    for (const [input, expectedKind] of examples) {
      const result = parseControlledEnglishCorpus(input);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      const constraint = result.value.snapshot.nodes.find(
        (node) => node.kind === "constraint",
      );
      expect(constraint?.kind).toBe("constraint");
      if (constraint?.kind === "constraint") {
        expect(constraint.constraintKind).toBe(expectedKind);
      }
    }
  });

  it("represents conditions and causal direction structurally", () => {
    const conditional = parseControlledEnglishCorpus(
      "If deletion is prohibited, the service must not delete more than 3 files.",
    );
    expect(conditional.ok).toBe(true);
    if (conditional.ok) {
      const condition = conditional.value.snapshot.nodes.find(
        (node) =>
          node.kind === "constraint" &&
          node.constraintKind === "condition",
      );
      expect(condition?.kind).toBe("constraint");
      if (condition?.kind === "constraint") {
        expect(condition.predicate).toBe("concept:core.condition");
        expect(condition.parameters[0]?.role).toBe("role:core.condition");
      }
    }

    const causal = parseControlledEnglishCorpus(
      "The service must not delete more than 3 files because deletion is prohibited.",
    );
    expect(causal.ok).toBe(true);
    if (causal.ok) {
      const relation = causal.value.snapshot.nodes.find(
        (node) => node.kind === "relation",
      );
      expect(relation?.kind).toBe("relation");
      if (relation?.kind === "relation") {
        expect(relation.relation).toBe("concept:core.cause");
        const source = causal.value.snapshot.nodes.find(
          (node) => node.id === relation.source,
        );
        const target = causal.value.snapshot.nodes.find(
          (node) => node.id === relation.target,
        );
        expect(source?.kind).toBe("state");
        expect(target?.kind).toBe("constraint");
      }
    }
  });

  it("represents questions as questioned propositions with permission modality", () => {
    const result = parseControlledEnglishCorpus(
      "May the service delete exactly 3 files?",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const proposition = result.value.snapshot.nodes.find(
      (node) => node.kind === "proposition",
    );
    expect(proposition?.kind).toBe("proposition");
    if (proposition?.kind === "proposition") {
      expect(proposition.epistemic?.status).toBe("questioned");
      expect(proposition.modality?.kind).toBe("permitted");
      expect(proposition.polarity).toBe("positive");
    }
  });

  it("rejects unsupported free-form input instead of inventing semantics", () => {
    const result = parseControlledEnglishCorpus(
      "Please somehow make everything better.",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "GROUNDING_CONTROLLED_CORPUS_UNSUPPORTED",
      );
    }
  });
});
