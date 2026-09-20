# Conversation candidate-recall engineering baseline v1

Status: deterministic engineering fixture, **not human naturalness evidence**.

This baseline connects the English/Vietnamese conversational microgrammars to the generic candidate-recall reporter.

The fixture intentionally contains ten preregistered engineering cases:

- four Vietnamese preferred variants expected to be generated;
- one Vietnamese topic-comment variant deliberately outside current coverage;
- four English preferred variants expected to be generated;
- one English calibrated-hedging variant deliberately outside current coverage.

Expected deterministic result:

- acceptable-hit rate: 1.0, because the direct base surface remains available;
- preferred-hit rate: **0.8**;
- known preferred-variant misses:
  - `vi-topic-comment-unsupported`;
  - `en-hedging-unsupported`.

The purpose is to prevent a false "candidate recall solved" claim. The next microgrammar waves should improve the two explicit gaps and add held-out cases without rewriting old expected failures after observing them.

This fixture does not replace M19 blinded human ratings. It only measures whether bounded microgrammar transformations can produce specific predeclared surfaces.
