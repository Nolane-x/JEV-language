# grammar-core

Status: **prototype / M18.2 candidate**.

Implemented grammar infrastructure:

- standard reusable category inventory for clause, phrase, question, quantity and time structures;
- open category extension for language-specific constructs;
- standard grammar feature vocabulary;
- reusable feature constraints with exact/one-of/presence checks;
- GrammarRule ABI with patterns, constraints, semantic construction hooks, realization plans, result features, priorities and annotations;
- deterministic structural signature / duplicate detection;
- registry lookup and conflict detection;
- feature-aware constraint evaluation.

M18.2 conformance exercises the ABI through the packed parser and English grammar. Broad language coverage remains language-pack specific.
