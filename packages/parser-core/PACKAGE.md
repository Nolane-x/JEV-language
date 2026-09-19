# parser-core

Status: **prototype / M18.2 candidate**.

Implemented parser infrastructure:

- packed syntax-forest model and runtime validation;
- deterministic GrammarRule-driven packed chart parser;
- literal, lexical and category pattern matching;
- optional and repeated grammar patterns with non-consuming-recursion budget protection;
- feature-aware token/category matching;
- ambiguity packing as multiple alternatives on one span/category node;
- semantic construction rule ABI and parse candidates;
- ambiguity classification/resolution registry;
- bounded JDR-backed Choice ambiguity resolver with stable candidate IDs;
- confidence-threshold ambiguity preservation;
- JSG parse commits through semantic validation.

M18.2 adds rule-driven parsing but does not claim arbitrary open-domain parsing.


T413-T420 research-expansion candidate adds forced-disambiguation diagnostics, packed lexical lattices, a packed syntax/semantic forest contract, typed semantic holes/composition, staged deterministic pruning, inspectable ranking breakdowns, and explicit strict/robust parser profiles.
