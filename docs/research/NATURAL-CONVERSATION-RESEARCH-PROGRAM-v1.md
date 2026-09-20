# JEV Language — Natural Conversation Research Program v1

Status: research program active  
Scope: make JEV Language increasingly natural in real multi-turn conversation while preserving the project's zero-hidden-generative-LLM invariant.

## 1. Starting fact

Jev is a structured evaluation model. Its native output space is typed Noul / Choice / Score decisions, not unrestricted strings. Therefore JEV Language must not pretend that Jev itself is a chat generator.

The research problem is:

> Can bounded Jev judgments control a compositional semantic + linguistic substrate strongly enough that the overall system produces natural, context-aware, multilingual conversation without using a hidden generative LLM?

Official Jev references:

- https://typesafe.ai/blog/introducing-system-one-models-and-jev
- https://developers.cloudflare.com/ai/models/typesafe/jev/

## 2. Evidence already observed

The live multilingual baseline frozen at:

`docs/evidence/MULTILINGUAL-LIVE-BASELINE.json`

used exactly 12 authenticated Jev requests through the verified relay and observed:

- 12 / 12 successful requests;
- 12 / 12 expected judgments;
- English, Vietnamese, Simplified Chinese, Spanish, Japanese, and Vietnamese-English code-switch probes;
- live model: `jev-1.13.0`;
- 4,662 input tokens and 324 output tokens;
- no persisted credential.

This is encouraging evidence that Jev can **judge** meaning preservation and conversational naturalness in several languages.

It is **not** evidence that JEV Language can already generate unrestricted natural conversation. The current live benchmark is discriminative: the natural candidate already exists and Jev chooses or evaluates it.

Current native surface packs are English and Vietnamese. Chinese, Spanish, and Japanese live judgments do not imply complete JEV Language generation packs for those languages.

## 3. Core architecture hypothesis

Natural conversation should be built as a verified search-and-selection pipeline rather than token generation.

```text
user surface
    ↓
language pack parser
    ↓
JSG + dialogue state + open-world values
    ↓
ambiguity/reference/pragmatic bounded Jev decisions
    ↓
response semantic plan
    ↓
discourse + pragmatic plan
    ↓
surface candidate lattice
    ↓
hard semantic-preservation verifiers
    ↓
Jev conversational surface ranker
    ↓
confidence / margin gate
    ↓
selected natural surface
    ↓
dialogue-state update + replay evidence
```

The crucial separation is:

1. **Meaning** is represented explicitly.
2. **Candidate generation** is deterministic / grammar-based / lexicon-based / compositional.
3. **Semantic verification** happens before naturalness ranking.
4. **Jev ranks bounded candidates**; it does not invent text.
5. Low-confidence ranking preserves ambiguity or falls back safely instead of forcing a fluent but semantically unsafe answer.

## 4. Research hypotheses

### H1 — Candidate-lattice naturalness

A sufficiently broad semantics-preserving paraphrase lattice can contain native-feeling surfaces often enough for Jev to select one.

Falsifier: candidate recall remains low even when ranking accuracy is high.

Primary metric: human-rated best-candidate recall.

### H2 — Context-aware register

Explicit social relation, audience, discourse role, current topic, prior wording, and locale improve register/address selection.

Falsifier: human style-mismatch rate does not improve versus context-free realization.

Primary metrics: register accuracy, address-form accuracy, style mismatch.

### H3 — Anti-template memory

Tracking recently used constructions, discourse markers, openings, lexical heads, and sentence rhythms can reduce repetitive/template-like replies without semantic drift.

Falsifier: diversity rises but semantic error or awkwardness rises at the same time.

Primary metrics: blinded template-detection rate, lexical/construction repetition, human naturalness.

### H4 — Jev ranking generalizes across language varieties

Jev can rank bounded naturalness candidates in languages and code-switch varieties even when the surface realizer is language-specific.

Falsifier: ranking accuracy collapses on held-out varieties or subtle social/pragmatic distinctions.

Primary metric: held-out pairwise ranking accuracy with confidence calibration.

### H5 — Naturalness can improve without hidden generation

Iterative improvements to grammar, lexicon, discourse rules, paraphrase candidates, and ranker calibration can close most of the gap to strong chat systems without an external string generator.

Falsifier: M19 human ratings plateau far below the preregistered target despite high candidate budgets and strong ranking.

Primary metric: blinded end-to-end naturalness.

## 5. New conversational surface-ranking boundary

This research wave introduces:

- `realizer-core.conversation-candidate-set.v1`
- `nlg.conversation.surface-ranker.v1`

A candidate is eligible for Jev ranking only when:

- its id is in the bounded candidate set;
- its surface is non-empty and unique;
- its target language/register are explicit;
- semantic preservation is already verified;
- evidence references are attached.

The ranker is forbidden from selecting an unverified surface merely because it sounds fluent.

Confidence and probability margin are part of the acceptance gate. A low-confidence / low-margin result remains ambiguous.

## 6. Conversation quality model

Naturalness is not one scalar. Every end-to-end run should capture at least:

| Dimension | What is measured |
|---|---|
| semantic fidelity | truth conditions, polarity, modality, quantity, condition, cause, attribution |
| reference | entity/pronoun/ellipsis resolution across turns |
| dialogue act | answer, correction, clarification, refusal, acknowledgement, request, continuation |
| coherence | relation to prior turns and active topic |
| register | formal/casual/social-address fit |
| idiomaticity | native phrasing rather than translationese |
| economy | unnecessary verbosity and repeated framing |
| variation | construction/lexical diversity without semantic drift |
| correction handling | user correction supersedes prior mistaken state |
| uncertainty | calibrated hedging instead of fabricated certainty |
| unknown-term integrity | exact preservation of project names, identifiers, opaque terms |
| code-switch quality | language switching that follows community norms |
| latency | end-to-end time and decision-call count |
| cost | Jev request/input-token budget |

## 7. Research ladder

### R0 — Typed judgment sanity

Already observed: multilingual meaning/naturalness discrimination works on the current 12-case live baseline.

Do not promote this to a conversational-generation claim.

### R1 — Hard naturalness discrimination

Build a harder held-out benchmark with subtle candidates:

- both candidates grammatical;
- only one matches the conversation;
- social-register differences;
- correction/repair;
- hedging under uncertainty;
- pronoun/reference;
- natural discourse markers;
- native code-switch;
- unknown-term preservation;
- anti-translationese.

Languages in the first stress wave:

- Vietnamese;
- English;
- Simplified Chinese;
- Japanese;
- Spanish;
- Vietnamese-English code-switch.

This stage tests Jev as the **ranker**.

### R2 — Candidate recall

For every semantic response plan, generate a bounded lattice of 8–32 candidates.

Measure:

- whether at least one candidate is human-acceptable;
- whether the human-best candidate exists;
- how candidate recall changes with budget;
- which generation dimensions create useful diversity.

If the candidate pool is bad, ranking cannot rescue it.

### R3 — Verified rank-and-select

Run semantic verification on every candidate first.

Only verified candidates are passed to Jev.

Compare:

- deterministic first candidate;
- heuristic scorer;
- Jev ranker;
- oracle human ranking.

This isolates ranking value from generation value.

### R4 — Multi-turn dialogue policy

Upgrade the response planner from isolated sentences to dialogue acts.

Required scenarios:

- direct answer;
- follow-up;
- clarification;
- acknowledgement;
- correction acceptance;
- topic shift;
- topic return;
- reference to old entity;
- disagreement;
- partial certainty;
- user asks for shorter / longer answer;
- casual chat;
- technical chat.

### R5 — Vietnamese natural conversation

Vietnamese should be treated as a first-class research track, not a translation of English.

Priorities:

- pronoun/address system: mình/tôi/em/anh/chị/bạn/thầy/cô etc.;
- omitted subjects when natural;
- particles and softeners: nhé/nhỉ/ạ/đấy/đâu/ừ/ờ, only when licensed by context;
- aspect particles: đã/đang/sẽ/vừa/mới;
- topic-comment structures;
- classifier use;
- natural ellipsis;
- code-switch norms in developer/technical chat;
- formal ↔ peer ↔ intimate register;
- avoidance of literal English discourse structure.

Every rule must have negative fixtures showing when **not** to use it.

### R6 — English natural conversation

Priorities:

- contraction policy;
- discourse markers;
- hedging calibrated to uncertainty;
- pronoun/reference economy;
- active/passive choice;
- concise technical register;
- avoidance of canned openings;
- correction/acknowledgement forms;
- sentence aggregation and controlled fragments.

### R7 — More language packs

Add real surface packs only when parser/realizer evidence exists.

Proposed order is evidence-driven, not a claim of language importance:

1. Simplified Chinese;
2. Spanish;
3. Japanese.

A live Jev judgment in a language is not enough to mark that language pack as implemented.

### R8 — Blinded human M19 closure

The existing M19 protocol remains the authority for end-to-end naturalness.

No synthetic score closes M19.

At least two pseudonymous human ratings per blinded stimulus are required by the current manifest.

## 8. Hard stress benchmark v2

The next live Jev benchmark should use a fixed request budget and freeze sanitized evidence.

It must distinguish:

- obvious naturalness from subtle naturalness;
- semantic equivalence from stylistic preference;
- native code-switch from malformed hybrid text;
- polite register from overformal translationese;
- confidence from forced certainty.

A passing stress benchmark means only that Jev is a promising **evaluator/ranker**.

It does not mean the generator is solved.

## 9. End-to-end candidate-generation experiments

For a fixed semantic graph G:

1. generate candidate set C;
2. reject every candidate that fails G → surface → G' preservation;
3. measure candidate recall against blinded humans;
4. rank survivors with Jev;
5. measure ranker regret against human preference;
6. update generation rules separately from ranker calibration.

Required ablations:

- no Jev ranking;
- no repetition memory;
- no register context;
- no collocation scoring;
- no discourse planning;
- no reference-form variation;
- no code-switch policy;
- candidate budget 2 / 4 / 8 / 16 / 32.

This makes it possible to learn which mechanism actually causes improvement.

## 10. Research targets

These are **targets**, not current claims.

For an end-to-end blinded evaluation:

- semantic accuracy mean: >= 4.8 / 5;
- multi-turn coherence mean: >= 4.7 / 5;
- naturalness mean: >= 4.5 / 5;
- template detection: <= 5%;
- semantic critical-error rate: <= 0.5%;
- reference/correction critical-error rate: <= 1%;
- unknown-term corruption: 0%;
- candidate recall of at least one acceptable surface: >= 98%;
- Jev pairwise ranker accuracy on held-out subtle pairs: >= 90%;
- no hidden generative-model calls.

Targets must be revised only before observing the corresponding held-out test set.

## 11. Failure taxonomy expansion

In addition to the existing M19 categories, experiments should internally distinguish:

- candidate-recall failure;
- Jev misranking;
- low-margin tie;
- semantic verifier false negative;
- semantic verifier false positive;
- register mismatch;
- address-form mismatch;
- translationese;
- over-hedging;
- under-hedging;
- discourse-marker overuse;
- canned opening;
- lexical repetition;
- syntactic repetition;
- unnatural ellipsis;
- missing ellipsis;
- code-switch misuse;
- unknown-term mutation;
- topic drift;
- stale-reference use.

The final M19 report keeps the preregistered public taxonomy, while internal diagnostics may be more granular.

## 12. Implementation sequence

### NC-01 — Candidate ABI
Implemented in this wave.

### NC-02 — Conversational Jev ranker Decision Pack
Implemented in this wave.

### NC-03 — Hard multilingual live ranker benchmark
Next executable experiment.

### NC-04 — Response Semantic Plan
Create a typed response plan containing:

- dialogue act;
- required propositions;
- optional propositions;
- epistemic stance;
- requested action;
- target language;
- social relation;
- register;
- desired length;
- active topic;
- reference bindings.

### NC-05 — Candidate lattice expansion
Connect existing:

- paraphrase lattice;
- discourse strategy;
- detail-level pack;
- collocation score;
- reference form;
- information structure;
- language-specific morphology and grammar.

### NC-06 — Semantic-preservation gate
Every candidate must carry verifier evidence before ranking.

### NC-07 — Repetition / template memory
Add a rolling surface-style state independent of semantic dialogue state.

### NC-08 — Vietnamese conversational microgrammar
Build and test Vietnamese-specific address, particles, ellipsis, topic-comment, and code-switch rules.

### NC-09 — English conversational microgrammar
Build contractions, hedging, fragments, discourse markers, and technical-chat style.

### NC-10 — Candidate-recall benchmark
Measure generation before ranking.

### NC-11 — Jev ranker calibration
Calibrate confidence/margin by language, register, and benchmark family.

### NC-12 — End-to-end multi-turn generator
Wire parse → semantic plan → candidate lattice → verification → rank → dialogue update.

### NC-13 — M19 stimulus production
Freeze blinded outputs for both study arms without identity leakage.

### NC-14 — Human study
Collect real ratings; negative results remain visible.

### NC-15 — Error-driven iteration
Improve the rule/lattice/lexicon mechanism responsible for each observed failure and rerun held-out evaluation.

## 13. Stop conditions

Do not claim "natural conversation solved" when any of these is true:

- ranker benchmark is strong but candidate recall is weak;
- deterministic round-trip passes but human naturalness is poor;
- only English works;
- Vietnamese is produced through English-shaped translation;
- multi-turn correction/reference failures remain systematic;
- hidden LLM/string-generation service is introduced;
- M19 lacks real human ratings;
- held-out performance is materially below the preregistered targets.

## 14. Immediate frontier

The immediate research sequence is:

1. finish and production-verify the BYOK relay path;
2. run hard multilingual Jev ranker stress v2;
3. implement Response Semantic Plan;
4. connect candidate lattice + semantic verifier + conversational ranker;
5. build Vietnamese conversational microgrammar first;
6. measure candidate recall;
7. generate real M19 blinded stimuli;
8. collect human ratings;
9. iterate from observed failure clusters.

This is the shortest evidence-driven route from the current structured Jev capability to genuinely natural conversation without changing the project's core premise.
