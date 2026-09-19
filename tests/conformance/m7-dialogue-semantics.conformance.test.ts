import { describe, expect, it } from "vitest";
import {
  DecisionRuntime,
  RecordedDecisionAdapter,
  type DecisionBatchResponse,
} from "../../packages/decision-runtime/src/index.ts";
import {
  referenceResolutionDecisionPack,
  validateDecisionPack,
} from "../../packages/decision-packs/src/index.ts";
import {
  InMemoryDialogueState,
  parseDialogueTurnIntent,
  reconstructEllipsis,
  reconstructFollowUpFragment,
  referenceCandidatesFromState,
  resolveReference,
  type DialogueTurn,
  type DialogueUpdate,
  type QuestionState,
  type RequestState,
  type CommitmentState,
  type TopicState,
} from "../../packages/dialogue-state/src/index.ts";
import {
  createTraceId,
  type SemanticId,
} from "../../packages/core-types/src/index.ts";

const sid = (value: string): SemanticId => value as SemanticId;

const user = { id: "user", label: "User" };
const assistant = { id: "assistant", label: "Assistant" };

const baseTurn = (
  turnNumber: number,
  participant: "user" | "assistant" = turnNumber % 2 === 1
    ? "user"
    : "assistant",
  literal = `turn ${turnNumber}`,
): DialogueTurn => ({
  id: `turn:${turnNumber}`,
  turnNumber,
  participant,
  sourceRef: `source:turn:${turnNumber}`,
  literal,
  parsedRoots: [],
  dialogueActs: [],
  introducedEntities: [],
  referencedEntities: [],
  commitmentChanges: [],
  topicChanges: [],
});

const topic = (
  id: string,
  relatedEntities: SemanticId[] = [],
  parent?: string,
): TopicState => ({
  id,
  rootConcepts: [`concept:${id}`],
  relatedEntities,
  introducedTurn: 0,
  lastActiveTurn: 0,
  ...(parent === undefined ? {} : { parent }),
});

const openQuestion = (
  id: string,
  turn: number,
): QuestionState => ({
  id,
  propositionRoots: [sid(`proposition:${id}`)],
  asker: "user",
  addressee: "assistant",
  status: "open",
  answerRoots: [],
  introducedTurn: turn,
  choices: [
    {
      id: "rust",
      label: "Rust",
      semanticRoots: [sid("choice:rust")],
    },
    {
      id: "python",
      label: "Python",
      semanticRoots: [sid("choice:python")],
    },
  ],
});

const commit = (
  store: InMemoryDialogueState,
  update: DialogueUpdate,
) => {
  const result = store.commit(store.beginUpdate(update));
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  return result.value;
};

describe("M7 dialogue semantics conformance", () => {
  it("validates the versioned reference-resolution Decision Pack", () => {
    const valid = validateDecisionPack(referenceResolutionDecisionPack);
    expect(valid.ok).toBe(true);
  });

  it("classifies bounded dialogue acts and preserves follow-up fragments", () => {
    expect(parseDialogueTurnIntent("Please compare them.").acts[0]?.kind).toBe(
      "REQUEST",
    );
    expect(parseDialogueTurnIntent("Correction: use Rust.").acts[0]?.kind).toBe(
      "CORRECT",
    );
    expect(parseDialogueTurnIntent("I retract that claim.").acts[0]?.kind).toBe(
      "RETRACT",
    );
    expect(parseDialogueTurnIntent("Why?").acts[0]?.kind).toBe("ASK");

    const store = new InMemoryDialogueState([user, assistant]);
    const first = baseTurn(1, "user", "What should we use?");
    first.dialogueActs = [
      {
        kind: "ASK",
        contentRoots: [sid("proposition:language-choice")],
      },
    ];
    commit(store, {
      turn: first,
      questionChanges: [
        { kind: "open", question: openQuestion("question:language", 1) },
      ],
    });

    const parsed = parseDialogueTurnIntent("Rust.", store.snapshot());
    expect(parsed.fragment).toBe(true);
    expect(parsed.acts[0]?.kind).toBe("ANSWER");

    const follow = reconstructFollowUpFragment("And deployment?", store.snapshot());
    expect(follow.ok).toBe(true);
    if (follow.ok) {
      expect(follow.value.act.kind).toBe("CONTINUE");
      expect(follow.value.referencedQuestionId).toBe("question:language");
    }
  });

  it("reconstructs a one-word ellipsis answer and retains the literal fragment as provenance", () => {
    const store = new InMemoryDialogueState([user, assistant]);
    const first = baseTurn(1, "user", "Python or Rust?");
    first.dialogueActs = [
      { kind: "ASK", contentRoots: [sid("proposition:language-choice")] },
    ];
    commit(store, {
      turn: first,
      questionChanges: [
        { kind: "open", question: openQuestion("question:language", 1) },
      ],
    });

    const reconstructed = reconstructEllipsis("Rust.", store.snapshot());
    expect(reconstructed.ok).toBe(true);
    if (!reconstructed.ok) return;
    expect(reconstructed.value.status).toBe("resolved");
    expect(reconstructed.value.selectedChoiceId).toBe("rust");
    expect(reconstructed.value.reconstructedRoots).toEqual([
      sid("choice:rust"),
    ]);
    expect(reconstructed.value.provenance.literalFragment).toBe("Rust.");

    const answer = baseTurn(2, "assistant", "Rust.");
    answer.dialogueActs = [reconstructed.value.act];
    const after = commit(store, {
      turn: answer,
      questionChanges: [
        {
          kind: "answer",
          questionId: "question:language",
          answerRoots: reconstructed.value.reconstructedRoots,
          confidence: 1,
        },
      ],
    });
    expect(after.openQuestions).toHaveLength(0);
    expect(after.resolvedQuestions[0]).toMatchObject({
      id: "question:language",
      status: "answered",
      resolvedTurn: 2,
    });
  });

  it("keeps requests distinct from commitments and preserves correction/retraction history", () => {
    const store = new InMemoryDialogueState([user, assistant]);

    const request: RequestState = {
      id: "request:review",
      roots: [sid("goal:review")],
      requester: "user",
      addressee: "assistant",
      status: "open",
      introducedTurn: 0,
    };
    const t1 = baseTurn(1, "user", "Please review it.");
    t1.dialogueActs = [{ kind: "REQUEST", contentRoots: request.roots }];
    let snapshot = commit(store, {
      turn: t1,
      requestChanges: [{ kind: "open", request }],
    });
    expect(snapshot.activeRequests[0]?.status).toBe("open");
    expect(snapshot.commitments).toHaveLength(0);

    const t2 = baseTurn(2, "assistant", "I will review it.");
    t2.dialogueActs = [
      {
        kind: "ACCEPT",
        contentRoots: request.roots,
        targetRequestId: request.id,
      },
    ];
    const commitment: CommitmentState = {
      id: "commitment:review",
      participant: "assistant",
      roots: request.roots,
      requestId: request.id,
      status: "active",
      introducedTurn: 0,
    };
    t2.commitmentChanges = [{ kind: "add", commitment }];
    snapshot = commit(store, {
      turn: t2,
      requestChanges: [{ kind: "accept", requestId: request.id }],
    });
    expect(snapshot.activeRequests[0]?.status).toBe("accepted");
    expect(snapshot.commitments[0]?.requestId).toBe(request.id);

    const beforeCorrection = snapshot.revision;
    const t3 = baseTurn(3, "user", "Correction: use the new requirement.");
    t3.dialogueActs = [
      {
        kind: "CORRECT",
        contentRoots: [sid("claim:new")],
      },
    ];
    snapshot = commit(store, {
      turn: t3,
      corrections: [
        {
          id: "correction:1",
          kind: "replace-proposition",
          turnId: t3.id,
          targetRefs: [sid("claim:old")],
          replacementRefs: [sid("claim:new")],
        },
      ],
    });
    expect(snapshot.corrections[0]?.previousRevision).toBe(beforeCorrection);
    expect(snapshot.corrections[0]?.replacementRefs).toEqual([
      sid("claim:new"),
    ]);

    const t4 = baseTurn(4, "assistant", "I retract the old claim.");
    t4.dialogueActs = [
      {
        kind: "RETRACT",
        contentRoots: [sid("claim:obsolete")],
      },
    ];
    snapshot = commit(store, {
      turn: t4,
      corrections: [
        {
          id: "correction:2",
          kind: "retract-claim",
          turnId: t4.id,
          targetRefs: [sid("claim:obsolete")],
          replacementRefs: [],
        },
      ],
    });
    expect(snapshot.retractedClaims).toContain(sid("claim:obsolete"));

    const t5 = baseTurn(5, "assistant", "Done.");
    t5.commitmentChanges = [
      { kind: "fulfill", commitmentId: "commitment:review" },
    ];
    snapshot = commit(store, {
      turn: t5,
      requestChanges: [{ kind: "fulfill", requestId: request.id }],
    });
    expect(snapshot.activeRequests).toHaveLength(0);
    expect(snapshot.requestHistory[0]?.status).toBe("fulfilled");
    expect(snapshot.commitments).toHaveLength(0);
    expect(snapshot.commitmentHistory[0]?.status).toBe("fulfilled");
  });

  it("keeps a 20+ turn dialogue coherent across topic changes and resolves an entity introduced 10+ turns earlier", async () => {
    const store = new InMemoryDialogueState([user, assistant]);
    const oldEntity = sid("entity:atlas-service");
    const recentEntity = sid("entity:nova-service");

    const first = baseTurn(1, "user", "Atlas is the original service.");
    first.introducedEntities = [oldEntity];
    first.dialogueActs = [{ kind: "ASSERT", contentRoots: [oldEntity] }];
    first.topicChanges = [
      {
        kind: "push",
        topic: topic("topic:architecture", [oldEntity]),
      },
    ];
    commit(store, {
      turn: first,
      entityMentions: [
        {
          id: oldEntity,
          semanticType: "software-service",
          labels: ["Atlas"],
          introduced: true,
        },
      ],
    });

    for (let n = 2; n <= 8; n += 1) {
      const turn = baseTurn(n);
      commit(store, { turn });
    }

    const shift = baseTurn(9, "user", "Now deployment.");
    shift.topicChanges = [
      {
        kind: "push",
        topic: topic("topic:deployment"),
      },
    ];
    commit(store, { turn: shift });

    const introduceRecent = baseTurn(10, "assistant", "Nova is another service.");
    introduceRecent.introducedEntities = [recentEntity];
    introduceRecent.dialogueActs = [
      { kind: "ASSERT", contentRoots: [recentEntity] },
    ];
    commit(store, {
      turn: introduceRecent,
      entityMentions: [
        {
          id: recentEntity,
          semanticType: "software-service",
          labels: ["Nova"],
          introduced: true,
        },
      ],
    });

    for (let n = 11; n <= 13; n += 1) {
      const turn = baseTurn(n);
      commit(store, { turn });
    }

    const secondShift = baseTurn(14, "assistant", "Switch to testing.");
    secondShift.topicChanges = [
      {
        kind: "push",
        topic: topic("topic:testing"),
      },
    ];
    commit(store, { turn: secondShift });

    for (let n = 15; n <= 18; n += 1) {
      const turn = baseTurn(n);
      commit(store, { turn });
    }

    const reactivate = baseTurn(19, "user", "Back to deployment.");
    reactivate.topicChanges = [
      { kind: "activate", topicId: "topic:deployment" },
    ];
    commit(store, { turn: reactivate });

    for (let n = 20; n <= 21; n += 1) {
      const turn = baseTurn(n);
      commit(store, { turn });
    }

    const beforeReference = store.snapshot();
    expect(beforeReference.turnCount).toBe(21);
    expect(beforeReference.activeTopic).toBe("topic:deployment");
    expect(
      beforeReference.turnCount -
        (beforeReference.discourseEntities.find(
          (entity) => entity.id === oldEntity,
        )?.introducedTurn ?? beforeReference.turnCount),
    ).toBeGreaterThanOrEqual(10);

    const stateCandidates = referenceCandidatesFromState(beforeReference, {
      semanticType: "software-service",
    });
    expect(stateCandidates.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([oldEntity, recentEntity]),
    );

    const candidates = stateCandidates.map((entry, index) => ({
      id: entry.id,
      label: entry.labels[0] ?? String(entry.id),
      semanticType: entry.semanticType,
      recencyRank: index + 1,
    }));
    const oldIndex = candidates.findIndex(
      (candidate) => candidate.id === oldEntity,
    );
    expect(oldIndex).toBeGreaterThanOrEqual(0);

    const requestId = "dialogue:turn22:old-reference";
    const recorded: DecisionBatchResponse = {
      requestId,
      answers: [
        {
          questionId: "referent",
          type: "choice",
          selected: `candidate_${oldIndex}`,
          probabilities: Object.fromEntries(
            candidates.map((_, index) => [
              `candidate_${index}`,
              index === oldIndex ? 0.93 : 0.07,
            ]),
          ),
          confidence: 0.93,
          model: "recorded:jev",
          latencyMs: 1,
        },
      ],
      model: "recorded:jev",
      usage: { inputTokens: 20, outputTokens: 1, requests: 1 },
      traceId: createTraceId(),
      source: "recorded",
    };
    const runtime = new DecisionRuntime({
      adapter: new RecordedDecisionAdapter([recorded]),
      budget: { maxRequests: 1 },
    });

    const resolved = await resolveReference({
      requestId,
      mention: "that original service",
      candidates,
      runtime,
      modelProfile: "recorded:jev",
      minimumConfidence: 0.8,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.resolved).toBe(oldEntity);
    expect(resolved.value.source).toBe("jev");

    const last = baseTurn(22, "assistant", "That original service is Atlas.");
    last.referencedEntities = [oldEntity];
    last.dialogueActs = [
      { kind: "ANSWER", contentRoots: [oldEntity] },
    ];
    last.topicChanges = [
      { kind: "activate", topicId: "topic:architecture" },
    ];
    const finalState = commit(store, {
      turn: last,
      entityMentions: [
        {
          id: oldEntity,
          semanticType: "software-service",
          labels: ["Atlas"],
        },
      ],
    });

    expect(finalState.turnCount).toBe(22);
    expect(finalState.activeTopic).toBe("topic:architecture");
    expect(
      finalState.discourseEntities.find((entity) => entity.id === oldEntity)
        ?.lastMentionTurn,
    ).toBe(22);
    expect(store.revisionHistory()).toHaveLength(22);
  });


  it("compacts old surface turns while retaining dialogue semantics needed for future reference", () => {
    const store = new InMemoryDialogueState([user, assistant]);
    const entity = sid("entity:compaction-target");

    for (let n = 1; n <= 12; n += 1) {
      const turn = baseTurn(n);
      if (n === 1) {
        turn.introducedEntities = [entity];
        turn.topicChanges = [
          {
            kind: "push",
            topic: topic("topic:compaction", [entity]),
          },
        ];
        commit(store, {
          turn,
          entityMentions: [
            {
              id: entity,
              semanticType: "software-service",
              labels: ["CompactionTarget"],
              introduced: true,
            },
          ],
          questionChanges: [
            {
              kind: "open",
              question: {
                id: "question:retained",
                propositionRoots: [sid("proposition:retained")],
                asker: "user",
                addressee: "assistant",
                status: "open",
                answerRoots: [],
                introducedTurn: 0,
              },
            },
          ],
        });
      } else {
        commit(store, { turn });
      }
    }

    const before = store.snapshot();
    const compacted = store.compact(4);
    expect(compacted.ok).toBe(true);
    if (!compacted.ok) return;

    expect(compacted.value.turnCount).toBe(12);
    expect(compacted.value.archivedTurnCount).toBe(8);
    expect(compacted.value.turns).toHaveLength(4);
    expect(compacted.value.compactions).toHaveLength(1);
    expect(compacted.value.openQuestions[0]?.id).toBe("question:retained");
    expect(
      compacted.value.discourseEntities.some((entry) => entry.id === entity),
    ).toBe(true);
    expect(compacted.value.activeTopic).toBe("topic:compaction");
    expect(compacted.value.revision).not.toBe(before.revision);

    const next = baseTurn(13, "assistant", "It is still available.");
    next.referencedEntities = [entity];
    const after = commit(store, {
      turn: next,
      entityMentions: [
        {
          id: entity,
          semanticType: "software-service",
          labels: ["CompactionTarget"],
        },
      ],
    });
    expect(after.turnCount).toBe(13);
    expect(after.archivedTurnCount).toBe(8);
    expect(after.turns).toHaveLength(5);
  });

  it("keeps failed dialogue transactions atomic", () => {
    const store = new InMemoryDialogueState([user, assistant]);
    const before = store.snapshot();

    const turn = baseTurn(1, "user", "It is over there.");
    turn.referencedEntities = [sid("entity:missing")];
    const failed = store.commit(
      store.beginUpdate({
        turn,
        entityMentions: [
          {
            id: sid("entity:missing"),
            semanticType: "software-service",
          },
        ],
      }),
    );
    expect(failed.ok).toBe(false);
    expect(store.snapshot()).toEqual(before);
    expect(store.revision).toBe("dialogue:genesis");
  });
});
