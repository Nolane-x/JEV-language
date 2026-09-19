# lexicon-core

Status: **prototype / PARTIAL**. Implements T098-T101/T104-T105 foundations: Lexeme/LexicalSense, valency, collocation, multiword-expression schemas, language-neutral indexing, and exact unknown-token preservation. Broad domain lexicons remain incomplete.


T391-T400 research-expansion candidate strengthens open-vocabulary behavior:

- explicit lexeme/sense separation is retained and tested;
- valency slots can expose selectional-preference metadata;
- existing multiword lexical units receive conformance coverage;
- named-entity aliases carry script and temporal-validity metadata;
- unknown lexemes preserve exact source surfaces plus derived normalization layers;
- lexical-extension proposals follow an evidence-backed review lifecycle;
- Unicode normalization layers remain distinct from source-exact content;
- grapheme-safe segmentation/slicing avoids code-unit corruption;
- transliteration is exposed through a typed adapter ABI and returns candidates rather than silently replacing source text;
- held-out open-vocabulary evaluation checks exact preservation across mixed scripts and grapheme clusters.
