# M18.2 — Grammar and Parser Expansion Gate

Status: **candidate — pending CI**

Specification basis: tasks T107–T120.

## Task mapping

| Task | Evidence |
| --- | --- |
| T107 grammar categories/features | `STANDARD_GRAMMAR_CATEGORIES`, `STANDARD_GRAMMAR_FEATURES`, `GrammarFeatures`, `GrammarFeatureConstraint` |
| T108 GrammarRule ABI | feature-aware `GrammarRule` validation, signatures, registry/conflict detection |
| T109 packed parse forest | `buildPackedGrammarForest()` with ambiguity packing, optional/repeat support and pass budget |
| T110 simple English noun phrases | noun, determiner+noun, pronoun rules |
| T111 copular clauses | adjective and nominal copula VP rules |
| T112 intransitive/transitive clauses | separate VP constructions plus declarative S |
| T113 negation | do-support and bare-negation VP constructions |
| T114 modal clauses | required / permitted / possible modal VP rules |
| T115 questions | yes/no do-support, modal questions and wh do-support |
| T116 coordination | sentence and/or coordination |
| T117 basic conditionals | if-clause composition |
| T118 causal clauses | because-clause composition |
| T119 quantity/time adjuncts | exact/at-most/more-than quantity plus deictic time adjunct |
| T120 supported syntax → JSG | `parseEnglishGrammarToJsg()` retains packed syntax evidence and delegates only constructions with existing semantic support |

## Parser invariants

The packed chart parser:

- consumes only declared GrammarRule patterns;
- matches literal, lexical and category patterns;
- enforces token/category feature constraints before constructing a rule alternative;
- packs multiple rule analyses for the same category/span into one syntax node;
- never resolves ambiguity by insertion order;
- bounds repeated/non-consuming grammar behavior with `maxPasses`;
- requires a requested root spanning the complete token sequence;
- validates the final forest before returning it.

## English controlled syntax evidence

Conformance covers:

1. noun phrases;
2. copular adjective clauses;
3. intransitive clauses;
4. transitive clauses;
5. negation;
6. modality;
7. yes/no questions;
8. wh questions;
9. coordination;
10. conditionals;
11. causal clauses;
12. exact quantity;
13. deictic time adjuncts.

The language pack also derives grammar tokens from tokenizer + exact lexicon + morphology evidence and uses a synthetic numeral lexical observation for numeric tokens.

## Syntax → JSG safety boundary

Grammar recognition and semantic construction are deliberately separated.

`parseEnglishGrammarToJsg()` first requires a valid complete syntax forest, then invokes the existing controlled semantic parser. Therefore:

- supported controlled constructions retain syntax evidence and produce validated JSG;
- syntax recognized by the grammar but lacking a semantic construction contract returns a typed error;
- no JSG predicate, concept or role is guessed from grammar shape alone.

Conformance explicitly checks this negative boundary with an intransitive sentence recognized syntactically but not yet represented by the controlled semantic layer.

## Non-claims

This wave does not claim:

- arbitrary open-domain English parsing;
- complete semantic construction for every recognized grammar rule;
- imperative coverage;
- broad probabilistic parsing;
- unrestricted grammar induction;
- M18 completion.

## Gate rule

Mark T107–T120 verified only after the complete PR head passes package-boundary validation, strict TypeScript, and the full deterministic test suite.

Live Jev requests: **0**.
