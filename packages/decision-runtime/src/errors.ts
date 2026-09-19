import {
  StructuredError,
  type JsonValue,
} from "../../core-types/src/index.ts";

export type JdrErrorCode =
  | "JDR_TIMEOUT"
  | "JDR_AUTH"
  | "JDR_RATE_LIMIT"
  | "JDR_INVALID_REQUEST"
  | "JDR_SCHEMA_MISMATCH"
  | "JDR_MISSING_ANSWER"
  | "JDR_INVALID_PROBABILITY"
  | "JDR_PROVIDER_ERROR"
  | "JDR_CANCELLED"
  | "JDR_BUDGET_EXCEEDED"
  | "JDR_REPLAY_MISS";

export class JdrError extends StructuredError {
  declare readonly code: JdrErrorCode;

  constructor(code: JdrErrorCode, message: string, details?: JsonValue) {
    super(code, message, details);
    this.name = "JdrError";
    this.code = code;
  }
}
