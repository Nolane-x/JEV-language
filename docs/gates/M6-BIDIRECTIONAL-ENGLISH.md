# M6 — Bidirectional English Expansion Gate

Status: **verified**

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

## Section-413 bidirectional coverage

| Required phenomenon | Parse/realize evidence |
| --- | --- |
| synonyms | delete/remove alternatives round-trip through the same JSG |
| multiple syntactic frames | active/passive variants with semantic-equivalence checks |
| paraphrase lattice | bounded paths with semantic-justification rule IDs |
| aggregation | safety-gated clause aggregation |
| relative clauses | dual-event relative-clause parser + realizer + semantic equivalence |
| reported speech | attribution-preserving reported-speech variants |
| multi-sentence discourse | pronoun-linked two-sentence parser + realizer + semantic equivalence |
| style profiles | style ranking changes preferred legal alternative without altering semantics |
| unknown-term preservation | exact project-specific actor names retained by source span and reproduced only from valid grounding sources |

The relative-clause, multi-sentence and unknown-name fixtures live in
`tests/conformance/m6-expanded-documents.conformance.test.ts`.
Lexical/syntactic/style variants live in
`tests/conformance/m6-bidirectional-variants.conformance.test.ts`.

## Semantic-safety properties

- discourse relations are derived from JSG cause/condition structure rather than guessed from surface text;
- aggregation candidates are emitted only when clause type, polarity and modality agree;
- every paraphrase choice carries semantic-justification rule IDs;
- lattice enumeration is budget bounded and respects explicit incompatibility constraints;
- style merging cannot alter semantic graph content;
- required content survives audience-detail reduction;
- repetition penalties are secondary signals rather than semantic constraints;
- pragmatic Decision Packs choose only among bounded configured strategies;
- unknown names are not regenerated from memory: missing source material fails explicitly and stale spans are rejected;
- template-leakage metrics are reported independently from semantic-faithfulness metrics.

## Held-out template-leakage benchmark

GitHub Actions CI run **#97** (run id `35422408197`) executed the expanded held-out benchmark on PR #20 head
`f72bbd16aff49119f4ad8b87348112106a2f7c75`.

Observed report:

```json
{
  "sampleCount": 14,
  "knownTemplateMatches": 0,
  "knownStructuralTemplateMatches": 0,
  "duplicateSurfaces": 0,
  "structuralTemplateRepeats": 0,
  "repeatedOpenings": 0,
  "knownTemplateRate": 0,
  "knownStructuralTemplateRate": 0,
  "duplicateSurfaceRate": 0,
  "structuralTemplateReuseRate": 0,
  "repeatedOpeningRate": 0,
  "passed": true
}
```

Pre-registered thresholds:

```json
{
  "maxKnownTemplateRate": 0,
  "maxKnownStructuralTemplateRate": 0,
  "maxDuplicateSurfaceRate": 0,
  "maxStructuralTemplateReuseRate": 0.1,
  "maxRepeatedOpeningRate": 0.25
}
```

Corpus metadata:

- 11 training templates;
- 14 held-out samples;
- explicit exclusions: unrestricted open-domain English, dialogue beyond the expanded fixture subset, and semantic domains outside the current controlled delete-event family.

The same CI job passed **31/31 test files and 190/190 tests**.

## Verification evidence

- M5 predecessor gate was already verified and merged.
- PR #20 deterministic implementation head: `f72bbd16aff49119f4ad8b87348112106a2f7c75`.
- GitHub Actions CI run #97: `success`.
- merged squash commit: `31e90135c6c042051357838cbfe95307fc562ff6`.
- live Jev requests consumed by the M6 PR: `0`.

## Scope boundary

This verifies **M6 as defined by section 413 for the implemented bidirectional English test domain**. It does not claim unrestricted open-domain English or natural-conversation parity. Those remain later open-world/research milestones.

The implementation-state ledger may advance to **M7 dialogue semantics**.
