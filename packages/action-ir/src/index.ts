import {
  err,
  ok,
  StructuredError,
  canonicalJson,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  SemanticRef,
  SemanticValue,
} from "../../semantic-graph/src/index.ts";

export type CapabilityActionId = string;

export type ActionSchema =
  | { kind: "any" }
  | { kind: "null" }
  | { kind: "boolean" }
  | { kind: "number" }
  | { kind: "string" }
  | { kind: "reference" }
  | { kind: "collection"; items: ActionSchema }
  | {
      kind: "object";
      fields: Array<{
        name: string;
        schema: ActionSchema;
        required: boolean;
      }>;
      additionalProperties?: boolean;
    };

export type CapabilityExecutionMode =
  | "deterministic"
  | "external-tool"
  | "human-mediated";

export type CapabilityRiskLevel = "low" | "medium" | "high";

export interface CapabilityDefinition {
  id: CapabilityActionId;
  version?: string;
  description?: SemanticValue;
  input: ActionSchema;
  output: ActionSchema;
  sideEffect?: "none" | "read" | "write" | "external";
  executionMode?: CapabilityExecutionMode;
  riskLevel?: CapabilityRiskLevel;
  requiresCapabilities?: CapabilityActionId[];
  evidenceRefs?: string[];
  annotations?: Record<string, JsonValue>;
}

export interface ActionIR {
  actionType: CapabilityActionId;
  parameters: SemanticValue;
  preconditions?: SemanticRef[];
  expectedEffects?: SemanticRef[];
  riskHints?: string[];
  provenance: SemanticRef[];
  semanticPurpose?: SemanticRef;
  expectedReturn?: ActionSchema;
}

export interface ClarificationNeed {
  unresolvedIssue: string;
  alternatives?: ActionIR[];
  requestedValueType?: ActionSchema;
  suggestedQuestionSemantics?: SemanticRef;
}

export interface ActionValidationContext {
  capabilities: readonly CapabilityDefinition[];
  knownReferences?: ReadonlySet<SemanticRef>;
}

const validateSchemaDefinition = (
  schema: ActionSchema,
  path: string,
): StructuredError | undefined => {
  if (schema.kind === "collection") {
    return validateSchemaDefinition(schema.items, `${path}.items`);
  }
  if (schema.kind !== "object") return undefined;

  const names = new Set<string>();
  for (const field of schema.fields) {
    if (field.name.trim() === "" || names.has(field.name)) {
      return new StructuredError(
        "ACTION_SCHEMA_FIELD",
        `Capability schema has an empty or duplicate field at ${path}.`,
      );
    }
    names.add(field.name);
    const nested = validateSchemaDefinition(
      field.schema,
      `${path}.${field.name}`,
    );
    if (nested) return nested;
  }
  return undefined;
};

export const validateCapabilityDefinition = (
  capability: CapabilityDefinition,
): Result<CapabilityDefinition> => {
  if (capability.id.trim() === "") {
    return err(
      new StructuredError(
        "ACTION_CAPABILITY_ID",
        "Capability id must be non-empty.",
      ),
    );
  }
  if (
    capability.version !== undefined &&
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(capability.version)
  ) {
    return err(
      new StructuredError(
        "ACTION_CAPABILITY_VERSION",
        "Capability version must be semver when supplied.",
      ),
    );
  }
  if (
    capability.executionMode !== undefined &&
    !["deterministic", "external-tool", "human-mediated"].includes(
      capability.executionMode,
    )
  ) {
    return err(
      new StructuredError(
        "ACTION_CAPABILITY_EXECUTION_MODE",
        "Capability execution mode is invalid.",
      ),
    );
  }
  if (
    capability.riskLevel !== undefined &&
    !["low", "medium", "high"].includes(capability.riskLevel)
  ) {
    return err(
      new StructuredError(
        "ACTION_CAPABILITY_RISK",
        "Capability risk level is invalid.",
      ),
    );
  }
  for (const values of [
    capability.requiresCapabilities ?? [],
    capability.evidenceRefs ?? [],
  ]) {
    if (
      values.some((value) => value.trim() === "") ||
      new Set(values).size !== values.length
    ) {
      return err(
        new StructuredError(
          "ACTION_CAPABILITY_LIST",
          "Capability requirement/evidence lists require unique non-empty ids.",
        ),
      );
    }
  }
  if (
    (capability.executionMode === "external-tool" ||
      capability.executionMode === "human-mediated") &&
    (capability.evidenceRefs?.length ?? 0) === 0
  ) {
    return err(
      new StructuredError(
        "ACTION_CAPABILITY_EVIDENCE",
        "External/human-mediated capabilities require at least one evidence reference.",
      ),
    );
  }
  const inputError = validateSchemaDefinition(capability.input, "$.input");
  if (inputError) return err(inputError);
  const outputError = validateSchemaDefinition(capability.output, "$.output");
  if (outputError) return err(outputError);
  return ok(structuredClone(capability));
};

const semanticValueMatchesSchema = (
  value: SemanticValue,
  schema: ActionSchema,
  path: string,
  knownReferences?: ReadonlySet<SemanticRef>,
): StructuredError | undefined => {
  switch (schema.kind) {
    case "any":
      return undefined;
    case "null":
      return value.kind === "unknown" &&
        value.expectedType === "null" &&
        (value.candidates?.length ?? 0) === 0
        ? undefined
        : new StructuredError(
            "ACTION_PARAMETER_TYPE",
            `Expected null-compatible value at ${path}.`,
          );
    case "boolean":
      return value.kind === "boolean"
        ? undefined
        : new StructuredError(
            "ACTION_PARAMETER_TYPE",
            `Expected boolean at ${path}.`,
          );
    case "number":
      return value.kind === "number" || value.kind === "quantity"
        ? undefined
        : new StructuredError(
            "ACTION_PARAMETER_TYPE",
            `Expected numeric value at ${path}.`,
          );
    case "string":
      return value.kind === "string" || value.kind === "enum"
        ? undefined
        : new StructuredError(
            "ACTION_PARAMETER_TYPE",
            `Expected string-like value at ${path}.`,
          );
    case "reference":
      if (value.kind !== "ref") {
        return new StructuredError(
          "ACTION_PARAMETER_TYPE",
          `Expected semantic reference at ${path}.`,
        );
      }
      if (knownReferences !== undefined && !knownReferences.has(value.ref)) {
        return new StructuredError(
          "ACTION_REFERENCE_MISSING",
          `Unknown semantic reference at ${path}: ${value.ref}.`,
        );
      }
      return undefined;
    case "collection":
      if (value.kind !== "collection") {
        return new StructuredError(
          "ACTION_PARAMETER_TYPE",
          `Expected collection at ${path}.`,
        );
      }
      for (let index = 0; index < value.values.length; index += 1) {
        const nested = semanticValueMatchesSchema(
          value.values[index]!,
          schema.items,
          `${path}[${index}]`,
          knownReferences,
        );
        if (nested) return nested;
      }
      return undefined;
    case "object":
      if (value.kind !== "structured") {
        return new StructuredError(
          "ACTION_PARAMETER_TYPE",
          `Expected structured object at ${path}.`,
        );
      }
      {
        const allowed = new Map(schema.fields.map((field) => [field.name, field]));
        for (const field of schema.fields) {
          const actual = value.fields[field.name];
          if (actual === undefined) {
            if (field.required) {
              return new StructuredError(
                "ACTION_PARAMETER_REQUIRED",
                `Missing required action parameter ${path}.${field.name}.`,
              );
            }
            continue;
          }
          const nested = semanticValueMatchesSchema(
            actual,
            field.schema,
            `${path}.${field.name}`,
            knownReferences,
          );
          if (nested) return nested;
        }
        if (schema.additionalProperties !== true) {
          for (const name of Object.keys(value.fields)) {
            if (!allowed.has(name)) {
              return new StructuredError(
                "ACTION_PARAMETER_UNKNOWN",
                `Unexpected action parameter ${path}.${name}.`,
              );
            }
          }
        }
      }
      return undefined;
  }
};

const sameActionSchema = (
  left: ActionSchema,
  right: ActionSchema,
): boolean => {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "any":
    case "null":
    case "boolean":
    case "number":
    case "string":
    case "reference":
      return true;
    case "collection":
      return (
        right.kind === "collection" &&
        sameActionSchema(left.items, right.items)
      );
    case "object":
      if (right.kind !== "object") return false;
      if (
        (left.additionalProperties === true) !==
        (right.additionalProperties === true)
      ) {
        return false;
      }
      {
        const leftFields = [...left.fields].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        const rightFields = [...right.fields].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        return (
          leftFields.length === rightFields.length &&
          leftFields.every((field, index) => {
            const peer = rightFields[index];
            return (
              peer !== undefined &&
              field.name === peer.name &&
              field.required === peer.required &&
              sameActionSchema(field.schema, peer.schema)
            );
          })
        );
      }
  }
};

export const validateActionIr = (
  action: ActionIR,
  context: ActionValidationContext,
): Result<ActionIR> => {
  if (action.actionType.trim() === "") {
    return err(
      new StructuredError(
        "ACTION_TYPE_EMPTY",
        "Action type must be non-empty.",
      ),
    );
  }

  const matching = context.capabilities.filter(
    (capability) => capability.id === action.actionType,
  );
  if (matching.length === 0) {
    return err(
      new StructuredError(
        "ACTION_CAPABILITY_UNKNOWN",
        `Capability ${action.actionType} is not present in the supplied registry.`,
      ),
    );
  }
  if (matching.length > 1) {
    return err(
      new StructuredError(
        "ACTION_CAPABILITY_DUPLICATE",
        `Capability registry contains duplicate id ${action.actionType}.`,
      ),
    );
  }

  const capability = matching[0]!;
  const validCapability = validateCapabilityDefinition(capability);
  if (!validCapability.ok) return err(validCapability.error);

  if (
    action.expectedReturn !== undefined &&
    !sameActionSchema(action.expectedReturn, capability.output)
  ) {
    return err(
      new StructuredError(
        "ACTION_RETURN_SCHEMA_MISMATCH",
        "Action expectedReturn conflicts with the declared capability output schema.",
      ),
    );
  }

  if (action.provenance.length === 0) {
    return err(
      new StructuredError(
        "ACTION_PROVENANCE_REQUIRED",
        "Action IR must retain at least one provenance reference.",
      ),
    );
  }

  const parameterError = semanticValueMatchesSchema(
    action.parameters,
    capability.input,
    "$.parameters",
    context.knownReferences,
  );
  if (parameterError) return err(parameterError);

  for (const hint of action.riskHints ?? []) {
    if (hint.trim() === "") {
      return err(
        new StructuredError(
          "ACTION_RISK_HINT",
          "Action risk hints must be non-empty when supplied.",
        ),
      );
    }
  }

  // Provenance references belong to the provenance store, not the JSG
  // node registry represented by knownReferences. Only semantic references
  // are checked against the supplied semantic-node set here.
  for (const ref of [
    ...(action.preconditions ?? []),
    ...(action.expectedEffects ?? []),
    ...(action.semanticPurpose === undefined ? [] : [action.semanticPurpose]),
  ]) {
    if (
      context.knownReferences !== undefined &&
      !context.knownReferences.has(ref)
    ) {
      return err(
        new StructuredError(
          "ACTION_REFERENCE_MISSING",
          `Action references unknown semantic node ${ref}.`,
        ),
      );
    }
  }

  return ok({
    ...structuredClone(action),
    expectedReturn: structuredClone(capability.output),
  });
};

export const buildAction = (
  action: ActionIR,
  context: ActionValidationContext,
): Result<ActionIR> => validateActionIr(action, context);


export const renderActionIr = (
  action: ActionIR,
  context: ActionValidationContext,
): Result<string> => {
  const valid = validateActionIr(action, context);
  if (!valid.ok) return err(valid.error);
  try {
    return ok(canonicalJson(valid.value as unknown as JsonValue));
  } catch (error) {
    return err(
      new StructuredError(
        "ACTION_RENDER_UNSERIALIZABLE",
        error instanceof Error
          ? error.message
          : "Validated Action IR could not be serialized canonically.",
      ),
    );
  }
};


export const validateCapabilityRegistry = (
  capabilities: readonly CapabilityDefinition[],
): Result<CapabilityDefinition[]> => {
  const ids = capabilities.map((capability) => capability.id);
  if (
    ids.some((id) => id.trim() === "") ||
    new Set(ids).size !== ids.length
  ) {
    return err(
      new StructuredError(
        "ACTION_CAPABILITY_REGISTRY_ID",
        "Capability registry requires unique non-empty ids.",
      ),
    );
  }
  const known = new Set(ids);
  for (const capability of capabilities) {
    const valid = validateCapabilityDefinition(capability);
    if (!valid.ok) return err(valid.error);
    for (const dependency of capability.requiresCapabilities ?? []) {
      if (!known.has(dependency) || dependency === capability.id) {
        return err(
          new StructuredError(
            "ACTION_CAPABILITY_DEPENDENCY",
            `Capability ${capability.id} references an unknown or self dependency ${dependency}.`,
          ),
        );
      }
    }
  }
  return ok(
    [...capabilities]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => structuredClone(item)),
  );
};
