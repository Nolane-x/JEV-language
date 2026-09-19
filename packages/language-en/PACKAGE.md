# language-en

Status: **prototype / M18.2 candidate English grammar expansion**.

English implements the shared HumanLanguagePack ABI and retains the verified M5–M6 controlled/bidirectional semantic path.

M18.2 candidate additions:

- expanded seed lexicon for determiners, copula forms, do-support, modal auxiliaries, adjective/intransitive examples, exact quantity and deictic time;
- grammar-token evidence from tokenizer + lexicon + morphology;
- controlled grammar coverage for noun phrases, copular clauses, intransitive/transitive clauses, negation, modality, yes/no and wh questions, coordination, conditionals, causality, quantity and time adjuncts;
- packed syntax-forest parsing through parser-core;
- conservative syntax→JSG bridge that only commits constructions supported by the existing semantic parser.

Grammar recognition never fabricates JSG semantics for unsupported constructions.
