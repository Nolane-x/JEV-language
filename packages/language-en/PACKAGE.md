# language-en

Status: **prototype / verified controlled English foundation**.

English now implements the same shared `HumanLanguagePack` ABI used by Vietnamese. Its tokenizer, morphology, lexicon, grammar, parser hooks, realization hooks, punctuation, discourse strategy and conformance manifest remain language-specific providers behind the common interface.

The English pack retains its existing controlled/bidirectional M5–M6 capabilities; the ABI layer does not move English syntax such as subject/object order, articles or tense morphology into JSG.
