import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type { GraphOperation } from "../../semantic-graph/src/index.ts";

export interface IncrementalSemanticBoundary {
  committedThroughToken: number;
  committedOperations: GraphOperation[];
  provisionalOperations: GraphOperation[];
}

export interface IncrementalParseSnapshot {
  id: string;
  language: string;
  revision: number;
  tokens: string[];
  semantic: IncrementalSemanticBoundary;
}

export class IncrementalUtteranceParseState {
  readonly #id: string;
  readonly #language: string;
  #revision = 0;
  readonly #tokens: string[] = [];
  #committedThroughToken = 0;
  #committedOperations: GraphOperation[] = [];
  #provisionalOperations: GraphOperation[] = [];

  constructor(id: string, language: string) {
    if (id.trim() === "" || language.trim() === "") {
      throw new StructuredError(
        "PARSER_INCREMENTAL_ID",
        "Incremental parse state requires id and language.",
      );
    }
    this.#id = id;
    this.#language = language;
  }

  appendToken(surface: string): Result<number> {
    if (surface.length === 0) {
      return err(
        new StructuredError(
          "PARSER_INCREMENTAL_EMPTY_TOKEN",
          "Incremental parse tokens must preserve a non-empty surface.",
        ),
      );
    }
    this.#tokens.push(surface);
    this.#revision += 1;
    return ok(this.#tokens.length);
  }

  replaceProvisionalSemantic(
    operations: readonly GraphOperation[],
  ): Result<void> {
    this.#provisionalOperations = structuredClone([...operations]);
    this.#revision += 1;
    return ok(undefined);
  }

  commitSemanticBoundary(input: {
    throughToken: number;
    operations: readonly GraphOperation[];
  }): Result<void> {
    if (
      !Number.isInteger(input.throughToken) ||
      input.throughToken < this.#committedThroughToken ||
      input.throughToken > this.#tokens.length
    ) {
      return err(
        new StructuredError(
          "PARSER_INCREMENTAL_COMMIT_BOUNDARY",
          "Committed semantic boundaries must advance monotonically within the observed token prefix.",
        ),
      );
    }
    this.#committedThroughToken = input.throughToken;
    this.#committedOperations = structuredClone([...input.operations]);
    this.#provisionalOperations = [];
    this.#revision += 1;
    return ok(undefined);
  }

  snapshot(): IncrementalParseSnapshot {
    return {
      id: this.#id,
      language: this.#language,
      revision: this.#revision,
      tokens: [...this.#tokens],
      semantic: {
        committedThroughToken: this.#committedThroughToken,
        committedOperations: structuredClone(this.#committedOperations),
        provisionalOperations: structuredClone(this.#provisionalOperations),
      },
    };
  }
}

export type ParserRecoveryKind =
  | "skip-token"
  | "insert-expected"
  | "close-constituent"
  | "preserve-hole"
  | "fallback-unknown";

export interface ParserRecoveryDiagnostic {
  code: "PARSER_RECOVERY";
  tokenStart: number;
  tokenEnd: number;
  unexpectedSurface?: string;
  expected: string[];
  recovery: ParserRecoveryKind;
  message: string;
  committedSemanticSafe: boolean;
}

export const createParserRecoveryDiagnostic = (input: {
  tokenStart: number;
  tokenEnd: number;
  unexpectedSurface?: string;
  expected?: readonly string[];
  recovery: ParserRecoveryKind;
  message: string;
  committedSemanticSafe: boolean;
}): Result<ParserRecoveryDiagnostic> => {
  if (
    !Number.isInteger(input.tokenStart) ||
    !Number.isInteger(input.tokenEnd) ||
    input.tokenStart < 0 ||
    input.tokenEnd < input.tokenStart ||
    input.message.trim() === "" ||
    (input.unexpectedSurface !== undefined &&
      input.unexpectedSurface.length === 0)
  ) {
    return err(
      new StructuredError(
        "PARSER_RECOVERY_DIAGNOSTIC_INVALID",
        "Parser recovery diagnostics require valid token bounds and an inspectable message.",
      ),
    );
  }
  return ok({
    code: "PARSER_RECOVERY",
    tokenStart: input.tokenStart,
    tokenEnd: input.tokenEnd,
    ...(input.unexpectedSurface === undefined
      ? {}
      : { unexpectedSurface: input.unexpectedSurface }),
    expected: [...new Set(input.expected ?? [])].sort(),
    recovery: input.recovery,
    message: input.message,
    committedSemanticSafe: input.committedSemanticSafe,
  });
};
