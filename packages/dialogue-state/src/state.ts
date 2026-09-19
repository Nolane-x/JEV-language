import {
  canonicalJson,
  err,
  ok,
  sha256,
  StructuredError,
  type JsonValue,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";

export type DialogueActKind =
  | "ASK"
  | "ANSWER"
  | "ASSERT"
  | "CONFIRM"
  | "DENY"
  | "CORRECT"
  | "CLARIFY"
  | "REQUEST"
  | "OFFER"
  | "ACKNOWLEDGE"
  | "CONTINUE"
  | "SUMMARIZE"
  | "DEFINE"
  | "EXPLAIN"
  | "COMPARE"
  | "RETRACT"
  | "ACCEPT"
  | "DECLINE";

export interface DialogueAct {
  kind: DialogueActKind;
  contentRoots: SemanticId[];
  targetQuestionId?: string;
  targetRequestId?: string;
  metadata?: Record<string, JsonValue>;
}

export interface TopicState {
  id: string;
  rootConcepts: string[];
  relatedEntities: SemanticId[];
  introducedTurn: number;
  lastActiveTurn: number;
  parent?: string;
}

export interface TopicChange {
  kind: "push" | "activate" | "pop";
  topic?: TopicState;
  topicId?: string;
}

export interface CommitmentChange {
  kind: "add" | "fulfill" | "retract";
  commitment?: CommitmentState;
  commitmentId?: string;
}

export interface DialogueTurn {
  id: string;
  turnNumber: number;
  participant: string;
  sourceRef: string;
  literal?: string;
  parsedRoots: SemanticId[];
  dialogueActs: DialogueAct[];
  introducedEntities: SemanticId[];
  referencedEntities: SemanticId[];
  commitmentChanges: CommitmentChange[];
  topicChanges: TopicChange[];
}

export interface ParticipantState {
  id: string;
  label?: string;
}

export interface DiscourseEntityState {
  id: SemanticId;
  semanticType: string;
  labels: string[];
  introducedTurn: number;
  lastMentionTurn: number;
  mentionCount: number;
  salience: number;
  topicRefs: string[];
}

export interface QuestionChoice {
  id: string;
  label: string;
  semanticRoots: SemanticId[];
}

export interface QuestionState {
  id: string;
  propositionRoots: SemanticId[];
  asker: string;
  addressee?: string;
  status: "open" | "answered" | "withdrawn" | "superseded";
  answerRoots: SemanticId[];
  confidence?: number;
  introducedTurn: number;
  resolvedTurn?: number;
  choices?: QuestionChoice[];
}

export interface RequestState {
  id: string;
  roots: SemanticId[];
  requester: string;
  addressee?: string;
  status: "open" | "accepted" | "declined" | "fulfilled" | "withdrawn";
  introducedTurn: number;
  resolvedTurn?: number;
}

export interface CommitmentState {
  id: string;
  participant: string;
  roots: SemanticId[];
  requestId?: string;
  status: "active" | "fulfilled" | "retracted";
  introducedTurn: number;
  resolvedTurn?: number;
}

export type CorrectionKind =
  | "replace-proposition"
  | "replace-referent"
  | "replace-literal-value"
  | "narrow-interpretation"
  | "broaden-interpretation"
  | "retract-claim"
  | "repair-typo";

export interface CorrectionRecord {
  id: string;
  kind: CorrectionKind;
  turnId: string;
  targetRefs: SemanticId[];
  replacementRefs: SemanticId[];
  previousRevision: string;
  note?: string;
}

export interface UnresolvedReferenceState {
  id: string;
  mention: string;
  candidates: SemanticId[];
  introducedTurn: number;
}

export interface DialogueCompactionRecord {
  id: string;
  archivedTurnIds: string[];
  fromTurn: number;
  throughTurn: number;
  retainedCommitmentIds: string[];
  openQuestionIds: string[];
  retainedEntityIds: SemanticId[];
  revisionBefore: string;
  revisionAfter: string;
  activeTopic?: string;
}

export interface DialogueState {
  revision: string;
  parentRevision?: string;
  turnCount: number;
  archivedTurnCount: number;
  participants: ParticipantState[];
  activeTopic?: string;
  topicStack: string[];
  topics: TopicState[];
  discourseEntities: DiscourseEntityState[];
  openQuestions: QuestionState[];
  resolvedQuestions: QuestionState[];
  activeRequests: RequestState[];
  requestHistory: RequestState[];
  commitments: CommitmentState[];
  commitmentHistory: CommitmentState[];
  disputedClaims: SemanticId[];
  retractedClaims: SemanticId[];
  corrections: CorrectionRecord[];
  unresolvedReferences: UnresolvedReferenceState[];
  turns: DialogueTurn[];
  compactions: DialogueCompactionRecord[];
  styleContext?: JsonValue;
}

export type QuestionChange =
  | { kind: "open"; question: QuestionState }
  | {
      kind: "answer";
      questionId: string;
      answerRoots: SemanticId[];
      confidence?: number;
    }
  | { kind: "withdraw"; questionId: string }
  | { kind: "supersede"; questionId: string };

export type RequestChange =
  | { kind: "open"; request: RequestState }
  | { kind: "accept"; requestId: string }
  | { kind: "decline"; requestId: string }
  | { kind: "fulfill"; requestId: string }
  | { kind: "withdraw"; requestId: string };

export interface EntityMention {
  id: SemanticId;
  semanticType: string;
  labels?: string[];
  introduced?: boolean;
}

export interface DialogueUpdate {
  turn: DialogueTurn;
  entityMentions?: EntityMention[];
  questionChanges?: QuestionChange[];
  requestChanges?: RequestChange[];
  corrections?: Array<Omit<CorrectionRecord, "previousRevision">>;
  unresolvedReferences?: UnresolvedReferenceState[];
  resolvedReferenceIds?: string[];
}

export interface DialogueTransaction {
  baseRevision: string;
  update: DialogueUpdate;
}

export interface DialogueRevisionRecord {
  revision: string;
  parentRevision: string;
  turnId: string;
  turnNumber: number;
}

const emptyState = (
  participants: readonly ParticipantState[],
): DialogueState => ({
  revision: "dialogue:genesis",
  turnCount: 0,
  archivedTurnCount: 0,
  participants: participants.map((entry) => structuredClone(entry)),
  topicStack: [],
  topics: [],
  discourseEntities: [],
  openQuestions: [],
  resolvedQuestions: [],
  activeRequests: [],
  requestHistory: [],
  commitments: [],
  commitmentHistory: [],
  disputedClaims: [],
  retractedClaims: [],
  corrections: [],
  unresolvedReferences: [],
  turns: [],
  compactions: [],
});

const revisionPayload = (
  parentRevision: string,
  update: DialogueUpdate,
): JsonValue =>
  JSON.parse(
    JSON.stringify({
      parentRevision,
      turn: update.turn,
      entityMentions: update.entityMentions ?? [],
      questionChanges: update.questionChanges ?? [],
      requestChanges: update.requestChanges ?? [],
      corrections: update.corrections ?? [],
      unresolvedReferences: update.unresolvedReferences ?? [],
      resolvedReferenceIds: update.resolvedReferenceIds ?? [],
    }),
  ) as JsonValue;

const cloneState = (state: DialogueState): DialogueState =>
  structuredClone(state);

const participantExists = (
  state: DialogueState,
  participantId: string | undefined,
): boolean =>
  participantId === undefined ||
  state.participants.some((participant) => participant.id === participantId);

const byId = <T extends { id: string }>(
  values: readonly T[],
  id: string,
): T | undefined => values.find((entry) => entry.id === id);

const ensureUniqueIds = <T extends { id: string }>(
  values: readonly T[],
  code: string,
  label: string,
): Result<void> => {
  const ids = new Set<string>();
  for (const entry of values) {
    if (entry.id.trim() === "" || ids.has(entry.id)) {
      return err(
        new StructuredError(
          code,
          `${label} ids must be non-empty and unique; invalid id: ${entry.id}.`,
        ),
      );
    }
    ids.add(entry.id);
  }
  return ok(undefined);
};

export const validateDialogueState = (
  state: DialogueState,
): Result<DialogueState> => {
  if (!Number.isInteger(state.turnCount) || state.turnCount < 0) {
    return err(
      new StructuredError(
        "DIALOGUE_TURN_COUNT",
        "Dialogue turnCount must be a non-negative integer.",
      ),
    );
  }
  for (const [values, code, label] of [
    [state.participants, "DIALOGUE_PARTICIPANT_ID", "Participant"],
    [state.topics, "DIALOGUE_TOPIC_ID", "Topic"],
    [state.discourseEntities, "DIALOGUE_ENTITY_ID", "Discourse entity"],
    [state.openQuestions, "DIALOGUE_QUESTION_ID", "Open question"],
    [state.activeRequests, "DIALOGUE_REQUEST_ID", "Active request"],
    [state.commitments, "DIALOGUE_COMMITMENT_ID", "Commitment"],
    [state.corrections, "DIALOGUE_CORRECTION_ID", "Correction"],
    [state.unresolvedReferences, "DIALOGUE_REFERENCE_ID", "Unresolved reference"],
    [state.turns, "DIALOGUE_TURN_ID", "Turn"],
  ] as const) {
    const valid = ensureUniqueIds(values, code, label);
    if (!valid.ok) return valid;
  }

  if (
    !Number.isInteger(state.archivedTurnCount) ||
    state.archivedTurnCount < 0
  ) {
    return err(
      new StructuredError(
        "DIALOGUE_ARCHIVED_TURN_COUNT",
        "archivedTurnCount must be a non-negative integer.",
      ),
    );
  }
  if (state.turns.length + state.archivedTurnCount !== state.turnCount) {
    return err(
      new StructuredError(
        "DIALOGUE_TURN_HISTORY",
        "turnCount must equal archivedTurnCount plus retained turn history length.",
      ),
    );
  }
  const archivedIds = state.compactions.flatMap(
    (record) => record.archivedTurnIds,
  );
  if (archivedIds.length !== state.archivedTurnCount) {
    return err(
      new StructuredError(
        "DIALOGUE_COMPACTION_COUNT",
        "Compaction archive ids must account for every archived turn.",
      ),
    );
  }
  if (new Set(archivedIds).size !== archivedIds.length) {
    return err(
      new StructuredError(
        "DIALOGUE_COMPACTION_DUPLICATE",
        "A turn may be archived by at most one compaction record.",
      ),
    );
  }

  const topicIds = new Set(state.topics.map((topic) => topic.id));
  for (const topicId of state.topicStack) {
    if (!topicIds.has(topicId)) {
      return err(
        new StructuredError(
          "DIALOGUE_TOPIC_STACK",
          `Topic stack references missing topic ${topicId}.`,
        ),
      );
    }
  }
  if (
    state.activeTopic !== undefined &&
    !topicIds.has(state.activeTopic)
  ) {
    return err(
      new StructuredError(
        "DIALOGUE_ACTIVE_TOPIC",
        `Active topic does not exist: ${state.activeTopic}.`,
      ),
    );
  }

  const participantIds = new Set(
    state.participants.map((participant) => participant.id),
  );
  for (const question of [
    ...state.openQuestions,
    ...state.resolvedQuestions,
  ]) {
    if (!participantIds.has(question.asker)) {
      return err(
        new StructuredError(
          "DIALOGUE_QUESTION_ASKER",
          `Question ${question.id} has unknown asker ${question.asker}.`,
        ),
      );
    }
    if (
      question.addressee !== undefined &&
      !participantIds.has(question.addressee)
    ) {
      return err(
        new StructuredError(
          "DIALOGUE_QUESTION_ADDRESSEE",
          `Question ${question.id} has unknown addressee ${question.addressee}.`,
        ),
      );
    }
  }
  for (const request of [
    ...state.activeRequests,
    ...state.requestHistory,
  ]) {
    if (!participantIds.has(request.requester)) {
      return err(
        new StructuredError(
          "DIALOGUE_REQUEST_REQUESTER",
          `Request ${request.id} has unknown requester ${request.requester}.`,
        ),
      );
    }
    if (
      request.addressee !== undefined &&
      !participantIds.has(request.addressee)
    ) {
      return err(
        new StructuredError(
          "DIALOGUE_REQUEST_ADDRESSEE",
          `Request ${request.id} has unknown addressee ${request.addressee}.`,
        ),
      );
    }
  }
  for (const commitment of [
    ...state.commitments,
    ...state.commitmentHistory,
  ]) {
    if (!participantIds.has(commitment.participant)) {
      return err(
        new StructuredError(
          "DIALOGUE_COMMITMENT_PARTICIPANT",
          `Commitment ${commitment.id} has unknown participant ${commitment.participant}.`,
        ),
      );
    }
  }

  return ok(cloneState(state));
};

const applyTopicChanges = (
  state: DialogueState,
  changes: readonly TopicChange[],
  turnNumber: number,
): Result<void> => {
  for (const change of changes) {
    if (change.kind === "push") {
      if (change.topic === undefined) {
        return err(
          new StructuredError(
            "DIALOGUE_TOPIC_PUSH",
            "Topic push requires a topic record.",
          ),
        );
      }
      if (byId(state.topics, change.topic.id) !== undefined) {
        return err(
          new StructuredError(
            "DIALOGUE_TOPIC_DUPLICATE",
            `Topic already exists: ${change.topic.id}.`,
          ),
        );
      }
      if (
        change.topic.parent !== undefined &&
        byId(state.topics, change.topic.parent) === undefined
      ) {
        return err(
          new StructuredError(
            "DIALOGUE_TOPIC_PARENT",
            `Topic ${change.topic.id} references missing parent ${change.topic.parent}.`,
          ),
        );
      }
      const topic = structuredClone(change.topic);
      topic.introducedTurn = turnNumber;
      topic.lastActiveTurn = turnNumber;
      state.topics.push(topic);
      state.topicStack.push(topic.id);
      state.activeTopic = topic.id;
      continue;
    }

    if (change.kind === "activate") {
      if (
        change.topicId === undefined ||
        byId(state.topics, change.topicId) === undefined
      ) {
        return err(
          new StructuredError(
            "DIALOGUE_TOPIC_ACTIVATE",
            "Topic activation requires an existing topic id.",
          ),
        );
      }
      state.topicStack = state.topicStack.filter(
        (topicId) => topicId !== change.topicId,
      );
      state.topicStack.push(change.topicId);
      state.activeTopic = change.topicId;
      const topic = byId(state.topics, change.topicId);
      if (topic !== undefined) topic.lastActiveTurn = turnNumber;
      continue;
    }

    if (state.topicStack.length === 0) {
      return err(
        new StructuredError(
          "DIALOGUE_TOPIC_POP",
          "Cannot pop an empty topic stack.",
        ),
      );
    }
    state.topicStack.pop();
    const nextActive = state.topicStack.at(-1);
    if (nextActive === undefined) {
      delete state.activeTopic;
    } else {
      state.activeTopic = nextActive;
    }
  }
  return ok(undefined);
};

const applyEntityMentions = (
  state: DialogueState,
  mentions: readonly EntityMention[],
  turn: DialogueTurn,
): Result<void> => {
  const mentioned = new Set(turn.referencedEntities);
  const introduced = new Set(turn.introducedEntities);

  for (const entity of state.discourseEntities) {
    entity.salience = Math.max(0, entity.salience * 0.82);
  }

  for (const mention of mentions) {
    let entity = byId(state.discourseEntities, mention.id);
    if (entity === undefined) {
      if (mention.introduced !== true && !introduced.has(mention.id)) {
        return err(
          new StructuredError(
            "DIALOGUE_REFERENCE_UNKNOWN",
            `Turn references unknown discourse entity ${mention.id}.`,
          ),
        );
      }
      entity = {
        id: mention.id,
        semanticType: mention.semanticType,
        labels: [...(mention.labels ?? [])],
        introducedTurn: turn.turnNumber,
        lastMentionTurn: turn.turnNumber,
        mentionCount: 0,
        salience: 0,
        topicRefs:
          state.activeTopic === undefined ? [] : [state.activeTopic],
      };
      state.discourseEntities.push(entity);
    } else if (entity.semanticType !== mention.semanticType) {
      return err(
        new StructuredError(
          "DIALOGUE_ENTITY_TYPE_DRIFT",
          `Entity ${mention.id} changed semantic type from ${entity.semanticType} to ${mention.semanticType}.`,
        ),
      );
    }

    entity.labels = [
      ...new Set([...entity.labels, ...(mention.labels ?? [])]),
    ];
    entity.lastMentionTurn = turn.turnNumber;
    entity.mentionCount += 1;
    entity.salience += introduced.has(mention.id) ? 1.25 : 1;
    if (
      state.activeTopic !== undefined &&
      !entity.topicRefs.includes(state.activeTopic)
    ) {
      entity.topicRefs.push(state.activeTopic);
    }
    mentioned.delete(mention.id);
    introduced.delete(mention.id);
  }

  for (const id of [...mentioned, ...introduced]) {
    if (byId(state.discourseEntities, id) === undefined) {
      return err(
        new StructuredError(
          "DIALOGUE_ENTITY_MENTION_MISSING",
          `Turn entity ${id} lacks an EntityMention descriptor.`,
        ),
      );
    }
    const entity = byId(state.discourseEntities, id)!;
    entity.lastMentionTurn = turn.turnNumber;
    entity.mentionCount += 1;
    entity.salience += 1;
  }

  return ok(undefined);
};

const applyQuestionChanges = (
  state: DialogueState,
  changes: readonly QuestionChange[],
  turnNumber: number,
): Result<void> => {
  for (const change of changes) {
    if (change.kind === "open") {
      if (
        byId(state.openQuestions, change.question.id) !== undefined ||
        byId(state.resolvedQuestions, change.question.id) !== undefined
      ) {
        return err(
          new StructuredError(
            "DIALOGUE_QUESTION_DUPLICATE",
            `Question already exists: ${change.question.id}.`,
          ),
        );
      }
      const question = structuredClone(change.question);
      question.status = "open";
      question.introducedTurn = turnNumber;
      question.answerRoots = [];
      delete question.resolvedTurn;
      state.openQuestions.push(question);
      continue;
    }

    const index = state.openQuestions.findIndex(
      (question) => question.id === change.questionId,
    );
    if (index < 0) {
      return err(
        new StructuredError(
          "DIALOGUE_QUESTION_NOT_OPEN",
          `Question is not open: ${change.questionId}.`,
        ),
      );
    }
    const question = state.openQuestions[index]!;
    state.openQuestions.splice(index, 1);
    if (change.kind === "answer") {
      question.status = "answered";
      question.answerRoots = [...change.answerRoots];
      if (change.confidence !== undefined) {
        question.confidence = change.confidence;
      }
    } else {
      question.status =
        change.kind === "withdraw" ? "withdrawn" : "superseded";
    }
    question.resolvedTurn = turnNumber;
    state.resolvedQuestions.push(question);
  }
  return ok(undefined);
};

const applyRequestChanges = (
  state: DialogueState,
  changes: readonly RequestChange[],
  turnNumber: number,
): Result<void> => {
  for (const change of changes) {
    if (change.kind === "open") {
      if (
        byId(state.activeRequests, change.request.id) !== undefined ||
        byId(state.requestHistory, change.request.id) !== undefined
      ) {
        return err(
          new StructuredError(
            "DIALOGUE_REQUEST_DUPLICATE",
            `Request already exists: ${change.request.id}.`,
          ),
        );
      }
      const request = structuredClone(change.request);
      request.status = "open";
      request.introducedTurn = turnNumber;
      delete request.resolvedTurn;
      state.activeRequests.push(request);
      continue;
    }

    const index = state.activeRequests.findIndex(
      (request) => request.id === change.requestId,
    );
    if (index < 0) {
      return err(
        new StructuredError(
          "DIALOGUE_REQUEST_NOT_OPEN",
          `Request is not active: ${change.requestId}.`,
        ),
      );
    }
    const request = state.activeRequests[index]!;
    if (change.kind === "accept") {
      request.status = "accepted";
      continue;
    }

    state.activeRequests.splice(index, 1);
    request.status =
      change.kind === "decline"
        ? "declined"
        : change.kind === "fulfill"
          ? "fulfilled"
          : "withdrawn";
    request.resolvedTurn = turnNumber;
    state.requestHistory.push(request);
  }
  return ok(undefined);
};

const applyCommitmentChanges = (
  state: DialogueState,
  changes: readonly CommitmentChange[],
  turnNumber: number,
): Result<void> => {
  for (const change of changes) {
    if (change.kind === "add") {
      if (change.commitment === undefined) {
        return err(
          new StructuredError(
            "DIALOGUE_COMMITMENT_ADD",
            "Commitment add requires a commitment record.",
          ),
        );
      }
      if (
        byId(state.commitments, change.commitment.id) !== undefined ||
        byId(state.commitmentHistory, change.commitment.id) !== undefined
      ) {
        return err(
          new StructuredError(
            "DIALOGUE_COMMITMENT_DUPLICATE",
            `Commitment already exists: ${change.commitment.id}.`,
          ),
        );
      }
      if (change.commitment.requestId !== undefined) {
        const request =
          byId(state.activeRequests, change.commitment.requestId) ??
          byId(state.requestHistory, change.commitment.requestId);
        if (request?.status !== "accepted") {
          return err(
            new StructuredError(
              "DIALOGUE_COMMITMENT_REQUEST",
              `Commitment ${change.commitment.id} requires an accepted request.`,
            ),
          );
        }
      }
      const commitment = structuredClone(change.commitment);
      commitment.status = "active";
      commitment.introducedTurn = turnNumber;
      delete commitment.resolvedTurn;
      state.commitments.push(commitment);
      continue;
    }

    if (change.commitmentId === undefined) {
      return err(
        new StructuredError(
          "DIALOGUE_COMMITMENT_CHANGE",
          "Commitment fulfill/retract requires commitmentId.",
        ),
      );
    }
    const index = state.commitments.findIndex(
      (commitment) => commitment.id === change.commitmentId,
    );
    if (index < 0) {
      return err(
        new StructuredError(
          "DIALOGUE_COMMITMENT_NOT_ACTIVE",
          `Commitment is not active: ${change.commitmentId}.`,
        ),
      );
    }
    const commitment = state.commitments[index]!;
    state.commitments.splice(index, 1);
    commitment.status =
      change.kind === "fulfill" ? "fulfilled" : "retracted";
    commitment.resolvedTurn = turnNumber;
    state.commitmentHistory.push(commitment);
  }
  return ok(undefined);
};

const applyCorrections = (
  state: DialogueState,
  corrections: readonly Array<Omit<CorrectionRecord, "previousRevision">>,
  previousRevision: string,
): Result<void> => {
  for (const input of corrections) {
    if (state.corrections.some((record) => record.id === input.id)) {
      return err(
        new StructuredError(
          "DIALOGUE_CORRECTION_DUPLICATE",
          `Correction already exists: ${input.id}.`,
        ),
      );
    }
    const record: CorrectionRecord = {
      ...structuredClone(input),
      previousRevision,
    };
    state.corrections.push(record);
    if (record.kind === "retract-claim") {
      for (const ref of record.targetRefs) {
        if (!state.retractedClaims.includes(ref)) {
          state.retractedClaims.push(ref);
        }
      }
    }
  }
  return ok(undefined);
};

const applyUnresolvedReferences = (
  state: DialogueState,
  additions: readonly UnresolvedReferenceState[],
  resolvedIds: readonly string[],
): Result<void> => {
  const resolved = new Set(resolvedIds);
  state.unresolvedReferences = state.unresolvedReferences.filter(
    (reference) => !resolved.has(reference.id),
  );
  for (const reference of additions) {
    if (
      state.unresolvedReferences.some((entry) => entry.id === reference.id)
    ) {
      return err(
        new StructuredError(
          "DIALOGUE_REFERENCE_DUPLICATE",
          `Unresolved reference already exists: ${reference.id}.`,
        ),
      );
    }
    state.unresolvedReferences.push(structuredClone(reference));
  }
  return ok(undefined);
};

export const referenceCandidatesFromState = (
  state: DialogueState,
  input: {
    semanticType?: string;
    topicId?: string;
    maxCandidates?: number;
  } = {},
): DiscourseEntityState[] => {
  const maxCandidates = input.maxCandidates ?? 8;
  return state.discourseEntities
    .filter(
      (entity) =>
        (input.semanticType === undefined ||
          entity.semanticType === input.semanticType) &&
        (input.topicId === undefined ||
          entity.topicRefs.includes(input.topicId)),
    )
    .sort(
      (left, right) =>
        right.salience - left.salience ||
        right.lastMentionTurn - left.lastMentionTurn ||
        left.id.localeCompare(right.id),
    )
    .slice(0, maxCandidates)
    .map((entity) => structuredClone(entity));
};

export class InMemoryDialogueState {
  #state: DialogueState;
  readonly #revisions: DialogueRevisionRecord[] = [];

  constructor(participants: readonly ParticipantState[]) {
    const initial = emptyState(participants);
    const valid = validateDialogueState(initial);
    if (!valid.ok) throw valid.error;
    this.#state = initial;
  }

  get revision(): string {
    return this.#state.revision;
  }

  snapshot(): DialogueState {
    return cloneState(this.#state);
  }

  revisionHistory(): DialogueRevisionRecord[] {
    return this.#revisions.map((entry) => structuredClone(entry));
  }

  beginUpdate(update: DialogueUpdate): DialogueTransaction {
    return {
      baseRevision: this.#state.revision,
      update: structuredClone(update),
    };
  }

  rollback(transaction: DialogueTransaction): Result<DialogueState> {
    if (transaction.baseRevision !== this.#state.revision) {
      return err(
        new StructuredError(
          "DIALOGUE_STALE_TRANSACTION",
          "Dialogue transaction base revision no longer matches current state.",
        ),
      );
    }
    return ok(this.snapshot());
  }

  compact(retainLastTurns = 8): Result<DialogueState> {
    if (
      !Number.isInteger(retainLastTurns) ||
      retainLastTurns < 0
    ) {
      return err(
        new StructuredError(
          "DIALOGUE_COMPACTION_RETAIN",
          "retainLastTurns must be a non-negative integer.",
        ),
      );
    }

    const archiveCount = Math.max(
      0,
      this.#state.turns.length - retainLastTurns,
    );
    if (archiveCount === 0) return ok(this.snapshot());

    const previous = this.#state;
    const candidate = cloneState(previous);
    const archived = candidate.turns.slice(0, archiveCount);
    const retained = candidate.turns.slice(archiveCount);
    const first = archived[0];
    const last = archived.at(-1);
    if (first === undefined || last === undefined) {
      return ok(this.snapshot());
    }

    candidate.turns = retained;
    candidate.archivedTurnCount += archived.length;
    const revisionBefore = previous.revision;
    const recordId = `compaction:${candidate.compactions.length + 1}`;
    const payload = {
      recordId,
      archivedTurnIds: archived.map((turn) => turn.id),
      fromTurn: first.turnNumber,
      throughTurn: last.turnNumber,
      retainedCommitmentIds: candidate.commitments.map(
        (commitment) => commitment.id,
      ),
      openQuestionIds: candidate.openQuestions.map(
        (question) => question.id,
      ),
      retainedEntityIds: candidate.discourseEntities.map(
        (entity) => entity.id,
      ),
      activeTopic: candidate.activeTopic ?? null,
      revisionBefore,
    } as unknown as JsonValue;
    const revisionAfter =
      "dialogue:" +
      sha256(canonicalJson(payload)).slice("sha256:".length);

    const record: DialogueCompactionRecord = {
      id: recordId,
      archivedTurnIds: archived.map((turn) => turn.id),
      fromTurn: first.turnNumber,
      throughTurn: last.turnNumber,
      retainedCommitmentIds: candidate.commitments.map(
        (commitment) => commitment.id,
      ),
      openQuestionIds: candidate.openQuestions.map(
        (question) => question.id,
      ),
      retainedEntityIds: candidate.discourseEntities.map(
        (entity) => entity.id,
      ),
      revisionBefore,
      revisionAfter,
      ...(candidate.activeTopic === undefined
        ? {}
        : { activeTopic: candidate.activeTopic }),
    };
    candidate.compactions.push(record);
    candidate.parentRevision = revisionBefore;
    candidate.revision = revisionAfter;

    const valid = validateDialogueState(candidate);
    if (!valid.ok) return valid;

    this.#state = candidate;
    this.#revisions.push({
      revision: revisionAfter,
      parentRevision: revisionBefore,
      turnId: recordId,
      turnNumber: candidate.turnCount,
    });
    return ok(this.snapshot());
  }


  commit(transaction: DialogueTransaction): Result<DialogueState> {
    if (transaction.baseRevision !== this.#state.revision) {
      return err(
        new StructuredError(
          "DIALOGUE_STALE_TRANSACTION",
          "Dialogue transaction base revision no longer matches current state.",
        ),
      );
    }

    const previous = this.#state;
    const candidate = cloneState(previous);
    const update = structuredClone(transaction.update);
    const turn = update.turn;

    if (turn.turnNumber !== previous.turnCount + 1) {
      return err(
        new StructuredError(
          "DIALOGUE_TURN_ORDER",
          `Expected turn ${previous.turnCount + 1}, received ${turn.turnNumber}.`,
        ),
      );
    }
    const archivedTurnIds = new Set(
      previous.compactions.flatMap((record) => record.archivedTurnIds),
    );
    if (
      previous.turns.some((entry) => entry.id === turn.id) ||
      archivedTurnIds.has(turn.id)
    ) {
      return err(
        new StructuredError(
          "DIALOGUE_TURN_DUPLICATE",
          `Dialogue turn already exists: ${turn.id}.`,
        ),
      );
    }
    if (!participantExists(candidate, turn.participant)) {
      return err(
        new StructuredError(
          "DIALOGUE_TURN_PARTICIPANT",
          `Dialogue turn uses unknown participant ${turn.participant}.`,
        ),
      );
    }

    const correctionResult = applyCorrections(
      candidate,
      update.corrections ?? [],
      previous.revision,
    );
    if (!correctionResult.ok) return correctionResult;

    const topicResult = applyTopicChanges(
      candidate,
      turn.topicChanges,
      turn.turnNumber,
    );
    if (!topicResult.ok) return topicResult;

    const questionResult = applyQuestionChanges(
      candidate,
      update.questionChanges ?? [],
      turn.turnNumber,
    );
    if (!questionResult.ok) return questionResult;

    const requestResult = applyRequestChanges(
      candidate,
      update.requestChanges ?? [],
      turn.turnNumber,
    );
    if (!requestResult.ok) return requestResult;

    const commitmentResult = applyCommitmentChanges(
      candidate,
      turn.commitmentChanges,
      turn.turnNumber,
    );
    if (!commitmentResult.ok) return commitmentResult;

    // Salience is updated after topic/question/request/commitment state so
    // mentions in this turn attach to the newly active discourse context.
    const entityResult = applyEntityMentions(
      candidate,
      update.entityMentions ?? [],
      turn,
    );
    if (!entityResult.ok) return entityResult;

    const referenceResult = applyUnresolvedReferences(
      candidate,
      update.unresolvedReferences ?? [],
      update.resolvedReferenceIds ?? [],
    );
    if (!referenceResult.ok) return referenceResult;

    candidate.turnCount = turn.turnNumber;
    candidate.turns.push(turn);
    candidate.parentRevision = previous.revision;
    candidate.revision =
      "dialogue:" +
      sha256(canonicalJson(revisionPayload(previous.revision, update))).slice(
        "sha256:".length,
      );

    const valid = validateDialogueState(candidate);
    if (!valid.ok) return valid;

    this.#state = candidate;
    this.#revisions.push({
      revision: candidate.revision,
      parentRevision: previous.revision,
      turnId: turn.id,
      turnNumber: turn.turnNumber,
    });
    return ok(this.snapshot());
  }
}
