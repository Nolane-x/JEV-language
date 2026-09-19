import { describe, expect, it } from "vitest";
import {
  englishLanguagePack,
} from "../../packages/language-en/src/index.ts";
import {
  vietnameseLanguagePack,
} from "../../packages/language-vi/src/index.ts";
import {
  compareControlledSemanticDimensions,
  type MultilingualSemanticDimension,
} from "../../packages/verifier-core/src/index.ts";

const fixtures = [
  {
    id: "simple-fact",
    en: "The service deletes exactly 3 files.",
    vi: "Dịch vụ xóa đúng 3 tệp.",
    dimensions: ["predicate", "roles", "quantity"] as const,
  },
  {
    id: "condition",
    en: "If deletion is prohibited, the service must not delete more than 3 files.",
    vi: "Nếu việc xóa bị cấm, dịch vụ không được xóa quá 3 tệp.",
    dimensions: ["condition", "modality", "quantity"] as const,
  },
  {
    id: "causality",
    en: "The service must not delete more than 3 files because deletion is prohibited.",
    vi: "Dịch vụ không được xóa quá 3 tệp vì việc xóa bị cấm.",
    dimensions: ["causality", "modality", "quantity"] as const,
  },
  {
    id: "negation",
    en: "The service does not delete exactly 2 files.",
    vi: "Dịch vụ không xóa đúng 2 tệp.",
    dimensions: ["polarity", "quantity"] as const,
  },
  {
    id: "quantity",
    en: "The service must delete exactly 1 file.",
    vi: "Dịch vụ phải xóa đúng 1 tệp.",
    dimensions: ["quantity", "modality"] as const,
  },
  {
    id: "modality",
    en: "The service may delete at most 3 files.",
    vi: "Dịch vụ được phép xóa tối đa 3 tệp.",
    dimensions: ["modality", "quantity"] as const,
  },
  {
    id: "time",
    en: "The service deletes exactly 4 files on 2026-09-19.",
    vi: "Dịch vụ xóa đúng 4 tệp vào 2026-09-19.",
    dimensions: ["time", "quantity"] as const,
  },
  {
    id: "reported-claim",
    en: "According to the service, the service deletes exactly 3 files.",
    vi: "Theo dịch vụ, dịch vụ xóa đúng 3 tệp.",
    dimensions: ["attribution", "predicate", "quantity"] as const,
  },
  {
    id: "dialogue-reference",
    en: 'Here, "it" refers to the service.',
    vi: 'Ở đây, "nó" chỉ dịch vụ.',
    dimensions: ["reference"] as const,
  },
  {
    id: "instruction-as-content",
    en: "The instruction says the service must delete exactly 3 files.",
    vi: "Chỉ dẫn yêu cầu dịch vụ xóa đúng 3 tệp.",
    dimensions: ["instruction-content", "modality", "quantity"] as const,
  },
] as const;

const requireOk = <T>(
  result: { ok: true; value: T } | { ok: false; error: Error },
): T => {
  if (!result.ok) throw result.error;
  return result.value;
};

const expectDimensions = (
  report: ReturnType<typeof compareControlledSemanticDimensions>,
  required: readonly MultilingualSemanticDimension[],
): void => {
  expect(report.equivalent, report.diagnostics.join("\n")).toBe(true);
  for (const dimension of required) {
    expect(
      report.checks.find((check) => check.dimension === dimension)?.status,
      `expected semantic dimension ${dimension} to pass`,
    ).toBe("pass");
  }
  expect(report.checks.some((check) => check.status === "fail")).toBe(false);
};

describe("M9 multilingual semantic equivalence gate", () => {
  for (const fixture of fixtures) {
    it(`maps independent English and Vietnamese surfaces to compatible JSG: ${fixture.id}`, () => {
      const en = requireOk(
        englishLanguagePack.parserHooks.parse(fixture.en),
      );
      const vi = requireOk(
        vietnameseLanguagePack.parserHooks.parse(fixture.vi),
      );

      const report = compareControlledSemanticDimensions(
        en.snapshot,
        vi.snapshot,
      );
      expectDimensions(report, fixture.dimensions);
    });

    it(`round-trips one semantic core independently through English and Vietnamese: ${fixture.id}`, () => {
      const source = requireOk(
        englishLanguagePack.parserHooks.parse(fixture.en),
      );

      const englishSurface = requireOk(
        englishLanguagePack.realizationHooks.realize(source.snapshot),
      );
      const vietnameseSurface = requireOk(
        vietnameseLanguagePack.realizationHooks.realize(source.snapshot),
      );

      // Surface strings are deliberately not treated as gold. The gate reparses
      // both independently realized outputs and evaluates semantic dimensions.
      const englishRoundTrip = requireOk(
        englishLanguagePack.parserHooks.parse(englishSurface),
      );
      const vietnameseRoundTrip = requireOk(
        vietnameseLanguagePack.parserHooks.parse(vietnameseSurface),
      );

      expectDimensions(
        compareControlledSemanticDimensions(
          source.snapshot,
          englishRoundTrip.snapshot,
        ),
        fixture.dimensions,
      );
      expectDimensions(
        compareControlledSemanticDimensions(
          source.snapshot,
          vietnameseRoundTrip.snapshot,
        ),
        fixture.dimensions,
      );
      expectDimensions(
        compareControlledSemanticDimensions(
          englishRoundTrip.snapshot,
          vietnameseRoundTrip.snapshot,
        ),
        fixture.dimensions,
      );
    });
  }

  it("keeps dialogue-reference pronoun surfaces language-specific while preserving the referent", () => {
    const en = requireOk(
      englishLanguagePack.parserHooks.parse(
        'Here, "it" refers to the service.',
      ),
    );
    const vi = requireOk(
      vietnameseLanguagePack.parserHooks.parse(
        'Ở đây, "nó" chỉ dịch vụ.',
      ),
    );

    const enReference = en.snapshot.nodes.find(
      (node) => node.kind === "reference",
    );
    const viReference = vi.snapshot.nodes.find(
      (node) => node.kind === "reference",
    );
    expect(enReference?.kind).toBe("reference");
    expect(viReference?.kind).toBe("reference");

    const report = compareControlledSemanticDimensions(
      en.snapshot,
      vi.snapshot,
    );
    expectDimensions(report, ["reference"]);
  });

  it("keeps instruction as semantic content rather than executable Action IR", () => {
    const en = requireOk(
      englishLanguagePack.parserHooks.parse(
        "The instruction says the service must delete exactly 3 files.",
      ),
    );
    const vi = requireOk(
      vietnameseLanguagePack.parserHooks.parse(
        "Chỉ dẫn yêu cầu dịch vụ xóa đúng 3 tệp.",
      ),
    );

    for (const snapshot of [en.snapshot, vi.snapshot]) {
      const intent = snapshot.nodes.find((node) => node.kind === "intent");
      expect(intent?.kind).toBe("intent");
      if (intent?.kind === "intent") {
        expect(intent.intent).toBe("concept:core.instruction");
        expect(intent.content).toBeDefined();
      }
      expect(snapshot.nodes.some((node) => node.kind === "action")).toBe(true);
      expect(
        snapshot.nodes.some(
          (node) =>
            node.kind === "capability" ||
            node.kind === "goal",
        ),
      ).toBe(false);
    }

    expectDimensions(
      compareControlledSemanticDimensions(en.snapshot, vi.snapshot),
      ["instruction-content", "modality", "quantity"],
    );
  });

  it("reports a dimension-level failure when meaning changes even if the surface family remains similar", () => {
    const positive = requireOk(
      englishLanguagePack.parserHooks.parse(
        "The service deletes exactly 3 files.",
      ),
    );
    const negative = requireOk(
      englishLanguagePack.parserHooks.parse(
        "The service does not delete exactly 3 files.",
      ),
    );

    const report = compareControlledSemanticDimensions(
      positive.snapshot,
      negative.snapshot,
    );
    expect(report.equivalent).toBe(false);
    expect(
      report.checks.find((check) => check.dimension === "polarity")?.status,
    ).toBe("fail");
    expect(report.diagnostics).toContain(
      "semantic dimension mismatch: polarity",
    );
  });
});
