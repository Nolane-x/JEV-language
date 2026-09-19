# M7 — Dialogue Semantics Gate Evidence

Status: **verified**

Specification basis: sections 241–250, 414, and tasks T145–T157 of the v0.4 master specification.

## T145–T157 implementation map

| Task | Evidence |
| --- | --- |
| T145 DialogueTurn | `DialogueTurn`, `DialogueAct`, commitment/topic change records |
| T146 DialogueState | revisioned `DialogueState` plus canonical validation |
| T147 topic stack | push/activate/pop with semantic `TopicState` |
| T148 discourse entity salience | decayed salience, mention counts, topic membership, recency |
| T149 reference candidate generation | `referenceCandidatesFromState()` |
| T150 reference-resolution Decision Pack | `dialogue.reference-resolution.v1` + bounded JDR Choice resolver |
| T151 open questions | open/resolved question models with answer roots and confidence |
| T152 request state | open/accepted/declined/fulfilled/withdrawn requests |
| T153 commitment state | commitments are created separately from accepted requests and have their own lifecycle |
| T154 correction/retraction records | `CorrectionRecord`, previous-revision linkage, explicit retracted claims |
| T155 fragment/ellipsis subset | `parseDialogueTurnIntent()`, `reconstructEllipsis()`, `reconstructFollowUpFragment()` |
| T156 transactional dialogue update | immutable transaction proposal, preconditioned atomic commit, rollback, revision chain |
| T157 20+ turn fixture | 22-turn deterministic fixture in M7 conformance |

## Transaction order

A committed turn applies semantic updates in this order:

```text
corrections/retractions
→ topic changes
→ questions
→ requests
→ commitments
→ discourse-entity salience
→ unresolved/reference state
→ validate
→ commit dialogue revision
```

Failed updates never partially mutate the committed dialogue snapshot.

## Request / commitment invariant

M7 explicitly preserves:

```text
request ≠ commitment
request(open) → accept/decline
accepted request → explicit commitment
commitment → fulfilled/retracted
```

A commitment linked to a request cannot be created unless that request has been accepted.

## Ellipsis and follow-up evidence

The conformance suite demonstrates:

- an open `Python or Rust?` semantic question;
- literal fragment `Rust.`;
- deterministic reconstruction to an ANSWER tied to the open question;
- the original literal fragment retained as dialogue-fragment provenance;
- follow-up fragments retain active topic/open-question context;
- unresolvable fragments preserve ambiguity rather than fabricating semantic roots.

## Long-dialogue acceptance

`tests/conformance/m7-dialogue-semantics.conformance.test.ts` constructs a **22-turn** dialogue.

Key sequence:

- turn 1 introduces semantic entity `Atlas`;
- subsequent turns and multiple topic shifts move through architecture, deployment, and testing;
- another compatible entity is introduced later;
- by turn 21 the original entity is more than 10 turns old;
- the bounded reference candidate generator preserves both compatible entities;
- recorded JDR Choice resolves `that original service` to the turn-1 entity;
- turn 22 refers to it successfully after topic changes and reactivates its earlier topic;
- revision history contains all 22 committed turns.

This meets the section-414 requirement that the acceptance dialogue exceed 20 turns and refer to an entity introduced at least 10 turns earlier after topic changes.

## Long-dialogue compaction

The dialogue store can archive old surface turns while retaining semantic state needed by later dialogue:

- active/open questions;
- commitments;
- discourse entities and resolved identity;
- active topic/topic stack;
- revision lineage.

Compaction records archived turn IDs and changes the dialogue revision. Later turns can still reference entities introduced in archived surface turns.

## Reference-resolution safety

The versioned Decision Pack:

- exposes only bounded pre-grounded semantic candidates;
- cannot generate a new referent identity;
- preserves ambiguity below confidence threshold;
- carries candidate-source and candidate-recall evidence;
- remains compatible with recorded deterministic execution.

No live Jev request is required by M7 conformance.

## Verification evidence

- verified PR head: `fa4d0de0b3852c88ec636d887fc40f849d0f7c37`;
- GitHub Actions CI run **#107** / run id `35424108853`: `success`;
- package-boundary enforcement: pass;
- strict TypeScript: pass;
- M7 dialogue conformance: **7/7 tests pass**;
- complete deterministic repository suite: **32/32 test files, 197/197 tests pass**;
- live Jev requests consumed by M7: **0**; reference ambiguity uses recorded deterministic JDR fixtures.

The M7 Definition of Done is therefore verified for the specified dialogue-semantic scope. The implementation-state ledger may advance to **M8 Vietnamese**.
