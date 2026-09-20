# Conversation Ranker Boundary v4 — preregistration

Status: preregistered before the live run.

## Purpose

The v3 mirrored experiment showed strong preference agreement and option-order invariance, but it contained no observed preference errors. That means it could not tell us whether the current confidence/margin gate actually recognizes cases where a strong preference is not justified.

v4 therefore introduces an explicit **preference-boundary** test.

## Fixed budget

- 10 base pairs.
- Every pair is run in normal and mirrored A/B order.
- Exactly 20 authenticated Jev requests.
- Live calls use only the verified BYOK relay.
- Error bodies and credentials are not persisted.

## Pair families

Five pairs have a preregistered contextual preference:

- Vietnamese correction ownership;
- English uncertainty calibration;
- Simplified-Chinese service register;
- Japanese workplace register;
- Vietnamese-English developer code-switch.

Five pairs are intentionally **near ties**:

- Vietnamese particle placement;
- English punctuation/rhythm;
- Simplified-Chinese temporal wording;
- Spanish temporal wording;
- Japanese result wording.

Near-tie pairs have **no gold winner**. Assigning one after observing the result would invalidate the calibration question.

## Preregistered analysis

Current production gate:

- minimum confidence: 0.62;
- minimum probability margin: 0.08.

For clear-preference pairs, report:

- agreement with the preregistered preference;
- gate acceptance;
- mirror/order invariance.

For near-tie pairs, report:

- gate abstention rate;
- mean confidence;
- mean probability margin;
- false-certainty rate, where confidence >= 0.90 OR margin >= 0.80;
- mirror/order invariance.

The benchmark does **not** fail just because a near-tie pair selects one candidate. The research concern is whether it selects one with unjustifiably high certainty.

## Interpretation boundary

A strong v4 result can support the statement that Jev is useful as a bounded multilingual conversational ranker with measurable preference-boundary behavior.

It cannot establish:

- unrestricted string generation;
- native surface-pack coverage for Chinese, Spanish, or Japanese;
- end-to-end human naturalness;
- M19 completion.

Human M19 remains the authoritative end-to-end gate.
