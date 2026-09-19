# synthesis-core

Status: **candidate / M11 implementation complete pending gate CI**.

Implemented against master-spec tasks T194–T208:

- typed `ExpansionCandidate` and `CandidateGenerator` plugin ABI;
- expression-hole and statement-hole replacements;
- in-scope symbol generator;
- literal generator;
- function-call generator with typed argument holes;
- branch generator with independently synthesized child holes;
- collection filter/map pattern generator;
- statement return generator;
- deterministic hard pruning for type, effect, scope and resulting-PIR validity;
- deterministic synthesis-state hashing and deduplication;
- best-first and beam frontiers;
- global and per-hole state/depth/cost/expansion/deadline/Jev/compiler/test/memory budgets;
- bounded JDR Choice ranking over already-valid candidate IDs only;
- complete-program acceptance verifier ABI;
- structured partial failure results retaining the best partial PIR;
- inspectable expansion/search trace and generator history.

M11 does not claim compiler-backed CEGIS, programming-language source generation, backend lowering or repair. Those belong to later milestones/research tasks.
