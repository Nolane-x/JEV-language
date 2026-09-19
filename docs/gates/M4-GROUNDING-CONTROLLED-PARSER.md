# M4 — Grounding and Controlled Parser Gate Evidence

Status: **implementation candidate — predecessor M3 live gate still open**

Specification basis: sections 409–410 and bootstrap tasks T085–T097 of the v0.4 master specification.

## T085–T097 implementation evidence

| Task | Evidence |
| --- | --- |
| T085 source normalization | `normalizeGroundingSource()` |
| T086 segmentation | `segmentGroundingSource()` |
| T087 token objects | `GroundingToken`, `tokenizeGroundingSource()` |
| T088 language-span tagging | `LanguageSpanTagger`, hint implementation |
| T089 deterministic literal extraction registry | `LiteralExtractionRegistry`, known-literal extractor |
| T090 lexicon provider interface | `GroundingLexiconProvider` |
| T091 syntax forest | `SyntaxForest`, `PackedSyntaxNode` |
| T092 semantic construction rule | `SemanticConstructionRule` |
| T093 parse candidate | `ParseCandidate` |
| T094 ambiguity classification | `classifyAmbiguity()` |
| T095 deterministic ambiguity resolver registry | `AmbiguityResolverRegistry`, deterministic highest-score resolver |
| T096 Jev resolution for one bounded ambiguity | `createJevChoiceAmbiguityResolver()` through JDR Choice |
| T097 JSG commit | `commitParseCandidate()` through graph transaction + validator |

## Controlled semantic corpus

`parseControlledEnglishCorpus()` uses a small typed semantic-frame parser. Surface rules identify a supported controlled frame; one shared constructor emits JSG rather than storing complete graph templates.

The conformance corpus covers the M4 required phenomena:

- entities;
- simple events;
- explicit negation;
- exact quantities with unit;
- absolute time;
- conditions;
- causal relations with direction;
- requirements;
- permissions;
- prohibitions;
- comparisons;
- questions.

Unsupported free-form inputs return `GROUNDING_CONTROLLED_CORPUS_UNSUPPORTED` rather than fabricated semantics.

## Ambiguity behavior

`tests/conformance/m4-recorded-ambiguity.conformance.test.ts` proves:

1. a bounded lexical ambiguity is sent as stable candidate IDs through JDR Choice;
2. the recorded provider can select one legal candidate;
3. parser resolution records the resolver identity;
4. low confidence returns no selection, causing the ambiguity registry to preserve alternatives;
5. the path consumes no live network/model call in deterministic CI.

## Existing grounding evidence

`tests/conformance/m4-grounding.conformance.test.ts` already proves:

- CRLF/NFC normalization with source-span reversibility;
- segmentation/tokenization/language tagging/literal extraction;
- unknown lexical material is retained;
- syntax-forest reference validation;
- unresolved deterministic ambiguity is preserved;
- a semantic construction candidate commits into JSG through semantic validation.

## Milestone-order rule

The implementation for T085–T097 may be merged once deterministic CI passes, but M4 MUST NOT become `last_completed_gate` while the predecessor M3 live-smoke requirement remains open. The active milestone therefore remains M3 until that single explicitly authorized live test is recorded.
