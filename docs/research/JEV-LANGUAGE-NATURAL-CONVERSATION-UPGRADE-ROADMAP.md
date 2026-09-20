# JEV Language Natural Conversation Upgrade Roadmap

Status: **evidence-driven research/engineering plan**

Baseline evidence: `docs/evidence/MULTILINGUAL-LIVE-BASELINE.json`  
Observed: 2026-09-20  
Raw JEV model: `jev-1.13.0`

## 1. Why this roadmap exists

JEV itself is not being treated as a free-form next-token generator. JEV Language exists to turn typed judgments, semantic structures, dialogue state, and verified transformations into human language without hiding a general LLM behind the system.

The multilingual live baseline changes the engineering priority.

The baseline used the production Cloudflare relay and the existing secret-backed TypeSafe path. It consumed exactly 12 live requests with no retry loop and tested:

- English;
- Vietnamese;
- Simplified Chinese;
- Spanish;
- Japanese;
- Vietnamese-English developer code-switch.

All 12 requests completed successfully and all 12 benchmark expectations passed. The total observed usage was 4,662 input tokens and 324 output tokens. This is encouraging evidence that raw JEV can judge a small multilingual set covering meaning preservation, naturalness preference, Vietnamese reference resolution, and code-switch naturalness.

It is **not** evidence that JEV Language can already converse fluently in all of these languages.

The current surface layer has real language packs only for English and Vietnamese. Chinese, Spanish, and Japanese were judged by raw JEV in the live baseline, but JEV Language cannot yet independently parse/realize broad conversation in them.

## 2. What the baseline actually says

### 2.1 Raw JEV multilingual judgment is promising

Observed live results:

| Probe | Result |
|---|---|
| English meaning preservation | Noul 0.97 |
| English naturalness choice | expected natural option selected |
| Vietnamese meaning preservation | Noul 0.97 |
| Vietnamese naturalness choice | expected natural option selected, confidence 0.99 |
| Chinese meaning preservation | Noul 0.90 |
| Chinese naturalness choice | expected natural option selected |
| Spanish meaning preservation | Noul 0.97 |
| Spanish naturalness choice | expected natural option selected, confidence 0.99 |
| Japanese meaning preservation | Noul 0.87 |
| Japanese naturalness choice | expected natural option selected |
| Vietnamese multi-turn reference | Noul 0.88 |
| Vietnamese-English code-switch naturalness | expected natural option selected, confidence 0.80 |

These are small, deliberately clear probes. They show that JEV is useful as a multilingual **judge/ranker**. They do not establish open-domain comprehension, long-context robustness, slang mastery, or native-level style.

### 2.2 JEV Language surface generation is the main bottleneck

The deterministic English/Vietnamese surface probes currently produce semantically correct but narrow outputs, for example:

- `The service deletes exactly 3 files.`
- `Dịch vụ xóa đúng 3 tệp.`
- `Theo dịch vụ, dịch vụ xóa đúng 3 tệp.`

The last example exposes a representative problem: semantic preservation is good, but discourse compression and referential style are weak. A more natural Vietnamese surface may prefer a pronoun, ellipsis, a changed information structure, or a different reporting construction depending on context.

The existing realizer is therefore closer to a **controlled semantic renderer** than a native-quality conversational speaker.

## 3. Root-cause diagnosis

The next quality ceiling will not be broken by adding more templates.

The current limitations are structural:

1. **Surface packs are sparse.** English and Vietnamese exist; Chinese, Spanish, Japanese do not.
2. **Lexical choice is narrow.** One semantic predicate often maps to too few idiomatic alternatives.
3. **Discourse planning is shallow.** Repetition, topic continuity, pronouns, ellipsis, and information structure are not optimized strongly enough for natural conversation.
4. **Register is under-modeled.** Vietnamese needs explicit control over pronouns, relationship, age/status, formality, friendliness, and domain-specific code-switch.
5. **Candidate diversity is too small.** A verifier cannot choose a better sentence if the realizer generates only one surface.
6. **Naturalness ranking is not yet a first-class JEV task.** The live baseline demonstrates that JEV can distinguish good and awkward options; the engine should exploit that systematically.
7. **Conversation response renderers are not language-neutral.** Some browser-facing yes/no, choice, and coverage messages are currently English-coded rather than produced through the target language pack.
8. **Human evaluation is not yet closed.** M19 still requires real blinded ratings.

## 4. Target architecture: Semantic-to-Surface Search, not template expansion

The target pipeline is:

```text
User input
  -> language detection + code-switch segmentation
  -> language-specific parser
  -> shared JSG / dialogue state / provenance
  -> response intent + discourse plan
  -> semantic response graph
  -> language-specific candidate lattice
  -> morphology + syntax + information-structure realization
  -> semantic equivalence verifier
  -> JEV naturalness / register / coherence ranking
  -> deterministic policy filters
  -> final surface
  -> round-trip / loss / provenance evidence
```

JEV remains the decision/ranking engine. It does not need to emit arbitrary strings.

The key change is that JEV Language must generate a **lattice of compositional, semantically equivalent surface candidates**, then let verified constraints plus JEV ranking choose among them.

This avoids two bad extremes:

- a single rigid template per meaning;
- a hidden free-form LLM generator.

## 5. New core abstractions

### 5.1 ConversationalIntent

Add a language-neutral intent frame above raw sentence realization:

- inform;
- acknowledge;
- confirm;
- deny;
- clarify;
- ask;
- repair;
- correct;
- suggest;
- warn;
- reassure;
- summarize;
- compare;
- explain;
- transition-topic;
- resume-topic;
- defer;
- refuse-with-reason.

Each intent carries semantic content, confidence, evidence/provenance, and dialogue obligations.

### 5.2 DiscoursePlan

A `DiscoursePlan` controls:

- what is new vs given information;
- topic/focus;
- sentence ordering;
- repetition avoidance;
- anaphora eligibility;
- ellipsis eligibility;
- rhetorical relation;
- explicitness level;
- response length budget;
- answer-first vs explanation-first;
- whether uncertainty must be surfaced.

### 5.3 RegisterProfile

A `RegisterProfile` must be explicit and serializable.

Shared dimensions:

- formal / neutral / casual;
- concise / normal / explanatory;
- polite / direct;
- technical / general;
- region / locale;
- domain;
- code-switch policy.

Vietnamese-specific dimensions must include:

- speaker-addressee relationship;
- age/status relation;
- pronoun pair;
- honorific/politeness particles;
- preferred first-person form;
- preferred second-person form;
- whether subject omission is acceptable;
- borrowed technical vocabulary policy.

No Vietnamese pronoun should be selected only from grammatical person.

### 5.4 SurfaceCandidate

Every generated candidate should carry:

- surface text;
- language tag;
- semantic source digest;
- grammar derivation;
- lexical-choice provenance;
- discourse operations used;
- register features;
- round-trip result;
- semantic-loss diagnostics;
- naturalness-ranking evidence;
- safety/policy diagnostics.

This makes naturalness optimization inspectable rather than magical.

## 6. Candidate lattice generation

For one semantic response, generate candidates by independent controlled transformations:

### Lexical alternatives

Examples:

- `kiểm tra` / `xem lại` / `rà soát`;
- `chưa thấy lỗi` / `chưa phát hiện lỗi`;
- `delete` / `remove` when semantic domain permits;
- technical borrowed term vs localized equivalent.

Lexical alternatives must remain sense-bound. Synonym lists alone are insufficient.

### Syntactic alternations

Examples:

- active/passive where natural;
- subject realization vs omission;
- reporting-clause alternation;
- subordinate vs coordinate structure;
- relative clause vs separate sentence;
- nominal vs verbal realization;
- condition-first vs consequence-first.

### Discourse alternations

Examples:

- repeat noun vs pronoun;
- pronoun vs zero anaphora;
- one sentence vs two;
- explicit connective vs adjacency;
- answer-only vs answer + rationale;
- topic resumption markers.

### Register alternations

Examples for Vietnamese:

- `Mình kiểm tra rồi...`
- `Tôi đã kiểm tra...`
- `Em kiểm tra rồi ạ...`

These cannot be mixed blindly. Candidate generation must be conditioned on a register/social relation profile.

## 7. JEV as the naturalness ranker

The live baseline showed a strong initial ability to select the more natural candidate in all tested languages.

Use that capability through bounded ranking.

### 7.1 Pairwise tournament

Do not send 30 options in one decision.

1. deterministic filters remove semantically invalid candidates;
2. cheap heuristic scoring reduces the lattice;
3. JEV performs pairwise or small-choice ranking;
4. top candidates enter a final coherence/register decision;
5. verifier rechecks the selected surface.

### 7.2 Separate ranking dimensions

Never ask one vague question such as "which is best?"

Use independent typed judgments for:

- semantic fidelity;
- grammatical acceptability;
- naturalness;
- register match;
- discourse coherence;
- repetition;
- ambiguity;
- code-switch appropriateness;
- concision;
- cultural/locale appropriateness.

The final scorer can apply policy weights while preserving each judgment separately.

### 7.3 Abstention

If no candidate clears the semantic floor, the system must regenerate/replan or expose a bounded limitation. JEV ranking must never rescue a candidate that the semantic verifier rejects.

## 8. Deep Vietnamese upgrade

Vietnamese should remain the first deep-quality language because it exposes important phenomena that the current controlled pack does not model strongly enough.

### VI-1: social reference system

Implement explicit social-deixis/pronoun modeling:

- tôi, mình, tớ, tao, em, anh, chị, cô, chú, bác, con, cháu, bạn, quý khách, etc.;
- symmetric and asymmetric address pairs;
- kinship-as-pronoun behavior;
- unknown-relationship safe defaults;
- role-conditioned address;
- pronoun persistence across turns;
- correction when relationship becomes known.

### VI-2: zero anaphora and repetition control

Vietnamese often omits recoverable subjects/objects where English repeats them. Add:

- omission eligibility;
- recoverability check;
- ambiguity guard;
- repetition penalty;
- reintroduction after topic distance.

### VI-3: particles and politeness

Model particles/markers such as:

- ạ;
- nhé/nhé;
- nha;
- thôi;
- rồi;
- nhé bạn;
- chứ;
- mà;
- thì.

These must be pragmatic operators, not decorative suffixes.

### VI-4: aspect and temporal stance

Improve:

- đã;
- đang;
- sẽ;
- vừa;
- mới;
- rồi;
- chưa;
- vẫn;
- còn.

Do not force one-to-one English tense translation.

### VI-5: code-switch

Treat common developer language separately from accidental language mixing.

Support profiles such as:

- native-localized;
- normal-Vietnamese-tech;
- English-heavy-engineering.

Examples: deploy, build, commit, PR, branch, merge, cache, API, bug, fix, UI.

The benchmark should test whether borrowing is socially/domain appropriate, not merely whether a token is English.

### VI-6: classifier / quantity / name behavior

Expand:

- classifiers;
- number-unit ordering;
- date/time conventions;
- personal names;
- organization names;
- transliteration/borrowing;
- punctuation conventions.

## 9. Deep English upgrade

English should gain:

- richer tense/aspect;
- phrasal verbs;
- contraction policy;
- article choice;
- count/mass behavior;
- natural pronoun/reference choice;
- discourse markers;
- conversational fragments;
- politeness/directness;
- technical register;
- idiomatic collocation;
- controlled ellipsis.

The goal is not to reproduce unrestricted English through templates. It is to broaden compositional grammar and lexical/discourse search while maintaining exact semantic verification.

## 10. New language-pack bootstrap system

The next full surface packs should be:

1. Simplified Chinese;
2. Spanish;
3. Japanese.

The ordering is justified by the live baseline: JEV successfully handled both meaning and naturalness decisions for all three. That makes JEV useful as the ranker while the packs are built.

A new language should not require hand-writing the entire core from zero.

Introduce a `LanguageTypologyProfile` with declarative fields for:

- canonical constituent order;
- pro-drop behavior;
- classifier behavior;
- article system;
- case inventory;
- agreement dimensions;
- tense/aspect expression;
- polarity;
- question formation;
- relative-clause strategy;
- modifier ordering;
- honorific/social deixis;
- plural strategy;
- script/orthography;
- punctuation;
- code-switch/borrowing policy.

The profile is only a bootstrap. Language-specific overrides remain required.

## 11. External linguistic resources

Use external linguistic resources as **evidence/data inputs**, not as an oracle.

### Universal Dependencies

Use UD features/dependencies to normalize parser/grammar feature naming and to build language-specific regression corpora. Do not assume one universal word order.

### UniMorph

Use UniMorph-style feature bundles to improve morphology interfaces and paradigm testing, especially for languages where inflection is much richer than Vietnamese or English.

### Unicode CLDR

Use CLDR for locale behavior such as:

- plural categories;
- dates/times;
- units;
- numbers;
- grammatical/cultural formatting data;
- person-name formatting conventions.

### Grammatical Framework as prior art

GF's abstract-syntax/concrete-syntax separation is highly relevant to JSG -> language-pack design. Reuse the architectural idea where useful, while keeping JEV Language's own typed evidence/provenance model and avoiding a dependency decision until runtime, coverage, and licensing are reviewed.

## 12. Conversation controller

Natural conversation requires more than sentence quality.

Implement a conversation controller that tracks:

- current topic;
- suspended topics;
- entities and salience;
- unresolved questions;
- commitments;
- corrections;
- user terminology;
- language preference;
- register preference;
- pronoun/address choice;
- previous surface forms to avoid repetition;
- recent answer length/style;
- uncertainty/evidence state.

The controller should produce a response semantic plan before surface realization.

## 13. Target-language response policy

The current browser/runtime response path must stop assuming English for meta messages.

Every visible response class must be language-pack driven:

- greeting;
- yes/no result;
- choice result;
- uncertainty;
- unsupported capability;
- clarification request;
- network/provider failure;
- rate limit;
- authentication error;
- safety/verification boundary.

Infrastructure errors can retain a developer-debug form, but the user-facing message should respect the active conversation language.

## 14. Evaluation ladder

The new system should not be promoted on unit tests alone.

### E0 — deterministic grammar tests

Per-language parse/realize/round-trip fixtures.

### E1 — adversarial semantic preservation

Negation, modality, quantity, scope, attribution, time, conditionals, pronouns.

### E2 — candidate-lattice quality

Measure:

- valid-candidate recall;
- semantic-loss rate;
- duplicate rate;
- candidate diversity;
- ranking accuracy.

### E3 — live JEV ranking

Use bounded live decisions with explicit request budgets.

Do not count obvious A-vs-broken-B examples as sufficient.

Add hard minimal pairs, near-ties, register clashes, ambiguous pronouns, and culturally plausible alternatives.

### E4 — multi-turn conversation

At least:

- 20-turn topic continuity;
- correction;
- interruption and return;
- entity reintroduction;
- pronoun drift;
- code-switch;
- style preference persistence.

### E5 — blinded human evaluation

For each supported production language, collect real blinded ratings for:

- naturalness;
- semantic accuracy;
- coherence;
- register fit;
- repetition/template feel;
- usefulness.

No synthetic ratings may close this gate.

## 15. Required benchmark difficulty increase

The current 12/12 live baseline is too easy to be a release gate.

The next benchmark must include deliberately difficult contrasts:

- both candidates grammatical but one subtly less natural;
- both candidates plausible but one changes modality;
- ambiguous references;
- long-distance discourse;
- polite vs over-formal;
- native technical code-switch vs awkward mixing;
- regional/locale differences;
- implicit subject recovery;
- tense/aspect choices;
- near-synonyms with different valency;
- information-structure mismatches;
- source-preserving paraphrase under long context.

A system that merely learns benchmark-specific wording should fail held-out transformations.

## 16. Engineering milestones

### NC-0 — baseline closure

**Already observed**

- production relay path verified;
- 12-request multilingual baseline frozen;
- raw JEV multilingual judgment: 12/12 on the small baseline;
- current surface-pack set: EN + VI only.

Exit: evidence committed and automatic live trigger removed.

### NC-1 — language-neutral response renderer

Build a `ConversationRealizer` ABI.

Move browser yes/no/choice/meta/error strings out of hard-coded English.

Exit criteria:

- EN and VI all browser response classes realized by language packs;
- no user-visible response family is English-hardcoded;
- semantic response objects exist before text rendering.

### NC-2 — discourse plan + register profile

Implement `ConversationalIntent`, `DiscoursePlan`, and `RegisterProfile`.

Exit criteria:

- deterministic serialization;
- dialogue state integration;
- EN/VI register tests;
- Vietnamese pronoun/address consistency tests.

### NC-3 — candidate-lattice engine

Generate multiple semantically equivalent candidates from one response graph.

Exit criteria:

- at least 5 valid candidates for targeted phenomena where language permits;
- semantic verifier rejects lossy variants;
- derivation/provenance retained;
- duplicate collapse.

### NC-4 — JEV naturalness ranker

Implement bounded pairwise/small-choice ranking.

Exit criteria:

- per-dimension decisions logged;
- no raw key/output leakage;
- ranking cannot override semantic rejection;
- adversarial ranking benchmark substantially harder than the current baseline.

### NC-5 — Vietnamese native-quality wave

Implement VI-1..VI-6.

Exit criteria:

- social pronoun persistence;
- zero-anaphora recovery;
- particle/register control;
- aspect improvements;
- code-switch profiles;
- blinded Vietnamese human evaluation.

### NC-6 — English native-quality wave

Deep English lexical, discourse, contraction, aspect, collocation, and fragment behavior.

Exit criteria:

- broad held-out discourse benchmark;
- blinded English human evaluation;
- low template-detection rate.

### NC-7 — Chinese/Spanish/Japanese bootstrap

Add actual surface packs, not just raw JEV judgments.

Exit criteria per language:

- parser + realizer;
- morphology/typology profile;
- round-trip semantic corpus;
- target-language response renderer;
- live ranking baseline;
- native-speaker human evaluation.

### NC-8 — long conversation

Integrate planning with dialogue memory.

Exit criteria:

- 20+ turn evaluation;
- topic return;
- correction;
- reference persistence;
- no unbounded transcript injection;
- compaction preserves commitments/reference.

### NC-9 — open-world lexical growth

Support unknown terms through bounded provisional lexical entries, borrowing, transliteration, and user-confirmed senses.

Exit criteria:

- no silent sense invention;
- exact unknown-token preservation;
- new terms can enter later candidate generation with provenance.

### NC-10 — multilingual production gate

A language becomes `stable-conversation` only when all of the following are true:

- deterministic grammar/semantic tests green;
- adversarial held-out benchmark green;
- live JEV ranking verified;
- blinded human ratings collected;
- known-failure ledger published;
- latency/cost budgets met;
- no hidden generative LLM dependency.

## 17. Quality targets

These targets should be preregistered before final human evaluation.

For a production language:

- semantic-accuracy human mean >= 4.7 / 5;
- naturalness human mean >= 4.3 / 5;
- multi-turn coherence mean >= 4.3 / 5;
- template-detection rate <= 10%;
- critical semantic-loss rate = 0 on release corpus;
- reference/pronoun critical-error rate <= 1%;
- candidate semantic-validity recall >= 99% on controlled generation domains;
- deterministic replay = 100% for D0 paths;
- every live JEV decision records request/model/usage evidence without credentials.

These thresholds are targets, not current claims.

## 18. Language expansion sequence after ZH/ES/JA

After the first three new packs, expand by typological coverage rather than popularity alone.

Suggested research sequence:

- French / German / Portuguese;
- Korean;
- Arabic;
- Hindi;
- Russian;
- Turkish;
- Indonesian;
- Thai.

This forces the architecture to handle gender/case, agglutination, honorifics, templatic morphology, rich agreement, pro-drop, classifiers, and different scripts.

## 19. What should not be done

Do not:

- hide GPT/Claude/another LLM behind JEV Language;
- declare raw JEV multilingual judgment equal to multilingual surface-generation support;
- grow thousands of sentence templates as the main strategy;
- choose Vietnamese pronouns only from grammatical person;
- let naturalness ranking override semantic verification;
- fabricate M19 ratings;
- promote a language because a handful of obvious choice probes pass;
- use one English-centric grammar schema and call language-specific behavior an exception.

## 20. Immediate implementation order

The highest-leverage next code work is:

1. close the temporary multilingual live trigger and lock the evidence;
2. introduce `ConversationRealizer` and remove hard-coded English browser response strings;
3. implement `ConversationalIntent`, `DiscoursePlan`, and `RegisterProfile`;
4. deepen Vietnamese social-reference/register behavior;
5. build candidate-lattice generation over existing EN/VI semantics;
6. connect bounded JEV naturalness ranking;
7. run a hard EN/VI multilingual conversation benchmark;
8. perform real blinded human ratings;
9. only then bootstrap ZH/ES/JA surface packs.

The central strategy is therefore:

> **JEV decides; JEV Language composes; the verifier protects meaning; the language pack makes it native.**

That division of responsibility best matches the evidence observed so far and preserves the project's non-LLM architecture.
