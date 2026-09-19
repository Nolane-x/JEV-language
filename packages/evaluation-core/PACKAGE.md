# evaluation-core

Status: **prototype / T276-T288 candidate pending conformance CI**.

This package implements the harness-neutral evaluation substrate for the v0.4 master specification. Evaluation remains separate from product/harness behavior and does not execute downstream actions.

Implemented candidate scope:

- T276: runtime-validated dataset manifests with explicit domain, development/calibration/validation/test split, item count, content digest and label provenance, plus reproducible evaluation-case schemas carrying semantic constraints, allowed alternatives, forbidden errors, language/domain version and expected verification level;
- T277: deterministic benchmark runner with duplicate-case rejection, declared item-count enforcement, pass/fail/unknown accounting and stable case ordering;
- T278: candidate recall reporter with Recall@K, full recall, mean candidate count, oracle upper bound, conditional selection accuracy and end-to-end accuracy;
- T279: calibration reporter with reliability bins, Brier score, expected calibration error, coverage/selective accuracy and risk-coverage points;
- T280: semantic benchmark metrics;
- T281: NLU benchmark metrics;
- T282: NLG benchmark metrics;
- T283: dialogue benchmark metrics;
- T284: multilingual semantic-preservation metrics;
- T285: synthesis benchmark metrics plus a controlled executable typed-hole synthesis evaluation slice;
- T286: repair benchmark metrics plus a controlled executable compiler/test repair evaluation slice;
- T287: zero-generative-model audit with Jev-native validity classification;
- T288: benchmark replay-manifest generator integrated with trace-replay.

The package deliberately keeps human-only metrics such as naturalness optional instead of fabricating scores when no human labels exist. Domain reporters preserve separate metrics rather than collapsing all capabilities into a single unsupported quality number.
