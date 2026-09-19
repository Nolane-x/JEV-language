import { describe, expect, it } from "vitest";
import { parseControlledEnglishCorpus } from "../../packages/grounding/src/index.ts";
import {
  realizeControlledEnglishCorpus,
  realizeControlledEnglishCorpusArtifact,
} from "../../packages/realizer-core/src/index.ts";
import {
  projectControlledCorpusSemantics,
  verifyControlledCorpusEquivalence,
} from "../../packages/verifier-core/src/index.ts";

const corpus = [
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

describe("M5 controlled English realization and round trip", () => {
  for (const input of corpus) {
    it(`round-trips semantics: ${input}`, () => {
      const parsed = parseControlledEnglishCorpus(input);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const realized = realizeControlledEnglishCorpusArtifact(
        parsed.value.snapshot,
      );
      expect(realized.ok).toBe(true);
      if (!realized.ok) return;

      const reparsed = parseControlledEnglishCorpus(realized.value.text);
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) return;

      const equivalence = verifyControlledCorpusEquivalence(
        parsed.value.snapshot,
        reparsed.value.snapshot,
      );
      expect(equivalence.equivalent).toBe(true);
      expect(projectControlledCorpusSemantics(parsed.value.snapshot).ok).toBe(
        true,
      );
      expect(realized.value.semanticRoots.length).toBeGreaterThan(0);
      expect(realized.value.plan.discourse.units.length).toBeGreaterThan(0);
      expect(realized.value.plan.discourse.goal.semanticRoots).toEqual(
        realized.value.semanticRoots,
      );
      expect(realized.value.plan.clauses.length).toBeGreaterThan(0);
      expect(realized.value.sourceMap[0]).toMatchObject({
        start: 0,
        end: realized.value.text.length,
        kind: "clause",
      });
    });
  }

  it("produces canonical controlled English rather than copying original source text", () => {
    const parsed = parseControlledEnglishCorpus(
      "The service must not delete more than 3 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const realized = realizeControlledEnglishCorpus(parsed.value.snapshot);
    expect(realized).toEqual({
      ok: true,
      value: "The service must not delete more than 3 files.",
    });
  });

  it("maps generated quantities back to their semantic quantity node", () => {
    const parsed = parseControlledEnglishCorpus(
      "The service deletes exactly 4 files on 2026-09-19.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const quantity = parsed.value.snapshot.nodes.find(
      (node) => node.kind === "quantity",
    );
    const temporal = parsed.value.snapshot.nodes.find(
      (node) => node.kind === "temporal",
    );
    const realized = realizeControlledEnglishCorpusArtifact(
      parsed.value.snapshot,
    );
    expect(realized.ok).toBe(true);
    if (!realized.ok || quantity?.kind !== "quantity") return;

    const quantityMap = realized.value.sourceMap.find(
      (entry) => entry.kind === "quantity",
    );
    expect(quantityMap?.semanticRefs).toContain(quantity.id);
    expect(realized.value.text.slice(quantityMap?.start, quantityMap?.end)).toBe(
      "4",
    );

    if (temporal?.kind === "temporal") {
      const timeMap = realized.value.sourceMap.find(
        (entry) => entry.kind === "temporal",
      );
      expect(timeMap?.semanticRefs).toContain(temporal.id);
      expect(
        realized.value.text.slice(timeMap?.start, timeMap?.end),
      ).toBe("2026-09-19");
    }
  });

  it("preserves reported-source attribution through JSG → English → JSG", () => {
    const parsed = parseControlledEnglishCorpus(
      "According to the service, the service deletes exactly 3 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const before = projectControlledCorpusSemantics(parsed.value.snapshot);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value).toMatchObject({
      kind: "attributed-proposition",
      epistemic: "reported",
      attributionConcept: "concept:core.software-service",
    });

    const realized = realizeControlledEnglishCorpusArtifact(
      parsed.value.snapshot,
    );
    expect(realized.ok).toBe(true);
    if (!realized.ok) return;
    expect(realized.value.text).toBe(
      "According to the service, the service deletes exactly 3 files.",
    );

    const reparsed = parseControlledEnglishCorpus(realized.value.text);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(
      verifyControlledCorpusEquivalence(
        parsed.value.snapshot,
        reparsed.value.snapshot,
      ).equivalent,
    ).toBe(true);
  });

  it("meets the explicit 100% semantic round-trip target for the current controlled corpus", () => {
    let passed = 0;
    for (const input of corpus) {
      const parsed = parseControlledEnglishCorpus(input);
      if (!parsed.ok) continue;
      const realized = realizeControlledEnglishCorpus(parsed.value.snapshot);
      if (!realized.ok) continue;
      const reparsed = parseControlledEnglishCorpus(realized.value);
      if (!reparsed.ok) continue;
      if (
        verifyControlledCorpusEquivalence(
          parsed.value.snapshot,
          reparsed.value.snapshot,
        ).equivalent
      ) {
        passed += 1;
      }
    }

    expect({
      target: 1,
      passed,
      total: corpus.length,
      rate: passed / corpus.length,
    }).toEqual({
      target: 1,
      passed: corpus.length,
      total: corpus.length,
      rate: 1,
    });
  });

  it("does not realize unsupported unrelated graphs as fake controlled language", () => {
    const parsed = parseControlledEnglishCorpus(
      "The service deletes exactly 3 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const unsupported = structuredClone(parsed.value.snapshot);
    unsupported.nodes = unsupported.nodes.filter(
      (node) => node.kind === "entity",
    );
    const result = realizeControlledEnglishCorpus(unsupported);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REALIZE_CONTROLLED_CORPUS_UNSUPPORTED");
    }
  });
});
