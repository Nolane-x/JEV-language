# M6 — Bidirectional English Expansion Gate

Status: **T170–T180 implementation candidate; milestone expansion still partial**

Specification basis: section 413 and bootstrap tasks T170–T180 of the v0.4 master specification.

## T170–T180 implementation map

| Task | Evidence |
| --- | --- |
| T170 richer discourse relation planner | `planSemanticDiscourseRelations()`, `enrichDiscoursePlan()` |
| T171 explanation strategies | `proposeExplanationStrategies()` |
| T172 aggregation | `planSafeClauseAggregation()` |
| T173 paraphrase lattice structures | `ParaphraseLattice`, `enumerateParaphrasePaths()` |
| T174 repetition tracker | `RepetitionTracker` |
| T175 style profile merge | `mergeStyleProfiles()` |
| T176 collocation scoring | `scoreCollocation()` |
| T177 pragmatic decision packs | `pragmaticDiscourseStrategyPack`, `pragmaticDetailLevelPack` |
| T178 audience-aware detail selection | `selectAudienceAwareDetail()` |
| T179 template-leakage evaluator | `evaluateTemplateLeakage()` |
| T180 human-eval export | `createHumanEvalBundle()`, `exportHumanEvalJsonl()` |

## Semantic-safety properties

- discourse relations are derived from JSG cause/condition structure rather than guessed from surface text;
- aggregation candidates are emitted only when clause type, polarity and modality agree;
- every paraphrase choice carries semantic-justification rule IDs;
- lattice enumeration is budget bounded and respects explicit incompatibility constraints;
- style merging cannot alter semantic graph content;
- required content survives audience-detail reduction;
- repetition penalties are secondary signals rather than semantic constraints;
- pragmatic Decision Packs choose only among bounded configured strategies;
- template-leakage metrics are reported independently from semantic-faithfulness metrics.

## Mandatory M6 Definition-of-Done coverage still open

Section 413 requires expansion beyond controlled English with concrete bidirectional evidence for:

- synonyms;
- multiple syntactic frames;
- relative clauses;
- reported speech;
- multi-sentence discourse;
- style-profile effects;
- unknown-term preservation.

Reported attribution already exists in the M5 semantic corpus and style infrastructure exists in this wave, but the remaining phenomena need parse + realization fixtures before M6 can be marked verified. The template-leakage evaluator is now present, but the milestone benchmark must run on those expanded outputs rather than only unit fixtures.

## Conformance

`tests/conformance/m6-discourse-naturalness.conformance.test.ts` covers the T170–T180 infrastructure, including cause/condition planning, semantic-safe aggregation, bounded paraphrase paths, style merge, repetition, explanation strategy generation, audience-detail selection, collocation evidence, Decision Pack quality gates, template leakage, and human-eval export.

## Gate rule

Do not set `last_completed_gate` to M6 until:

1. M5 is merged with final deterministic CI;
2. T170–T180 pass deterministic CI on a clean branch;
3. all section-413 bidirectional English phenomena above have parse/realize semantic-preservation fixtures;
4. the template-leakage benchmark is executed on the expanded held-out corpus with exclusions and failure classes reported.
