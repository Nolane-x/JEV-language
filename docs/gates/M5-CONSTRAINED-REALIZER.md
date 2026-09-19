# M5 — Constrained Realizer and Controlled Round-Trip Gate

Status: **implementation candidate — predecessor M3 live gate still open**

Specification basis: sections 411–412 and bootstrap tasks T121–T144 of the v0.4 master specification.

## T121–T133 implementation evidence

| Task | Evidence |
| --- | --- |
| T121 DiscoursePlan | `packages/discourse-ir/src/index.ts` |
| T122 ClausePlan | `packages/discourse-ir/src/index.ts` |
| T123 content selection | `selectContent()` |
| T124 discourse ordering | `orderDiscourse()` |
| T125 lexical candidates | `generateLexicalCandidates()` |
| T126 role-to-syntax mapping | `mapRolesToSyntax()` |
| T127 feature propagation | `propagateMorphFeatures()` |
| T128 English morphology realization | `EnglishMorphologyProvider` + `realizeLexicalCandidate()` |
| T129 punctuation/formatting | `formatControlledSentence()` |
| T130 basic reference generation | `generateBasicReference()` |
| T131 grammar verifier | existing `GrammarVerifierAdapter` |
| T132 semantic source maps | `ControlledEnglishRealization.sourceMap` |
| T133 fallback ladder | `runRealizationFallback()` |

The controlled corpus artifact also carries the `DiscoursePlan` and generated `ClausePlan[]`, so these are part of the realization path rather than detached schemas.

## M5 semantic coverage

`realizeControlledEnglishCorpusArtifact()` deterministically realizes the controlled semantic structures introduced by M4:

- positive and negative events;
- exact quantity/unit values;
- absolute dates;
- requirements;
- permissions;
- prohibitions;
- maximum-cardinality comparisons;
- conditions;
- causal relations;
- yes/no questions;
- reported-source attribution.

Unsupported graphs return `REALIZE_CONTROLLED_CORPUS_UNSUPPORTED` rather than fabricated language.

## T134–T144 round-trip evidence

| Task | Evidence |
| --- | --- |
| T134 controlled JSG corpus | M4 controlled corpus fixtures |
| T135 JSG → English golden realization | M5 corpus realization tests |
| T136 English → JSG fixtures | M4 parser corpus |
| T137 semantic projection comparator | `projectControlledCorpusSemantics()` |
| T138 round-trip verifier | `verifyControlledCorpusEquivalence()` |
| T139 negation | negative-event/prohibition/maximum-cardinality fixtures |
| T140 modality | requirement/permission/prohibition fixtures |
| T141 quantity/unit | exact/at-most quantity fixtures |
| T142 attribution | reported proposition with explicit attribution ref |
| T143 temporal | absolute-date fixture |
| T144 conditional | explicit condition fixture |

## Explicit round-trip target

For the current controlled corpus the gate target is:

`semantic_round_trip_rate = 100%`

over the 11 canonical fixtures in `tests/conformance/m5-controlled-roundtrip.conformance.test.ts`.

Equivalence is measured with an ID-independent canonical semantic projection. Passing requires preservation of predicate/action semantics, polarity, modality/constraint kind, exact quantity/unit/comparator, temporal value, condition/causal structure, question status, and source attribution where present.

This 100% figure applies **only** to the explicitly controlled corpus. It is not a claim about unrestricted English.

## Additional conformance

`tests/conformance/m5-realizer-planning.conformance.test.ts` covers:

- concept-driven lexical candidate generation;
- morphology realization;
- deterministic role-to-syntax mapping;
- agreement/feature propagation and conflict rejection;
- full-reference versus pronoun selection;
- clause-type punctuation;
- explicit fallback ordering and failed-stage evidence.

## Milestone-order rule

The deterministic implementation may be merged after CI succeeds. M5 MUST NOT become `last_completed_gate` while M3's required one-request live smoke remains open. M2 therefore remains the last fully completed milestone until that predecessor gate is closed.
