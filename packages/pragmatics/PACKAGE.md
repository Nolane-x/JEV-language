# pragmatics

Status: **prototype / PARTIAL**.

Implemented M6 naturalness primitives:

- deterministic style-profile layering with normalized dimensions;
- bounded repetition tracking across lexical items, sentence openings, connectives, reference forms, discourse patterns and examples;
- explanation-strategy candidate generation from explicit discourse relations;
- audience-aware detail selection that never drops required semantic units;
- template-leakage evaluation separated from semantic correctness;
- blinded human-evaluation JSONL export.

Pragmatics changes expression strategy only. It does not mutate JSG truth conditions. Probabilistic selection, when used, belongs behind typed Decision Packs and must preserve deterministic fallback behavior.

M6 remains incomplete until the required bidirectional English expansion phenomena and held-out template-leakage benchmark are implemented and verified.
