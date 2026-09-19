# M8 — Vietnamese Language Pack Gate Evidence

Status: **candidate — predecessor M7 verified; pending deterministic CI**

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

## Gate rule

Do not mark this gate **verified** until:

1. predecessor M7 remains verified;
2. package boundaries pass;
3. strict TypeScript passes;
4. the complete deterministic test suite passes, including all four section-415 cross-lingual directions.

No live Jev request is required for M8.
