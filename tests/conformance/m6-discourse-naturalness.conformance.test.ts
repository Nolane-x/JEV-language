import { describe, expect, it } from "vitest";
import { createSemanticId } from "../../packages/core-types/src/index.ts";
import {
  enrichDiscoursePlan,
  planSafeClauseAggregation,
  type ClausePlan,
  type DiscoursePlan,
} from "../../packages/discourse-ir/src/index.ts";
import {
  pragmaticDecisionPacks,
  validateDecisionPack,
} from "../../packages/decision-packs/src/index.ts";
import {
  parseControlledEnglishCorpus,
} from "../../packages/grounding/src/index.ts";
import {
  createEnglishSeedLexicon,
} from "../../packages/language-en/src/index.ts";
import {
  createHumanEvalBundle,
  evaluateTemplateLeakage,
  exportHumanEvalJsonl,
  mergeStyleProfiles,
  proposeExplanationStrategies,
  RepetitionTracker,
  selectAudienceAwareDetail,
} from "../../packages/pragmatics/src/index.ts";
import {
  enumerateParaphrasePaths,
  realizeControlledEnglishCorpusArtifact,
  scoreCollocation,
  validateParaphraseLattice,
  type ParaphraseLattice,
} from "../../packages/realizer-core/src/index.ts";

describe("M6 discourse and naturalness foundation", () => {
  it("derives explicit cause and condition discourse relations from JSG roots", () => {
    for (const input of [
      "The service must not delete more than 3 files because deletion is prohibited.",
      "If deletion is prohibited, the service must not delete more than 3 files.",
    ]) {
      const parsed = parseControlledEnglishCorpus(input);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const artifact = realizeControlledEnglishCorpusArtifact(
        parsed.value.snapshot,
      );
      expect(artifact.ok).toBe(true);
      if (!artifact.ok) continue;

      const enriched = enrichDiscoursePlan(
        parsed.value.snapshot,
        artifact.value.plan.discourse,
      );
      expect(enriched.ok).toBe(true);
      if (!enriched.ok) continue;

      expect(enriched.value.relations.length).toBeGreaterThan(0);
      expect(
        enriched.value.relations.some((relation) =>
          input.startsWith("If ")
            ? relation.kind === "condition"
            : relation.kind === "cause",
        ),
      ).toBe(true);
    }
  });

  it("proposes aggregation only when clause safety invariants match", () => {
    const agent = createSemanticId("entity");
    const predicateA = createSemanticId("concept");
    const predicateB = createSemanticId("concept");
    const unitA = createSemanticId("unit");
    const unitB = createSemanticId("unit");

    const plan: DiscoursePlan = {
      id: "disc:aggregation",
      goal: { kind: "answer", semanticRoots: [agent] },
      units: [
        { id: String(unitA), kind: "claim", semanticRefs: [predicateA] },
        { id: String(unitB), kind: "claim", semanticRefs: [predicateB] },
      ],
      relations: [],
      orderingConstraints: [],
    };
    const clauses: ClausePlan[] = [
      {
        id: "clause:a",
        sourceUnitId: String(unitA),
        predicate: predicateA,
        roles: [
          {
            role: "role:core.agent",
            value: { kind: "ref", ref: agent },
          },
        ],
        clauseType: "declarative",
        polarity: "positive",
        modality: { kind: "asserted" },
      },
      {
        id: "clause:b",
        sourceUnitId: String(unitB),
        predicate: predicateB,
        roles: [
          {
            role: "role:core.agent",
            value: { kind: "ref", ref: agent },
          },
        ],
        clauseType: "declarative",
        polarity: "positive",
        modality: { kind: "asserted" },
      },
    ];

    const safe = planSafeClauseAggregation(plan, clauses);
    expect(safe.ok).toBe(true);
    if (safe.ok) {
      expect(safe.value[0]).toMatchObject({
        kind: "shared-subject-coordination",
        clauseIds: ["clause:a", "clause:b"],
      });
    }

    const unsafe = structuredClone(clauses);
    unsafe[1]!.polarity = "negative";
    const rejected = planSafeClauseAggregation(plan, unsafe);
    expect(rejected.ok).toBe(true);
    if (rejected.ok) expect(rejected.value).toEqual([]);
  });

  it("builds and lazily enumerates an explicit paraphrase lattice", () => {
    const lattice: ParaphraseLattice = {
      id: "lattice:test",
      dimensions: [
        "syntactic-construction",
        "lexical-choice",
        "reference-form",
      ],
      choices: [
        {
          id: "syntax:active",
          dimension: "syntactic-construction",
          value: "active",
          semanticJustificationRuleIds: ["sem:voice-preserves-roles"],
          cost: 0,
        },
        {
          id: "syntax:passive",
          dimension: "syntactic-construction",
          value: "passive",
          semanticJustificationRuleIds: ["sem:voice-preserves-roles"],
          cost: 0.2,
        },
        {
          id: "lex:delete",
          dimension: "lexical-choice",
          value: "delete",
          semanticJustificationRuleIds: ["lex:delete.core-delete"],
          cost: 0,
        },
        {
          id: "lex:remove",
          dimension: "lexical-choice",
          value: "remove",
          semanticJustificationRuleIds: ["lex:remove.core-delete"],
          cost: 0.1,
        },
        {
          id: "ref:full",
          dimension: "reference-form",
          value: "the service",
          semanticJustificationRuleIds: ["ref:service-unambiguous"],
          cost: 0,
        },
        {
          id: "ref:pronoun",
          dimension: "reference-form",
          value: "it",
          semanticJustificationRuleIds: ["ref:service-given-unambiguous"],
          cost: 0.1,
        },
      ],
    };

    expect(validateParaphraseLattice(lattice).ok).toBe(true);
    const paths = enumerateParaphrasePaths(lattice, 4);
    expect(paths.ok).toBe(true);
    if (paths.ok) {
      expect(paths.value).toHaveLength(4);
      expect(paths.value[0]?.choiceIds).toEqual([
        "syntax:active",
        "lex:delete",
        "ref:full",
      ]);
      expect(
        paths.value.every(
          (path) => path.semanticJustificationRuleIds.length > 0,
        ),
      ).toBe(true);
    }
  });

  it("merges style deterministically without changing semantic content", () => {
    const merged = mergeStyleProfiles([
      {
        id: "language-default",
        priority: 0,
        profile: {
          verbosity: 0.4,
          formality: 0.5,
          directness: 0.6,
          preferredTerms: { "concept:core.delete": "delete" },
        },
      },
      {
        id: "consumer",
        priority: 20,
        profile: {
          verbosity: 0.8,
          formality: 0.7,
          preferredTerms: { "concept:core.delete": "remove" },
        },
      },
    ]);
    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.value).toMatchObject({
        verbosity: 0.8,
        formality: 0.7,
        directness: 0.6,
        preferredTerms: { "concept:core.delete": "remove" },
      });
    }
  });

  it("tracks repetition and supplies bounded penalties", () => {
    const tracker = new RepetitionTracker(4);
    tracker.record({ kind: "sentence-opening", key: "The service" });
    tracker.record({ kind: "sentence-opening", key: "The service" });
    expect(tracker.count("sentence-opening", "The service")).toBe(2);
    expect(tracker.penalty("sentence-opening", "The service")).toBe(1);
    expect(tracker.snapshot()).toHaveLength(2);
  });

  it("proposes explanation strategies only when supported by discourse structure", () => {
    const parsed = parseControlledEnglishCorpus(
      "The service must not delete more than 3 files because deletion is prohibited.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const artifact = realizeControlledEnglishCorpusArtifact(parsed.value.snapshot);
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) return;
    const enriched = enrichDiscoursePlan(
      parsed.value.snapshot,
      artifact.value.plan.discourse,
    );
    expect(enriched.ok).toBe(true);
    if (!enriched.ok) return;

    const strategies = proposeExplanationStrategies(enriched.value, {
      expertise: 0.2,
      desiredDetail: 0.8,
    });
    expect(strategies.ok).toBe(true);
    if (strategies.ok) {
      expect(strategies.value).toContain("cause-first");
      expect(strategies.value).toContain("definition-first");
    }
  });

  it("selects audience detail while never dropping required candidates", () => {
    const requiredRef = createSemanticId("claim");
    const optionalRef = createSemanticId("claim");
    const result = selectAudienceAwareDetail(
      [
        {
          semanticRef: requiredRef,
          unitKind: "claim",
          relevance: 1,
          novelty: 1,
          evidenceStrength: 1,
          uncertainty: 0,
          required: true,
        },
        {
          semanticRef: optionalRef,
          unitKind: "example",
          relevance: 0.2,
          novelty: 0.3,
          evidenceStrength: 0.5,
          uncertainty: 0.1,
        },
      ],
      {
        expertise: 0.9,
        desiredDetail: 0.1,
        urgency: 1,
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.selected.map((item) => item.semanticRef)).toContain(
        requiredRef,
      );
    }
  });

  it("scores inspectable collocation rules", () => {
    const lexicon = createEnglishSeedLexicon();
    const score = scoreCollocation(
      "concept:core.delete",
      "concept:core.file",
      lexicon.collocations(),
      { domain: "software" },
    );
    expect(score.allowed).toBe(true);
    expect(score.score).toBeGreaterThan(0);
    expect(score.contributions).toEqual([
      {
        ruleId: "collocation:en.delete-file",
        relation: "prefers",
        score: 1,
      },
    ]);
  });

  it("validates pragmatic decision packs against candidate quality gates", () => {
    expect(pragmaticDecisionPacks).toHaveLength(2);
    for (const pack of pragmaticDecisionPacks) {
      const result = validateDecisionPack(pack);
      expect(result.ok).toBe(true);
    }
  });

  it("measures template leakage separately from semantic correctness", () => {
    const healthy = evaluateTemplateLeakage(
      [
        { id: "a", text: "The service deletes exactly three files." },
        { id: "b", text: "Exactly four files are removed by the service." },
        { id: "c", text: "Deletion is limited to five files." },
        { id: "d", text: "No more than six files may be deleted." },
      ],
      ["A fixed canned sentence."],
    );
    expect(healthy.ok).toBe(true);
    if (healthy.ok) expect(healthy.value.passed).toBe(true);

    const leaked = evaluateTemplateLeakage(
      [
        { id: "a", text: "A fixed canned sentence." },
        { id: "b", text: "A fixed canned sentence." },
        { id: "c", text: "A fixed canned sentence." },
      ],
      ["A fixed canned sentence."],
    );
    expect(leaked.ok).toBe(true);
    if (leaked.ok) {
      expect(leaked.value.passed).toBe(false);
      expect(leaked.value.knownTemplateRate).toBe(1);
    }
  });

  it("exports blinded human-eval JSONL with explicit dimensions", () => {
    const bundle = createHumanEvalBundle([
      {
        id: "case:1",
        inputRef: "fixture:semantic:1",
        output: "The service deletes exactly three files.",
        semanticConstraints: [
          "preserve exact quantity",
          "preserve actor",
        ],
        dimensions: [
          "faithfulness",
          "grammar",
          "clarity",
          "naturalness",
          "repetition",
        ],
      },
    ]);
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;
    const jsonl = exportHumanEvalJsonl(bundle.value);
    const record = JSON.parse(jsonl);
    expect(record).toMatchObject({
      schemaVersion: "jev-human-eval-1",
      blinded: true,
      id: "case:1",
    });
    expect(record).not.toHaveProperty("model");
  });
});
