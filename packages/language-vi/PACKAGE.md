# language-vi

Status: **candidate / pending M8 gate verification**.

The M8 Vietnamese pack implements the shared `HumanLanguagePack` ABI and maps Vietnamese independently against the shared semantic core. It does not translate Vietnamese through English surface text.

Implemented foundation:
- versioned `language.vi` manifest and machine-readable coverage matrix;
- ABI tokenizer, morphology, lexicon, grammar, parser hooks, realization hooks, punctuation, discourse and conformance providers;
- NFC-aware Vietnamese tokenizer assumptions;
- seed lexicon for the controlled semantic domain plus multiword modality entries;
- analytic morphology provider (no English-style tense inflection assumptions);
- controlled Vietnamese grammar alternatives for clause structure, negation, `có … không` questions, condition/cause, classifier phrases and aspect particles;
- optional generic-artifact classifier strategy;
- aspect markers `đã / đang / sẽ` mapped to completed / ongoing / planned event semantics;
- pronoun/address strategy abstraction driven by Vietnamese social relation;
- direct Vietnamese → JSG controlled parser;
- direct JSG → Vietnamese controlled realizer;
- shared English/Vietnamese semantic-equivalence corpus.

The current milestone scope is a controlled semantic corpus. Serial-verb constructions, broad topic-prominent syntax, reduplication, open-domain lexical coverage and unrestricted Vietnamese dialogue remain later hardening work.
