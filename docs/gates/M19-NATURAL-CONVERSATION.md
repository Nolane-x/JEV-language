# M19 — Natural-conversation research gate

Status: **protocol verified; human research data pending**.

This milestone is experimental. Completion means that the preregistered measurements were actually collected and reported. It does **not** mean the measured naturalness was positive.\n\nVerified protocol evidence: CI #336 passed package boundaries, strict TypeScript typecheck, 76/76 test files, and 617/617 tests.

## Required measurements

The protocol preserves the master-spec requirements:

- blind human ratings;
- semantic accuracy;
- multi-turn coherence;
- template leakage / blinded template judgment;
- response diversity;
- latency and cost;
- failure taxonomy.

Negative or mixed human results are valid research outcomes and must remain visible.

## Blinding

The checked-in study manifest uses anonymous arm codes (`A`, `B`). The blinded bundle contains outputs, arm codes, latency/cost, and semantic-evidence references, but no system identity mapping.

Any mapping from arm code to implementation/baseline must be kept outside the evaluator-facing bundle until ratings are frozen.

Every evaluator-facing row must also carry the exact conversation/prompt context needed to judge semantic accuracy and multi-turn coherence. That context is validated against the canonical study context set and receives its own SHA-256 digest in frozen evidence. Ratings collected against altered or missing context are rejected.

## Human-data rule

No human ratings are checked into the repository at this stage.

`reportM19NaturalConversation(...)` MUST therefore return `pending-human-data` for the repository's current real M19 state. Synthetic ratings in conformance tests exercise aggregation mechanics only and are explicitly not research evidence.

A real study may move to `complete` only when every blinded stimulus reaches the preregistered `minRatingsPerStimulus` floor.

## Preregistered phenomenon coverage

The manifest requires coverage of:

- unseen topics;
- unseen entity names;
- compositional novel sentences;
- multi-turn references;
- varied discourse structures;
- corrections;
- technical content;
- casual language;
- open-domain unknown terms;
- blinded template detection.

The current study manifest is:

`evals/manifests/m19-natural-conversation.json`

## Rating schema

Each evaluator/item/arm record supplies:

- naturalness: 1–5;
- semantic accuracy: 1–5;
- multi-turn coherence: 1–5;
- template judgment: `template | not-template | unsure`.

Evaluator IDs should be pseudonymous study identifiers, not personal information.

## Failure taxonomy

Failures are recorded independently of rating averages:

- semantic error;
- reference error;
- correction error;
- topic-coherence error;
- template-like output;
- repetition;
- style mismatch;
- unknown-term corruption;
- latency;
- other.

This prevents a single mean score from hiding systematic failure modes.

## Human-study execution kit

The repository provides a no-fabrication execution path in `packages/evaluation-core/src/m19-study-kit.ts`:

- `validateM19RatingContexts(...)` requires exactly one non-empty canonical context for every preregistered study item;
- `createM19RatingWorksheet(...)` binds that context to each blinded output while deliberately stripping latency, cost, and semantic-evidence metadata that could bias human judgment;
- `importM19RatingWorksheets(...)` requires a pseudonymous evaluator ID, exact context equality, exactly one completed rating for every blinded stimulus, and then reuses the existing M19 rating validator;
- `freezeM19HumanStudyEvidence(...)` produces a tamper-evident frozen record with canonical SHA-256 digests of the manifest, blinded bundle, canonical contexts, sorted ratings, sorted failure records, and final report;
- context/rating/failure input order does not change those evidence digests;
- incomplete or context-mutated worksheets fail closed instead of becoming implicit or synthetic ratings;
- `npm run m19:prepare` and `npm run m19:freeze` provide the operator path for preparing worksheets and freezing returned ratings without custom code.

The static evaluator at `playground/m19-evaluator.html` is offline by construction: its page CSP sets `connect-src 'none'`, it has no network or persistent-storage API, renders context/output as text rather than HTML, uses pseudonymous evaluator IDs, deterministically shuffles presentation order, and only exports a completed worksheet after every rating dimension is filled.

The freeze object records whether the measurement is complete, but it does not reinterpret a poor result as a failed protocol. Negative or mixed observed outcomes remain reportable research results.

## Current closure state

M19 is **not verified** because human ratings have not been observed. The protocol, manifest, validators, aggregation, negative-result handling, and conformance tests can be verified independently without pretending the research measurement has happened.
