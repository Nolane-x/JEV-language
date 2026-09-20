# Conversation ranker threshold calibration note v1

Status: partial calibration evidence.

The frozen v3 live Jev ranker evidence contains 20 successful mirrored decisions and all 20 agree with the preregistered linguistic hypotheses.

Applying the current conversation-selection defaults:

- minimum confidence: 0.62
- minimum margin: 0.08

produces:

- coverage: **19 / 20 = 0.95**
- selective accuracy on accepted v3 cases: **1.0**
- one abstention: `ja-workplace-register:mirrored`
- false-abstention rate relative to the v3 hypotheses: **0.05**

The abstained Japanese mirrored case had confidence 0.40 and margin 0.40, while still making the same candidate choice as its non-mirrored partner.

## Important limitation

v3 currently contains **zero observed ranking errors** relative to its preregistered hypotheses.

Therefore it cannot estimate how well any threshold catches wrong Jev choices. Lowering the confidence threshold merely to recover the one abstained v3 case would be unjustified because there are no negative/error examples against which to measure the safety tradeoff.

The calibration reporter therefore marks this dataset as:

`insufficient-errors`

rather than choosing a new production threshold.

## Next decisive data

A real threshold update should wait for at least one of:

1. blinded M19 human preference labels that disagree with some Jev rankings;
2. a held-out subtle-pair set containing empirically observed Jev errors;
3. adversarial ranker cases constructed before evaluation and then frozen.

Until then, the current 0.62 / 0.08 defaults remain conservative engineering defaults, not statistically calibrated human-naturalness thresholds.
