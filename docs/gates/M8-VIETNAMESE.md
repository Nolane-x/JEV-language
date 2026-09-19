# M8 — Vietnamese Language Pack Gate Evidence

Status: **verified**

Specification basis: sections 251–259, 415, and tasks T158–T169 of the v0.4 master specification.

## T158–T169 implementation map

| Task | Evidence |
| --- | --- |
| T158 Vietnamese language-pack manifest | `vietnameseLanguagePackManifest` |
| T159 Vietnamese seed lexicon | `createVietnameseSeedLexicon()` |
| T160 Vietnamese tokenization assumptions | `tokenizeVietnamese()` with NFC-normalized Unicode token spans |
| T161 basic Vietnamese clause grammar | `createVietnameseControlledGrammar()` |
| T162 negation/questions | `không` negation and `có … không` question grammar/parser/realizer |
| T163 classifier subset | optional `cái` artifact-classifier parse path + `selectVietnameseClassifier()` |
| T164 aspect markers subset | `đã / đang / sẽ` ↔ completed / ongoing / planned event aspect |
| T165 pronoun/address strategy | `chooseVietnameseAddressStrategy()` |
| T166 Vietnamese realization | `realizeControlledVietnameseCorpus()` reads shared JSG directly |
| T167 Vietnamese parsing | `parseControlledVietnameseCorpus()` builds shared JSG directly |
| T168 shared cross-lingual corpus | 11 English/Vietnamese semantic fixture pairs |
| T169 semantic-equivalence tests | ID-independent `verifyControlledCorpusEquivalence()` in all required M8 directions |

## Common language-pack ABI evidence

Section 251 is implemented by `packages/language-pack-core`.

Both English and Vietnamese expose the same required provider surface:

- manifest;
- tokenizer;
- morphology;
- lexicon;
- grammar;
- parser hooks;
- realization hooks;
- punctuation;
- discourse strategy;
- language conformance manifest.

`tests/conformance/language-pack-abi.conformance.test.ts` verifies provider-language identity and exercises both packs through shared JSG-facing parser/realizer hooks. Language-specific extensions such as Vietnamese classifiers/aspect/address strategy remain outside the universal semantic core.

## Language-neutral architecture

Vietnamese parsing does **not** perform:

```text
Vietnamese → English text → English parser → JSG
```

Instead:

```text
Vietnamese surface
→ Vietnamese controlled frame analysis
→ shared language-neutral semantic-frame builder
→ JSG
```

Realization is independently:

```text
JSG
→ Vietnamese semantic inspection
→ Vietnamese grammar/lexical/aspect/classifier choices
→ Vietnamese surface
```

The shared semantic-frame constructor is language-neutral and accepts source language / actor surface grounding metadata. English and Vietnamese parsers therefore share semantic construction machinery without either language using the other language's surface form.

## Required section-415 directions

`tests/conformance/m8-cross-lingual-equivalence.conformance.test.ts` exercises each shared fixture through:

1. **Vietnamese → JSG**;
2. **JSG → Vietnamese → JSG**;
3. **Vietnamese → JSG → English → JSG**;
4. **English → JSG → Vietnamese → JSG**.

Every comparison uses semantic projection/equivalence, not sentence shape or token overlap.

## Shared semantic corpus

Current bilingual fixtures cover:

- simple positive event;
- explicit negation;
- exact quantity + unit;
- absolute date;
- requirement;
- permission;
- prohibition;
- maximum-cardinality comparison;
- condition;
- causal relation;
- yes/no permission question;
- reported attribution.

## Vietnamese-specific conformance

The M8 tests additionally cover:

- optional `cái` classifier construction mapping to unchanged JSG semantics;
- `đã` → completed;
- `đang` → ongoing;
- `sẽ` → planned;
- NFC normalization/tokenization;
- analytic morphology;
- address/politeness strategy abstraction;
- unsupported free-form Vietnamese returning a structured unsupported result instead of silently translating through English.

## M8 core implementation CI evidence

- PR #23 implementation head: `96c8df08c1e2f116b16ed2878dc3ecac34209fde`;
- GitHub Actions CI run `#116` / run id `35425396241`: `success`;
- package boundaries: pass;
- strict TypeScript: pass;
- full deterministic tests including M8 bilingual corpus: pass;
- merged squash commit: `c436321e1d7dc04bd46d78d1468d45d8f4279396`;
- live Jev requests consumed: `0`.

This proves T158–T169's M8 core implementation. Final M8 verification also requires the Section-251 common language-pack ABI evidence in this follow-up branch.

## Common ABI verification evidence

- PR #24 ABI head: `703b7eefa6bff2e1f1f5fca48de1d23b3b8cc034`;
- GitHub Actions CI run `#121` / run id `35426848545`: `success`;
- package boundaries: pass;
- strict TypeScript: pass;
- complete deterministic test suite: pass;
- English and Vietnamese both satisfy `HumanLanguagePack`;
- ABI identity validation rejects mixed provider languages;
- legacy `parse/realize` aliases remain typed for compatibility while the normative ABI uses parser/realization hooks;
- live Jev requests consumed by the M8 implementation and ABI follow-up: `0`.

## Gate result

All Section-415 M8 directions and the Section-251 common language-pack ABI are now verified. M8 may therefore advance to M9 multilingual semantic equivalence. No live Jev request is required for M8.
