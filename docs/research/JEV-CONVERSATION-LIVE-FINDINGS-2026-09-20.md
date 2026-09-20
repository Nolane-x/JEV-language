# JEV Language live conversation findings — 2026-09-20

Status: observed live evidence, not an end-to-end natural-conversation claim.

## Executive finding

Jev currently looks **promising as a bounded multilingual language/pragmatics judge**.

Two authenticated live evaluations through the verified JEV Language relay have now produced:

- multilingual baseline: **12 / 12** expected judgments;
- harder conversational ranker stress v2: **18 / 18** expected judgments;
- combined: **30 / 30** expected judgments across the two live sets;
- live model observed in both evidence files: `jev-1.13.0`;
- languages represented across the live work: English, Vietnamese, Simplified Chinese, Spanish, Japanese, and Vietnamese-English code-switch;
- credentials were not persisted by the evaluation harness.

This is encouraging, but it does **not** establish that JEV Language can already generate unrestricted natural conversation. Both live evaluations ask Jev to judge or choose among bounded supplied candidates.

## Evidence

### Multilingual live baseline

Source:

`docs/evidence/MULTILINGUAL-LIVE-BASELINE.json`

Observed:

- requests: 12;
- successful: 12;
- expected judgments: 12;
- input tokens: 4,662;
- output tokens: 324;
- mean observed latency: about 229 ms/request;
- languages: en, vi, zh-Hans, es, ja, vi-en.

The baseline checked:

- meaning preservation;
- conversational naturalness preference;
- Vietnamese multi-turn reference;
- Vietnamese-English code-switch.

### Conversation ranker live stress v2

Source:

`docs/evidence/CONVERSATION-RANKER-LIVE-STRESS-v2.json`

Observed:

- requests: 18;
- successful: 18;
- expected judgments: 18;
- input tokens: 7,645;
- output tokens: 612;
- mean observed latency: about 217 ms/request.

Coverage:

- naturalness;
- correction handling;
- social register;
- calibrated uncertainty;
- code-switch;
- unknown-term integrity;
- anti-template preference.

Per-language observed pass counts:

- Vietnamese: 6 / 6;
- English: 4 / 4;
- Simplified Chinese: 2 / 2;
- Japanese: 2 / 2;
- Spanish: 2 / 2;
- Vietnamese-English: 2 / 2.

## Important negative finding: v2 is still too easy

The 18-case v2 result is clean, but **17 / 18** successful decisions reported confidence exactly `1`.

That is a warning sign for evaluation quality, not a reason to claim perfection.

Most v2 pairs deliberately contrast a natural/context-correct reply with a clearly awkward, semantically unsafe, or register-inappropriate alternative. A very strong result on that benchmark demonstrates that Jev can reject obvious bad candidates, but does not yet tell us enough about:

- close paraphrase ranking;
- subtle register distinctions;
- near-ties;
- native-speaker preference;
- option-order sensitivity;
- calibration on ambiguous pairs.

Therefore v2 should be treated as a successful **screening benchmark**, not a final naturalness benchmark.

## v3 decisive experiment

The next live experiment is designed to attack the strongest alternative explanation for the v2 result: that the pairs were simply too obvious.

The v3 protocol uses:

- 10 closer contextual pairs;
- 2 runs per pair;
- A/B order reversed on the second run;
- exactly 20 live requests;
- separate measurement of:
  - preregistered contextual-preference agreement;
  - order invariance;
  - option-A selection rate;
  - confidence saturation;
  - probability margin.

The relevant implementation is:

- `scripts/conversation-ranker-order-symmetry-v3.ts`
- `.github/workflows/conversation-ranker-order-symmetry-v3.yml`

The preregistered preferences are hypotheses, not human ground truth. A disagreement is a research result, not a test-harness failure.

## What is already implemented toward end-to-end natural conversation

The natural-conversation program now has concrete engineering boundaries rather than one monolithic "make it sound natural" goal.

### Response semantic plan

`jl-response-semantic-plan-1` makes these explicit before realization:

- dialogue act;
- required vs optional semantic content;
- target language;
- epistemic stance;
- social relation;
- register and politeness;
- desired answer length;
- reference bindings;
- correction targets;
- code-switch policy;
- opaque-term preservation.

### Verified candidate lattice

The realizer can build a bounded candidate set only from surfaces that already carry semantic-verification evidence.

The lattice:

- rejects unverified candidates;
- rejects language-policy violations;
- rejects opaque-term corruption;
- deduplicates identical surfaces;
- keeps multiple candidate-generation families represented under a hard budget;
- preserves provenance for ranking.

### Conversational surface ranker

The Jev Decision Pack `nlg.conversation.surface-ranker.v1` ranks only candidates supplied by the bounded set.

It is explicitly forbidden from selecting an out-of-set string.

Low-confidence or low-margin outcomes remain ambiguous rather than forcing a fluent answer.

### Anti-template style memory

Recent surfaces, openings, construction ids, and source families can now contribute a bounded repetition penalty before Jev ranking.

This does not reject semantic content. It only helps avoid repeatedly choosing the same style when multiple verified alternatives exist.

### Bounded selection pipeline

The first orchestration slice is:

```text
verified surface drafts
        ↓
candidate lattice
        ↓
Jev-shaped bounded ranking state
        ↓
rank answer
        ↓
confidence / margin gate
        ↓
selected surface OR preserved ambiguity
        ↓
style-memory update only after confident selection
```

## Language-generation frontier

The current native surface language packs are still primarily controlled English and controlled Vietnamese.

The research program is therefore separating two questions:

1. **Can Jev judge conversational language well?**
2. **Can JEV Language itself generate a sufficiently rich set of good candidates?**

The live evidence currently supports question 1 more strongly than question 2.

That makes **candidate recall** the next central metric.

If the generator never proposes the best natural surface, even a perfect ranker cannot select it.

## First conversational microgrammars

### Vietnamese

The first Vietnamese conversational microgrammar is being introduced with conservative rules for:

- explicit social-pronoun hints rather than guessing;
- respectful `Dạ` and final `ạ`;
- casual peer `Ừ` and `nhé`;
- bounded speaker ellipsis;
- Vietnamese-English code-switch;
- exact preservation of opaque technical terms.

Generated variants are proposals only. They require independent semantic evidence before entering the ranking lattice.

### English

The first English conversational microgrammar is being introduced with:

- controlled contractions;
- correction acknowledgement;
- peer acknowledgement;
- compact technical follow-ups;
- exact opaque-term preservation.

Again, transformations are not automatically trusted.

## Research interpretation

The current evidence suggests a viable architecture:

```text
explicit semantics
    +
deterministic/compositional candidate generation
    +
semantic verification
    +
bounded Jev preference judgment
    +
context/register/style memory
```

This is materially different from asking a hidden LLM to generate the answer.

The strongest remaining risks are:

1. **candidate-recall failure** — natural surface never appears in the bounded lattice;
2. **subtle ranker miscalibration** — Jev is excellent on obvious contrasts but weaker on close alternatives;
3. **social/register under-modeling** — especially Vietnamese address systems;
4. **multi-turn style drift** — locally natural replies becoming repetitive or inconsistent over long dialogue;
5. **parser coverage** — generation may become broader faster than semantic round-trip parsing;
6. **human preference gap** — deterministic metrics may not track native-speaker naturalness.

## Next experiments

The evidence-driven order is now:

1. run v3 mirrored subtle-pair evaluation;
2. measure per-pair order invariance and margins;
3. finish Vietnamese conversational microgrammar;
4. finish English conversational microgrammar;
5. build a deterministic candidate-recall benchmark before Jev ranking;
6. calibrate Jev confidence/margin thresholds on subtle pairs;
7. wire language proposal generators into the bounded selection pipeline;
8. generate real M19 blinded stimuli;
9. collect the preregistered human ratings;
10. use observed failure clusters to decide which grammar, discourse, reference, register, or ranking mechanism to improve.

## Claim boundary

The strongest statement supported today is:

> Jev has shown strong live performance as a bounded multilingual meaning/naturalness/pragmatics judge on the current 30 evaluated cases, including an 18-case conversational stress set.

The evidence does **not** yet support:

> JEV Language can converse naturally at unrestricted open-domain chat quality.

That claim remains gated by candidate recall, the harder v3 experiment, multi-turn end-to-end evaluation, and real M19 human ratings.
