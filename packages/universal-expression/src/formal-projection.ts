import {
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  DataIr,
  LogicIr,
} from "../../formal-ir/src/index.ts";
import type {
  SemanticRef,
  SemanticValue,
} from "../../semantic-graph/src/index.ts";
import type { ExpressionArtifact } from "./index.ts";

export type UniversalFormalFactValue = string | number | boolean;

export interface UniversalFormalFact {
  id: SemanticId;
  subjectRef: SemanticRef;
  predicate: SemanticId;
  value: UniversalFormalFactValue;
  provenanceRefs: SemanticRef[];
}

export interface UniversalFormalProjection {
  factId: SemanticId;
  criticalValue: UniversalFormalFactValue;
  provenanceRefs: SemanticRef[];
  artifacts: [
    Extract<ExpressionArtifact, { artifactType: "logic" }>,
    Extract<ExpressionArtifact, { artifactType: "structured-data" }>,
  ];
}

const semanticValue = (
  value: UniversalFormalFactValue,
): SemanticValue => {
  if (typeof value === "number") return { kind: "number", value };
  if (typeof value === "boolean") return { kind: "boolean", value };
  return {
    kind: "string",
    value: {
      kind: "surface-literal",
      value,
      origin: "configured",
    },
  };
};

const dataValue = (
  value: UniversalFormalFactValue,
): DataIr => {
  if (typeof value === "number") return { kind: "number", value };
  if (typeof value === "boolean") return { kind: "boolean", value };
  return {
    kind: "string",
    value: semanticValue(value),
  };
};

export const projectUniversalFormalFact = (
  fact: UniversalFormalFact,
): UniversalFormalProjection => {
  const logic: LogicIr = {
    kind: "predicate",
    predicate: fact.predicate,
    args: [
      {
        role: "role:subject" as SemanticId,
        value: { kind: "ref", ref: fact.subjectRef },
      },
      {
        role: "role:value" as SemanticId,
        value: semanticValue(fact.value),
      },
    ],
  };

  const data: DataIr = {
    kind: "object",
    fields: [
      {
        key: "factId",
        required: true,
        value: {
          kind: "string",
          value: {
            kind: "surface-literal",
            value: fact.id,
            origin: "configured",
          },
        },
      },
      {
        key: "subject",
        required: true,
        value: {
          kind: "string",
          value: { kind: "ref", ref: fact.subjectRef },
        },
      },
      {
        key: "predicate",
        required: true,
        value: {
          kind: "string",
          value: {
            kind: "surface-literal",
            value: fact.predicate,
            origin: "configured",
          },
        },
      },
      {
        key: "value",
        required: true,
        value: dataValue(fact.value),
      },
    ],
  };

  return {
    factId: fact.id,
    criticalValue: fact.value,
    provenanceRefs: [...fact.provenanceRefs],
    artifacts: [
      {
        artifactType: "logic",
        logic,
        semanticRefs: [fact.subjectRef],
      },
      {
        artifactType: "structured-data",
        data,
        semanticRefs: [fact.subjectRef],
      },
    ],
  };
};
