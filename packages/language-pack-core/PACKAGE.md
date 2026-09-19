# language-pack-core

Status: **prototype / M18.1 candidate pending CI**.

Defines the harness-neutral human-language pack contract required by the master specification: manifest, tokenizer, morphology, lexicon, grammar, parser hooks, realization hooks, punctuation, discourse strategy and conformance manifest. It contains no language-specific grammar or Jev networking.

M18.1 adds shared open-world lexical orchestration without moving language-specific rules into the core:

- deterministic Section-209 lexical resolution stages;
- cooperation across installed language-pack lexicons/morphology providers;
- evidence-rich exact/morphology/compound/foreign/provisional/opaque alternatives;
- exact preservation of unknown named and technical terms;
- provisional lexical-sense proposals that do not mutate ontology automatically;
- token-level language hypotheses and code-switch segment construction;
- explicit borrowing policy so lexical gaps do not cause accidental language switching.

This package does not claim open-domain parsing or natural conversation. Grammar expansion T107–T120 remains a separate M18 wave.


T342 adds an optional presupposition-trigger registry provider to the shared language-pack ABI. Trigger descriptors are inspectable data (lexical, multiword, or construction keys) with explicit cancellability and projection preference; they do not execute accommodation or assert triggered content.


T402-T410 typology expansion adds optional zero-realization/pro-drop, classifier-selection, social-deixis/honorific, constituent-order, morphological-construction and code-switch metadata contracts. Conformance mock packs exercise contrasting SOV/VSO/non-projective profiles without moving language-specific surfaces into the shared core.
