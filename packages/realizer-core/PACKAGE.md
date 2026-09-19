# realizer-core

Status: **prototype / PARTIAL**.

Implemented constrained-realizer foundation:

- reusable `DiscoursePlan` and `ClausePlan` planning over semantic roots;
- deterministic lexical candidate generation from concept-indexed lexicons;
- role-to-syntax mapping with required-role validation;
- morphology feature propagation with conflict detection;
- morphology realization through injected language providers;
- deterministic punctuation formatting;
- basic discourse-aware reference forms;
- explicit ordered fallback ladder with structured failure evidence;
- controlled English realization for the M4 semantic corpus;
- semantic source maps for generated clauses, quantities, and temporal values;
- ID-independent semantic projection and round-trip verification.

The controlled M5 path is deliberately narrower than broad English NLG. M6 paraphrase diversity, broader grammar, style and naturalness remain separate work.


T424-T430 research-expansion candidate adds realization candidate lattices, hard constraints separated from soft objectives, pre-emission reference-ambiguity simulation, reversible aggregation/deaggregation, and deterministic seed-bound realization replay.
