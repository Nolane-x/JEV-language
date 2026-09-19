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


T341-T350 research-expansion candidate adds:

- explicit presupposition lifecycle records that remain non-asserted;
- local/global accommodation candidate generation without automatic commitment;
- pragmatic-inference status separate from assertion truth status;
- cancellable scalar-inference candidates over inspectable scales;
- multiword idiom candidate generation that preserves a literal alternative;
- inspectable semantic-coercion rule registry with context-tag licensing;
- conformance fixtures that reject duplicate rules and verify cancellation boundaries.

These mechanisms preserve ambiguity by construction. A trigger, idiom match, scalar alternative, or coercion rule creates candidates; it does not silently mutate JSG facts.
