# M19 observed stimulus capture and freeze v1

Status: capture protocol implemented; real arm outputs not yet frozen.

This layer closes the gap between "the M19 rating protocol exists" and "the evaluator is actually shown outputs that were observed from the compared systems."

## Fixed scenario pack

The evaluator scenarios are frozen at:

`evals/scenarios/m19-natural-conversation-v1.json`

They map exactly to the preregistered M19 manifest and preserve its expected turn counts:

- `m19-unseen-casual`: 4 total turns;
- `m19-technical-followup`: 6 total turns;
- `m19-correction-topic-return`: 8 total turns;
- `m19-open-world-bilingual`: 6 total turns.

The pack contains only user turns. It does not contain expected assistant wording and does not identify the systems assigned to arms A or B.

## No-fabrication capture rule

A frozen stimulus is accepted only when every preregistered item/arm pair has one observed capture.

Each capture must include:

- the exact preregistered item id;
- anonymous arm code;
- matching `conversationRef`;
- the full alternating user/assistant transcript;
- exact expected turn count;
- observed latency;
- observed cost units;
- semantic-evidence references;
- separate observation-evidence references;
- an explicit observation timestamp.

Missing item/arm coverage fails closed. The freezer never inserts placeholder assistant text, synthetic output, or an implicit fallback.

## Blinding boundary

The public/evaluator-facing bundle contains:

- item id;
- arm code;
- transcript;
- latency/cost internally in the blinded bundle;
- semantic-evidence references internally in the blinded bundle.

The rating worksheet deliberately strips:

- latency;
- cost;
- semantic-evidence references;
- observation-evidence references;
- capture timestamps.

The arm-code-to-system mapping must remain outside the evaluator-facing bundle until ratings are frozen.

## Transcript format

Observed transcripts are canonicalized only at the role-label boundary:

```text
[User]
<exact user turn>

[Assistant]
<exact observed assistant turn>
```

Conversation text itself is not paraphrased by the freezer.

## Freeze integrity

`freezeM19ObservedStimuli(...)` produces canonical SHA-256 digests for:

- the preregistered manifest;
- sorted observed captures;
- blinded bundle;
- evaluator worksheet template.

Capture input order therefore cannot alter the frozen evidence identity.

## Remaining NC-13 work

This implementation does **not** mark NC-13 complete.

The remaining work is operational and empirical:

1. execute both anonymous study arms on the fixed scenarios;
2. record actual transcripts, latency, cost and evidence refs;
3. freeze the complete 8-stimulus bundle (4 items × 2 arms);
4. inspect for accidental system-identity leakage before giving the worksheet to evaluators;
5. only then begin NC-14 human ratings.

No synthetic conformance fixture may be committed as M19 research evidence.
