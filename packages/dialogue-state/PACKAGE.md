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
