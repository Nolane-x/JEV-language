# dialogue-state

Status: **candidate / pending M7 gate verification**.

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

The package MUST remain candidate until the M7 conformance branch passes deterministic CI. Broad unrestricted conversational understanding remains outside this milestone claim.
