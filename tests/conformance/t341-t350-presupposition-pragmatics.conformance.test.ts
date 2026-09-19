import { describe, expect, it } from "vitest";
import type { SemanticId } from "../../packages/core-types/src/index.ts";
import {
  assertLanguagePackIdentity,
  type LanguagePackIdentityView,
  type LanguagePresuppositionTriggerDescriptor,
  type PresuppositionTriggerRegistryProvider,
} from "../../packages/language-pack-core/src/index.ts";
import {
  IdiomRegistry,
  SemanticCoercionRuleRegistry,
  generateAccommodationCandidates,
  generateScalarInferences,
  validatePresupposition,
  type PresuppositionRecord,
} from "../../packages/pragmatics/src/index.ts";

const sid = (value: string): SemanticId => value as SemanticId;

const presupposition = (
  input: Partial<PresuppositionRecord> = {},
): PresuppositionRecord => ({
  id: "presupposition:again",
  contentRef: sid("proposition:prior-event"),
  triggerId: "en.lexeme.again",
  status: "triggered",
  assertionStatus: "not-asserted",
  language: "en",
  triggerSurface: "again",
  ...input,
});

describe("T341-T350 presupposition and pragmatic inference conformance", () => {
  it("T341 defines a non-asserted presupposition schema with explicit lifecycle status", () => {
    const valid = validatePresupposition(presupposition());
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value.status).toBe("triggered");
      expect(valid.value.assertionStatus).toBe("not-asserted");
      expect(valid.value.contentRef).toBe("proposition:prior-event");
    }

    const invalid = validatePresupposition({
      ...presupposition(),
      assertionStatus: "not-asserted",
      triggerId: "",
    });
    expect(invalid.ok).toBe(false);
  });

  it("T342 exposes a language-pack trigger registry ABI and includes it in identity checks", () => {
    const trigger: LanguagePresuppositionTriggerDescriptor = {
      id: "en.trigger.again",
      language: "en",
      kind: "lexical",
      triggerKey: "lexeme:again",
      presuppositionType: "prior-occurrence",
      cancellable: true,
      projectionPreference: "unresolved",
    };
    const provider: PresuppositionTriggerRegistryProvider = {
      id: "en.presupposition-triggers.v1",
      language: "en",
      triggers: () => [trigger],
    };
    expect(provider.triggers()).toEqual([trigger]);

    const identity: LanguagePackIdentityView = {
      manifest: { id: "language-en", languageTag: "en" },
      tokenizer: { language: "en" },
      morphology: { language: "en" },
      lexicon: { language: "en" },
      grammar: { language: "en" },
      parserHooks: { language: "en" },
      realizationHooks: { language: "en" },
      punctuation: { language: "en" },
      discourse: { language: "en" },
      presuppositionTriggers: { language: "en" },
      tests: { language: "en" },
    };
    expect(() => assertLanguagePackIdentity(identity)).not.toThrow();

    expect(() =>
      assertLanguagePackIdentity({
        ...identity,
        presuppositionTriggers: { language: "vi" },
      }),
    ).toThrow(/mixes provider languages/);
  });

  it("T343-T344 generates local/global accommodation alternatives without auto-asserting either", () => {
    const result = generateAccommodationCandidates(presupposition(), {
      localScopes: [
        sid("scope:embedded"),
        sid("scope:matrix"),
        sid("scope:embedded"),
      ],
      blockedScopes: [sid("scope:matrix")],
      allowGlobal: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value.map((candidate) => candidate.scope)).toEqual([
        { kind: "local", scopeRef: sid("scope:embedded") },
        { kind: "global" },
      ]);
      expect(
        result.value.every(
          (candidate) =>
            candidate.status === "candidate" &&
            candidate.assertionStatus === "not-asserted",
        ),
      ).toBe(true);
    }

    const cancelled = generateAccommodationCandidates(
      presupposition({ status: "cancelled" }),
      { localScopes: [sid("scope:embedded")] },
    );
    expect(cancelled).toEqual({ ok: true, value: [] });
  });

  it("T345 keeps pragmatic inference commitment separate from assertion", () => {
    const result = generateScalarInferences({
      scale: {
        id: "quantifier-strength",
        orderedValues: ["some", "many", "all"],
      },
      assertedValue: "some",
      sourceRef: sid("proposition:some-tests-passed"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(
        result.value.every(
          (candidate) =>
            candidate.kind === "scalar" &&
            candidate.status === "candidate" &&
            candidate.assertionStatus === "not-asserted",
        ),
      ).toBe(true);
    }
  });

  it("T346 makes scalar inferences explicitly cancellable rather than monotonic facts", () => {
    const open = generateScalarInferences({
      scale: {
        id: "quantifier-strength",
        orderedValues: ["some", "many", "all"],
      },
      assertedValue: "some",
      sourceRef: sid("proposition:some-tests-passed"),
    });
    expect(open.ok).toBe(true);
    if (open.ok) {
      expect(open.value.map((item) => item.status)).toEqual([
        "candidate",
        "candidate",
      ]);
    }

    const cancelled = generateScalarInferences({
      scale: {
        id: "quantifier-strength",
        orderedValues: ["some", "many", "all"],
      },
      assertedValue: "some",
      sourceRef: sid("proposition:some-tests-passed"),
      cancellationSignals: ["possibly all", "speaker explicitly rejects implicature"],
    });
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) {
      expect(cancelled.value.every((item) => item.status === "cancelled")).toBe(
        true,
      );
      expect(cancelled.value[0]?.cancellationReasons).toEqual([
        "possibly all",
        "speaker explicitly rejects implicature",
      ]);
    }
  });

  it("T347-T349 preserves literal/nonliteral ambiguity for multiword idioms", () => {
    const registry = new IdiomRegistry();
    expect(
      registry.register({
        id: "en.idiom.kick-the-bucket",
        language: "en",
        tokens: ["kick", "the", "bucket"],
        semanticRef: sid("concept:death"),
        gloss: "die",
      }).ok,
    ).toBe(true);

    const candidates = registry.candidates(
      ["Kick", "the", "bucket"],
      "en",
    );
    expect(candidates.ok).toBe(true);
    if (candidates.ok) {
      expect(candidates.value.map((candidate) => candidate.kind)).toEqual([
        "literal",
        "idiom",
      ]);
      expect(candidates.value[0]?.semanticRef).toBeUndefined();
      expect(candidates.value[1]).toMatchObject({
        idiomId: "en.idiom.kick-the-bucket",
        semanticRef: sid("concept:death"),
        assertionStatus: "not-asserted",
        status: "candidate",
      });
    }
  });

  it("T348 registers inspectable semantic coercion rules and returns candidates only when context licenses them", () => {
    const registry = new SemanticCoercionRuleRegistry();
    expect(
      registry.register({
        id: "coercion:artifact-to-reading-event",
        sourceType: "artifact:book",
        targetType: "event",
        resultSemanticRef: sid("concept:read"),
        requiredContextTags: ["predicate:begin"],
        description:
          "An artifact argument to begin may denote an event involving the artifact.",
      }).ok,
    ).toBe(true);

    const unsupported = registry.propose({
      sourceRef: sid("entity:book"),
      sourceType: "artifact:book",
      targetType: "event",
      contextTags: ["predicate:own"],
    });
    expect(unsupported).toEqual({ ok: true, value: [] });

    const supported = registry.propose({
      sourceRef: sid("entity:book"),
      sourceType: "artifact:book",
      targetType: "event",
      contextTags: ["predicate:begin"],
    });
    expect(supported.ok).toBe(true);
    if (supported.ok) {
      expect(supported.value).toEqual([
        {
          id: "coercion:coercion:artifact-to-reading-event:entity:book",
          ruleId: "coercion:artifact-to-reading-event",
          sourceRef: sid("entity:book"),
          sourceType: "artifact:book",
          targetType: "event",
          resultSemanticRef: sid("concept:read"),
          status: "candidate",
          assertionStatus: "not-asserted",
        },
      ]);
    }
  });

  it("T350 rejects duplicate registry entries and preserves cancellation/accommodation boundaries", () => {
    const idioms = new IdiomRegistry();
    const entry = {
      id: "en.idiom.break-the-ice",
      language: "en",
      tokens: ["break", "the", "ice"],
      semanticRef: sid("concept:initiate-social-interaction"),
    };
    expect(idioms.register(entry).ok).toBe(true);
    expect(idioms.register(entry).ok).toBe(false);

    const coercions = new SemanticCoercionRuleRegistry();
    const rule = {
      id: "coercion:place-to-organization",
      sourceType: "place",
      targetType: "organization",
      resultSemanticRef: sid("concept:institution"),
      description: "Metonymic place-to-institution candidate.",
    };
    expect(coercions.register(rule).ok).toBe(true);
    expect(coercions.register(rule).ok).toBe(false);

    const rejectedAccommodation = generateAccommodationCandidates(
      presupposition({ status: "rejected" }),
      { allowGlobal: true },
    );
    expect(rejectedAccommodation).toEqual({ ok: true, value: [] });

    const cancelledScalar = generateScalarInferences({
      scale: { id: "frequency", orderedValues: ["sometimes", "often", "always"] },
      assertedValue: "sometimes",
      sourceRef: sid("proposition:frequency"),
      cancellationSignals: ["explicit continuation cancels stronger exclusion"],
    });
    expect(cancelledScalar.ok).toBe(true);
    if (cancelledScalar.ok) {
      expect(cancelledScalar.value.every((item) => item.status === "cancelled")).toBe(
        true,
      );
      expect(
        cancelledScalar.value.every(
          (item) => item.assertionStatus === "not-asserted",
        ),
      ).toBe(true);
    }
  });
});
