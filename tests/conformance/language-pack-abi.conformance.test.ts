import { describe, expect, it } from "vitest";
import {
  assertLanguagePackIdentity,
} from "../../packages/language-pack-core/src/index.ts";
import {
  englishLanguagePack,
} from "../../packages/language-en/src/index.ts";
import {
  vietnameseLanguagePack,
} from "../../packages/language-vi/src/index.ts";

const packs = [englishLanguagePack, vietnameseLanguagePack] as const;

describe("HumanLanguagePack ABI conformance", () => {
  for (const pack of packs) {
    it(`${pack.manifest.id} exposes the complete common language-pack ABI`, () => {
      expect(() => assertLanguagePackIdentity(pack)).not.toThrow();
      expect(pack.manifest.schemaVersion).toBe("jl-language-pack-1");
      expect(pack.tokenizer.tokenize).toBeTypeOf("function");
      expect(pack.lexicon.create).toBeTypeOf("function");
      expect(pack.morphology.analyze).toBeTypeOf("function");
      expect(pack.morphology.realize).toBeTypeOf("function");
      expect(pack.grammar.create).toBeTypeOf("function");
      expect(pack.parserHooks.parse).toBeTypeOf("function");
      expect(pack.realizationHooks.realize).toBeTypeOf("function");
      expect(pack.punctuation.join).toBeTypeOf("function");
      expect(pack.discourse.choose).toBeTypeOf("function");
      expect(pack.tests.corpusRefs.length).toBeGreaterThan(0);
    });
  }

  it("keeps English and Vietnamese provider identities separate while sharing ABI shape", () => {
    expect(englishLanguagePack.manifest.languageTag).toBe("en");
    expect(vietnameseLanguagePack.manifest.languageTag).toBe("vi");
    expect(englishLanguagePack.parserHooks.id).not.toBe(
      vietnameseLanguagePack.parserHooks.id,
    );
    expect(englishLanguagePack.realizationHooks.id).not.toBe(
      vietnameseLanguagePack.realizationHooks.id,
    );
    expect(englishLanguagePack.grammar.id).not.toBe(
      vietnameseLanguagePack.grammar.id,
    );
  });

  it("routes both packs through shared JSG-facing hooks rather than cross-pack translation", () => {
    const en = englishLanguagePack.parserHooks.parse(
      "The service must not delete more than 3 files.",
    );
    const vi = vietnameseLanguagePack.parserHooks.parse(
      "Dịch vụ không được xóa quá 3 tệp.",
    );
    expect(en.ok).toBe(true);
    expect(vi.ok).toBe(true);
    if (!en.ok || !vi.ok) return;

    const enFromVi = englishLanguagePack.realizationHooks.realize(
      vi.value.snapshot,
    );
    const viFromEn = vietnameseLanguagePack.realizationHooks.realize(
      en.value.snapshot,
    );
    expect(enFromVi.ok).toBe(true);
    expect(viFromEn.ok).toBe(true);
  });

  it("keeps punctuation and discourse decisions language-specific", () => {
    expect(englishLanguagePack.punctuation.terminal("question")).toBe("?");
    expect(vietnameseLanguagePack.punctuation.terminal("question")).toBe("?");

    expect(englishLanguagePack.discourse.choose("formal")).toMatchObject({
      addresseeForm: "you",
      register: "formal",
    });
    expect(vietnameseLanguagePack.discourse.choose("formal")).toMatchObject({
      addresseeForm: "quý vị",
      politeness: "formal",
    });
  });
});
