import type {
  JsonValue,
  TraceId,
} from "../../core-types/src/index.ts";

export type DecisionEntry =
  | string
  | { [key: string]: JsonValue }
  | JsonValue[]
  | null;

export type DecisionState = DecisionEntry;
export type DecisionInstruction = DecisionEntry;

export interface CandidateDescriptor {
  description: DecisionInstruction;
  metadata?: { [key: string]: JsonValue };
}

export interface NoulQuestion {
  type: "noul";
  instruction: DecisionInstruction;
  criteria?: {
    true?: DecisionInstruction;
    false?: DecisionInstruction;
  };
  calibrationProfile?: string;
}

export interface ChoiceQuestion {
  type: "choice";
  instruction: DecisionInstruction;
  options: Record<string, CandidateDescriptor | null>;
  calibrationProfile?: string;
}

export interface ScoreQuestion {
  type: "score";
  instruction: DecisionInstruction;
  levels: readonly [
    DecisionInstruction,
    DecisionInstruction,
    ...DecisionInstruction[],
  ];
  calibrationProfile?: string;
}

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface DecisionBatchRequest {
  id: string;
  modelProfile: string;
  state: DecisionState;
  questions: Record<string, DecisionQuestion>;
  deadlineMs?: number;
  traceContext?: {
    traceId: TraceId;
    parentSpan?: string;
  };
}

export interface DecisionAnswer {
  questionId: string;
  type: "noul" | "choice" | "score";
  selected: boolean | string | number;
  probabilities: Record<string, number>;
  confidence?: number;
  raw?: JsonValue;
  model: string;
  latencyMs: number;
}

export interface DecisionUsage {
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export interface DecisionBatchResponse {
  requestId: string;
  answers: DecisionAnswer[];
  model: string;
  usage: DecisionUsage;
  traceId: TraceId;
  source: "live" | "recorded" | "cache";
}

export interface DecisionProviderAdapter {
  readonly id: string;
  execute(
    request: DecisionBatchRequest,
    signal?: AbortSignal,
  ): Promise<DecisionBatchResponse>;
}

export interface DecisionBudget {
  maxRequests: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
}

export interface DecisionBudgetUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export type DecisionTraceEvent =
  | {
      kind: "cache-hit";
      requestId: string;
      traceId: TraceId;
      adapterId: string;
    }
  | {
      kind: "request-start";
      requestId: string;
      traceId: TraceId;
      adapterId: string;
      requestNumber: number;
    }
  | {
      kind: "request-complete";
      requestId: string;
      traceId: TraceId;
      adapterId: string;
      usage: DecisionUsage;
    }
  | {
      kind: "request-failed";
      requestId: string;
      traceId: TraceId;
      adapterId: string;
      errorCode: string;
    };

export type DecisionTraceSink = (event: DecisionTraceEvent) => void;

export interface DecisionCache {
  get(key: string): DecisionBatchResponse | undefined;
  set(key: string, value: DecisionBatchResponse): void;
}
