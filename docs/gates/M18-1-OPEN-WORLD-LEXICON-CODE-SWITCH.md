# M18.1 — Open-world Lexicon and Code-switch Gate

Status: **verified**

Specification basis:

- M18 focus areas: unknown terms, code-switching, new domain concepts, provisional ontology, larger lexicon, grammar/discourse/paraphrase expansion;
- Section 209 unknown lexical item handling;
- Sections 717–719 code-switching, mixed-language realization and borrowing policy;
- tasks T098–T106 lexical/morphology foundation.

This gate intentionally covers only the first M18 wave. It does **not** mark M18 complete.

## Section-209 resolution order

The shared resolver exposes evidence-bearing alternatives in this order:

1. primary-language exact lexicon match;
2. exact named/technical opaque classification;
3. morphology → known lemma;
4. productive compound decomposition;
5. foreign/code-switch lexicons;
6. provisional lexical-sense proposal;
7. exact opaque preservation.

Unknown tokens are preserved exactly even when no semantic classification is available.

## T098–T106 evidence

| Task range | Evidence |
| --- | --- |
| Lexeme / LexicalSense schemas | `lexicon-core` runtime validation and conformance |
| valency frames | English delete transitive frame |
| collocation rules | registered delete/file preference |
| language-neutral index | surface/concept indexes, deterministic lookup |
| English seed lexicon | `createEnglishSeedLexicon()` |
| English morphology subset | rule + lexicon analysis/realization |
| unknown-token preservation | `preserveUnknownLexicalItem()` + open-world resolver |
| multiword expressions | registered/matched `at most`, `more than`, Vietnamese modality MWEs |
| lexicon conformance | `m18-open-world-lexicon.conformance.test.ts` |

## Code-switch architecture

`OpenWorldLexicalResolver` cooperates across installed language-pack ABI views rather than importing language-private modules.

For each token it can expose:

- candidate language;
- evidence stage;
- confidence;
- exact lexical matches or morphology evidence;
- provisional/opaque fallback.

`analyzeMixedLanguageTokens()` groups adjacent selected token hypotheses into language segments while leaving shared semantic representation language-neutral.

## Unknown and new-domain terms

Unknown technical/named surfaces are preserved byte-for-byte/NFC surface form and are never fabricated into established concepts.

A provisional lexical proposal may carry:

- POS candidates;
- contextual parent-concept candidates;
- confidence;
- evidence.

The proposal does **not** mutate the ontology automatically. A later ontology/domain decision must explicitly accept it.

## Borrowing policy

Missing target-language lexical coverage does not silently trigger a foreign word.

`chooseBorrowingStrategy()` distinguishes:

- established target lexeme;
- explicit source borrowing;
- exact technical-symbol retention;
- opaque preservation;
- unsupported.

Borrowing requires explicit permission.

## Conformance cases

The M18.1 conformance suite checks:

- lexical schemas and validation;
- valency/collocation/index evidence;
- English morphology;
- unknown exact preservation;
- MWE matching;
- primary exact lookup;
- foreign lexical lookup;
- compound alternatives;
- provisional unknown proposal;
- EN/VI token-level code-switch segmentation;
- no accidental mixed-language output policy;
- language-provider identity mismatch rejection.

## Non-claims

This wave does not claim:

- M18 completion;
- full T107–T120 grammar/parser coverage;
- arbitrary open-domain sentence parsing;
- automatic ontology learning;
- unrestricted mixed-language realization;
- M19 natural-conversation quality.

## Gate rule

Verified evidence:

- implementation head: `47ddfce5501b1f8ddb9952dc695b32a1f2234f36`
- GitHub Actions CI: run `#207` / run id `35441576291`
- result: `success`
- package boundaries, strict TypeScript and the complete deterministic suite passed
- live Jev requests consumed by this wave: `0`

T098–T106 are therefore verified. M18 remains active; M18.2 proceeds with T107–T120 grammar/parser expansion.
