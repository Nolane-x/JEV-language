import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
  type TraceId,
} from "../../core-types/src/index.ts";
import type {
  JsgGraph,
  SemanticRef,
} from "../../semantic-graph/src/index.ts";
import type { DiscoursePlan } from "../../discourse-ir/src/index.ts";
import type { PirProgram } from "../../program-ir/src/index.ts";
import type {
  ActionIR,
  CapabilityDefinition,
} from "../../action-ir/src/index.ts";
import type {
  CommandIr,
  DataIr,
  LogicIr,
  MathIr,
  QueryIr,
  SchemaIr,
} from "../../formal-ir/src/index.ts";

export type ExpressionTarget =
  | "natural-language"
  | "program"
  | "structured-data"
  | "schema"
  | "query"
  | "math"
  | "logic"
  | "command"
  | "action";

export type ExpressionInput =
  | { kind: "text"; text: string; language?: string }
  | { kind: "semantic-ref"; ref: SemanticRef }
  | { kind: "semantic-graph"; graph: JsgGraph }
  | { kind: "artifact"; artifact: ExpressionArtifact };

export interface ExpressionGoal {
  kind:
    | "parse"
    | "realize"
    | "express"
    | "transform"
    | "verify"
    | "explain"
    | "other";
  semanticRoots?: SemanticRef[];
  annotations?: Record<string, JsonValue>;
}

export interface ExpressionConstraint {
  code: string;
  value?: JsonValue;
  hard: boolean;
}

export interface ExpressionRequest {
  input?: ExpressionInput;
  semanticState?: JsgGraph;
  goal: ExpressionGoal;
  target: ExpressionTarget;
  language?: string;
  constraints?: ExpressionConstraint[];
  availableCapabilities?: CapabilityDefinition[];
  contextRefs?: SemanticRef[];
}

export type ExpressionArtifact =
  | {
      artifactType: "text";
      text: string;
      language?: string;
      semanticRefs?: SemanticRef[];
      discoursePlan?: DiscoursePlan;
    }
  | { artifactType: "program"; program: PirProgram; semanticRefs?: SemanticRef[] }
  | {
      artifactType: "structured-data";
      data: DataIr;
      schema?: SchemaIr;
      semanticRefs?: SemanticRef[];
    }
  | { artifactType: "schema"; schema: SchemaIr; semanticRefs?: SemanticRef[] }
  | { artifactType: "query"; query: QueryIr; semanticRefs?: SemanticRef[] }
  | { artifactType: "math"; math: MathIr; semanticRefs?: SemanticRef[] }
  | { artifactType: "logic"; logic: LogicIr; semanticRefs?: SemanticRef[] }
  | { artifactType: "command"; command: CommandIr; semanticRefs?: SemanticRef[] }
  | { artifactType: "action"; action: ActionIR; semanticRefs?: SemanticRef[] };

export interface Diagnostic {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  details?: JsonValue;
}

export type EvidenceRef = SemanticRef;
export type ProvenanceRef = SemanticRef;

export interface ResultEnvelope<T> {
  status: "ok" | "partial" | "ambiguous" | "unsupported" | "error";
  value?: T;
  alternatives?: T[];
  diagnostics: Diagnostic[];
  evidence: EvidenceRef[];
  provenance: ProvenanceRef[];
  trace?: TraceId;
}

export interface ExpressionResult extends ResultEnvelope<ExpressionArtifact[]> {
  semanticStateDelta?: JsonValue;
}

export interface CapabilityManifest {
  apiVersion: string;
  targets: ExpressionTarget[];
  operations: Array<
    "parse" | "realize" | "express" | "transform" | "verify"
  >;
  languagePacks: string[];
  backends: string[];
  verifiers: string[];
  unsupported: string[];
}

export interface ParseRequest {
  input: ExpressionInput;
  sourceLanguage?: string;
  expectedTarget?: ExpressionTarget;
  contextRefs?: SemanticRef[];
}

export interface TransformRequest {
  input: ExpressionArtifact;
  target: ExpressionTarget;
  semanticPreservationProfile:
    | "strict-logical"
    | "technical-equivalence"
    | "natural-translation"
    | "summary"
    | "explanation"
    | "code-behavior";
  language?: string;
}

export interface VerifyRequest {
  artifacts: ExpressionArtifact[];
  semanticRoots?: SemanticRef[];
  profile?: string;
}

export interface UniversalExpressionHandlers {
  parse(request: ParseRequest): Promise<ResultEnvelope<ExpressionArtifact[]>>;
  realize(request: ExpressionRequest): Promise<ExpressionResult>;
  transform(request: TransformRequest): Promise<ExpressionResult>;
  verify(request: VerifyRequest): Promise<ResultEnvelope<boolean>>;
}

export interface UniversalExpressionApi {
  capabilities(): CapabilityManifest;
  parse(request: ParseRequest): Promise<ResultEnvelope<ExpressionArtifact[]>>;
  realize(request: ExpressionRequest): Promise<ExpressionResult>;
  express(request: ExpressionRequest): Promise<ExpressionResult>;
  transform(request: TransformRequest): Promise<ExpressionResult>;
  verify(request: VerifyRequest): Promise<ResultEnvelope<boolean>>;
}

export const validateExpressionRequest = (
  request: ExpressionRequest,
): Result<ExpressionRequest> => {
  if (
    request.target === "natural-language" &&
    request.language !== undefined &&
    request.language.trim() === ""
  ) {
    return err(
      new StructuredError(
        "EXPRESSION_LANGUAGE_EMPTY",
        "Natural-language target cannot use an empty language tag.",
      ),
    );
  }
  for (const constraint of request.constraints ?? []) {
    if (constraint.code.trim() === "") {
      return err(
        new StructuredError(
          "EXPRESSION_CONSTRAINT_CODE",
          "Expression constraints require stable non-empty codes.",
        ),
      );
    }
  }
  return ok(request);
};

export const validateResultEnvelope = <T>(
  envelope: ResultEnvelope<T>,
): Result<ResultEnvelope<T>> => {
  if (envelope.status === "ok" && envelope.value === undefined) {
    return err(
      new StructuredError(
        "EXPRESSION_FALSE_OK",
        "An ok result envelope must carry a value.",
      ),
    );
  }
  if (
    envelope.status === "ambiguous" &&
    (envelope.alternatives === undefined || envelope.alternatives.length < 2)
  ) {
    return err(
      new StructuredError(
        "EXPRESSION_AMBIGUITY_MISSING",
        "An ambiguous result must preserve at least two alternatives.",
      ),
    );
  }
  if (
    (envelope.status === "unsupported" || envelope.status === "error") &&
    envelope.diagnostics.length === 0
  ) {
    return err(
      new StructuredError(
        "EXPRESSION_DIAGNOSTIC_REQUIRED",
        `${envelope.status} results require at least one stable diagnostic.`,
      ),
    );
  }
  return ok(envelope);
};

export const createCapabilityManifest = (
  input: Partial<CapabilityManifest> = {},
): CapabilityManifest => ({
  apiVersion: input.apiVersion ?? "0.1.0",
  targets: input.targets ?? [
    "natural-language",
    "program",
    "structured-data",
    "schema",
    "query",
    "math",
    "logic",
    "command",
    "action",
  ],
  operations: input.operations ?? [
    "parse",
    "realize",
    "express",
    "transform",
    "verify",
  ],
  languagePacks: [...(input.languagePacks ?? [])],
  backends: [...(input.backends ?? [])],
  verifiers: [...(input.verifiers ?? [])],
  unsupported: [...(input.unsupported ?? [])],
});

export const createUniversalExpressionApi = (
  handlers: UniversalExpressionHandlers,
  manifest: CapabilityManifest = createCapabilityManifest(),
): UniversalExpressionApi => ({
  capabilities: () => structuredClone(manifest),
  parse: (request) => handlers.parse(request),
  async realize(request) {
    const valid = validateExpressionRequest(request);
    if (!valid.ok) {
      return {
        status: "error",
        diagnostics: [
          {
            code: valid.error.code,
            message: valid.error.message,
            severity: "error",
          },
        ],
        evidence: [],
        provenance: [],
      };
    }
    return handlers.realize(request);
  },
  async express(request) {
    const valid = validateExpressionRequest(request);
    if (!valid.ok) {
      return {
        status: "error",
        diagnostics: [
          {
            code: valid.error.code,
            message: valid.error.message,
            severity: "error",
          },
        ],
        evidence: [],
        provenance: [],
      };
    }
    return handlers.realize(request);
  },
  transform: (request) => handlers.transform(request),
  verify: (request) => handlers.verify(request),
});

export * from "./runtime.ts";

export * from "./controlled-adapters.ts";
