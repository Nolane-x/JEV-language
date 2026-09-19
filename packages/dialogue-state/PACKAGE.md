# dialogue-state

Status: **candidate / M7 milestone verified**.

Implemented M7 foundation:
- typed DialogueTurn / DialogueState contracts;
- revisioned transactional dialogue updates with atomic failure and rollback;
- semantic topic stack and active-topic switching;
- discourse-entity salience and bounded reference candidate generation;
- versioned recorded/live JDR reference-resolution Decision Pack integration;
- open-question and resolved-question state;
- request state kept distinct from commitment state;
- correction and retraction records retaining previous revisions;
- deterministic dialogue-act parsing;
- ellipsis and follow-up fragment reconstruction with literal-fragment provenance;
- long-dialogue compaction that archives old surface turns while retaining active semantic state;
- 22-turn acceptance fixture with reference to an entity introduced more than 10 turns earlier after multiple topic changes.

M7 conformance passed deterministic CI #107. The package remains candidate rather than stable because broad unrestricted conversational understanding, multilingual dialogue and later open-domain hardening remain outside this milestone claim.


T361-T370 research-expansion candidate formalizes dialogue semantics beyond the M7 state machine:

- typed Question semantic union with explicit expected-answer contracts;
- answer-to-question links that distinguish complete/partial/nonresponsive/rejected answers;
- bounded directive-act inventory;
- multi-act utterance representation plus semantic dialogue-unit segmentation interface;
- participant commitment ledger with fulfill/retract/supersede transitions;
- transitive invalidation of dependent semantic derivations after corrections;
- deterministic dialogue-act/repair benchmark coverage.

These additions do not infer an answer, commitment, or repaired fact merely from surface form; semantic links and transitions remain explicit and inspectable.
