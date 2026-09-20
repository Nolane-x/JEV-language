import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import {
  samePirType,
  type EffectSpec,
  type PirEffectKind,
  type PirPattern,
  type PirType,
  type ProgramRef,
} from "./model.ts";

const uniqueNonEmpty = (values: readonly string[]): boolean =>
  values.every((value) => value.trim() !== "") &&
  new Set(values).size === values.length;

const effectKey = (effect: EffectSpec): string =>
  JSON.stringify([effect.kind, effect.resource ?? null]);

export interface EffectSet {
  effects: EffectSpec[];
}

export interface EffectPolicy {
  allowedKinds?: PirEffectKind[];
  forbiddenKinds?: PirEffectKind[];
  allowedResources?: Array<ProgramRef | string>;
}

export interface EffectCheckResult {
  allowed: boolean;
  violations: string[];
  normalized: EffectSpec[];
}

export const normalizeEffectSet = (
  effects: readonly EffectSpec[],
): Result<EffectSet> => {
  const byKey = new Map<string, EffectSpec>();
  for (const effect of effects) {
    if (
      effect.resource !== undefined &&
      String(effect.resource).trim() === ""
    ) {
      return err(
        new StructuredError(
          "PIR_EFFECT_RESOURCE",
          "Effect resources must be non-empty when supplied.",
        ),
      );
    }
    byKey.set(effectKey(effect), structuredClone(effect));
  }
  const normalized = [...byKey.values()].sort((a, b) =>
    effectKey(a).localeCompare(effectKey(b)),
  );
  const kinds = new Set(normalized.map((effect) => effect.kind));
  if (kinds.has("pure") && normalized.length > 1) {
    return err(
      new StructuredError(
        "PIR_EFFECT_PURE_CONFLICT",
        "A pure effect set may not also contain effectful entries.",
      ),
    );
  }
  return ok({ effects: normalized });
};

export const checkEffectPolicy = (
  effects: readonly EffectSpec[],
  policy: EffectPolicy,
): Result<EffectCheckResult> => {
  const normalized = normalizeEffectSet(effects);
  if (!normalized.ok) return err(normalized.error);

  const allowed =
    policy.allowedKinds === undefined
      ? undefined
      : new Set(policy.allowedKinds);
  const forbidden = new Set(policy.forbiddenKinds ?? []);
  if (
    (policy.allowedKinds !== undefined &&
      new Set(policy.allowedKinds).size !== policy.allowedKinds.length) ||
    new Set(policy.forbiddenKinds ?? []).size !==
      (policy.forbiddenKinds ?? []).length ||
    [...forbidden].some((kind) => allowed?.has(kind))
  ) {
    return err(
      new StructuredError(
        "PIR_EFFECT_POLICY",
        "Effect policy sets must be duplicate-free and disjoint.",
      ),
    );
  }

  const allowedResources =
    policy.allowedResources === undefined
      ? undefined
      : new Set(policy.allowedResources.map(String));
  const violations: string[] = [];
  for (const effect of normalized.value.effects) {
    if (forbidden.has(effect.kind)) {
      violations.push(`FORBIDDEN_EFFECT:${effect.kind}`);
    }
    if (allowed !== undefined && !allowed.has(effect.kind)) {
      violations.push(`EFFECT_NOT_ALLOWED:${effect.kind}`);
    }
    if (
      effect.resource !== undefined &&
      allowedResources !== undefined &&
      !allowedResources.has(String(effect.resource))
    ) {
      violations.push(`RESOURCE_NOT_ALLOWED:${String(effect.resource)}`);
    }
  }

  return ok({
    allowed: violations.length === 0,
    violations: [...new Set(violations)].sort(),
    normalized: normalized.value.effects,
  });
};

export interface PirErrorDescriptor {
  id: string;
  code: string;
  payloadType: PirType;
  recoverable: boolean;
  retryable: boolean;
  effects?: EffectSpec[];
}

export interface PirErrorFlow {
  thrown: string[];
  handled: string[];
  propagated: string[];
}

export const validateErrorFlow = (
  descriptors: readonly PirErrorDescriptor[],
  flow: PirErrorFlow,
): Result<void> => {
  const descriptorIds = descriptors.map((item) => item.id);
  if (
    !uniqueNonEmpty(descriptorIds) ||
    descriptors.some(
      (item) => item.code.trim() === "" || item.id.trim() === "",
    )
  ) {
    return err(
      new StructuredError(
        "PIR_ERROR_DESCRIPTOR",
        "Error descriptors require unique ids and non-empty codes.",
      ),
    );
  }
  const known = new Set(descriptorIds);
  for (const descriptor of descriptors) {
    if (descriptor.retryable && !descriptor.recoverable) {
      return err(
        new StructuredError(
          "PIR_ERROR_RETRYABILITY",
          `Retryable error ${descriptor.id} must also be recoverable.`,
        ),
      );
    }
    if (descriptor.effects !== undefined) {
      const effects = normalizeEffectSet(descriptor.effects);
      if (!effects.ok) return err(effects.error);
    }
  }
  const flowSets = [
    ["thrown", flow.thrown],
    ["handled", flow.handled],
    ["propagated", flow.propagated],
  ] as const;
  for (const [label, refs] of flowSets) {
    if (!uniqueNonEmpty(refs) || refs.some((ref: string) => !known.has(ref))) {
      return err(
        new StructuredError(
          "PIR_ERROR_FLOW",
          `Error-flow set ${label} must contain unique known error ids.`,
        ),
      );
    }
  }
  const thrown = new Set(flow.thrown);
  if (
    flow.handled.some((id) => !thrown.has(id)) ||
    flow.propagated.some((id) => !thrown.has(id))
  ) {
    return err(
      new StructuredError(
        "PIR_ERROR_FLOW_SOURCE",
        "Handled and propagated errors must originate in the thrown set.",
      ),
    );
  }
  if (
    flow.handled.some((id) => flow.propagated.includes(id))
  ) {
    return err(
      new StructuredError(
        "PIR_ERROR_FLOW_CONFLICT",
        "An error cannot be both handled and propagated by the same flow boundary.",
      ),
    );
  }
  return ok(undefined);
};

export type PirTaskState =
  | "declared"
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface PirTaskDescriptor {
  id: string;
  resultType: PirType;
  state: PirTaskState;
  dependencies: string[];
  effects: EffectSpec[];
  cancellation: "unsupported" | "cooperative" | "preemptive";
}

export interface PirTaskGraphValidation {
  topologicalOrder: string[];
}

export const validateTaskGraph = (
  tasks: readonly PirTaskDescriptor[],
): Result<PirTaskGraphValidation> => {
  const ids = tasks.map((task) => task.id);
  if (!uniqueNonEmpty(ids)) {
    return err(
      new StructuredError(
        "PIR_TASK_ID",
        "Task ids must be unique and non-empty.",
      ),
    );
  }
  const known = new Set(ids);
  const states = new Set<PirTaskState>([
    "declared",
    "scheduled",
    "running",
    "completed",
    "failed",
    "cancelled",
  ]);
  const cancellationModes = new Set([
    "unsupported",
    "cooperative",
    "preemptive",
  ]);
  for (const task of tasks) {
    const effects = normalizeEffectSet(task.effects);
    if (
      !states.has(task.state) ||
      !cancellationModes.has(task.cancellation) ||
      !effects.ok ||
      !uniqueNonEmpty(task.dependencies) ||
      task.dependencies.some((dependency) => !known.has(dependency)) ||
      task.dependencies.includes(task.id)
    ) {
      return err(
        new StructuredError(
          "PIR_TASK_DEPENDENCY",
          `Task ${task.id} has invalid dependencies.`,
        ),
      );
    }
  }

  const incoming = new Map<string, number>(
    tasks.map((task) => [task.id, task.dependencies.length]),
  );
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      const list = dependents.get(dependency) ?? [];
      list.push(task.id);
      dependents.set(dependency, list);
    }
  }
  const ready = [...incoming.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    order.push(current);
    for (const dependent of (dependents.get(current) ?? []).sort()) {
      const next = (incoming.get(dependent) ?? 0) - 1;
      incoming.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }
  if (order.length !== tasks.length) {
    return err(
      new StructuredError(
        "PIR_TASK_CYCLE",
        "Task dependency graph contains a cycle.",
      ),
    );
  }
  return ok({ topologicalOrder: order });
};

export type PirConcurrencyPrimitive =
  | {
      kind: "spawn";
      taskId: string;
      parentTaskId?: string;
    }
  | {
      kind: "join";
      taskId: string;
    }
  | {
      kind: "channel-send";
      channelId: string;
      valueType: PirType;
    }
  | {
      kind: "channel-receive";
      channelId: string;
      valueType: PirType;
    }
  | {
      kind: "lock";
      resourceId: string;
      mode: "shared" | "exclusive";
    };

export interface PirConcurrencyPlan {
  tasks: PirTaskDescriptor[];
  channels: Array<{ id: string; valueType: PirType }>;
  primitives: PirConcurrencyPrimitive[];
}

export const validateConcurrencyPlan = (
  plan: PirConcurrencyPlan,
): Result<void> => {
  const tasks = validateTaskGraph(plan.tasks);
  if (!tasks.ok) return err(tasks.error);
  const taskIds = new Set(plan.tasks.map((task) => task.id));
  const channelIds = plan.channels.map((channel) => channel.id);
  if (!uniqueNonEmpty(channelIds)) {
    return err(
      new StructuredError(
        "PIR_CHANNEL_ID",
        "Concurrency channels require unique non-empty ids.",
      ),
    );
  }
  const channels = new Map(
    plan.channels.map((channel) => [channel.id, channel.valueType]),
  );

  for (const primitive of plan.primitives) {
    if (
      (primitive.kind === "spawn" || primitive.kind === "join") &&
      !taskIds.has(primitive.taskId)
    ) {
      return err(
        new StructuredError(
          "PIR_CONCURRENCY_TASK",
          "Concurrency primitive references an unknown task.",
        ),
      );
    }
    if (
      primitive.kind === "spawn" &&
      primitive.parentTaskId !== undefined &&
      !taskIds.has(primitive.parentTaskId)
    ) {
      return err(
        new StructuredError(
          "PIR_CONCURRENCY_PARENT",
          "Spawn primitive references an unknown parent task.",
        ),
      );
    }
    if (
      primitive.kind === "channel-send" ||
      primitive.kind === "channel-receive"
    ) {
      const channelType = channels.get(primitive.channelId);
      if (
        channelType === undefined ||
        !samePirType(channelType, primitive.valueType)
      ) {
        return err(
          new StructuredError(
            "PIR_CHANNEL_TYPE",
            "Channel primitive must reference a known channel with the same value type.",
          ),
        );
      }
    }
    if (
      primitive.kind === "lock" &&
      primitive.resourceId.trim() === ""
    ) {
      return err(
        new StructuredError(
          "PIR_LOCK_RESOURCE",
          "Lock primitive requires a non-empty resource id.",
        ),
      );
    }
  }
  return ok(undefined);
};

export type ResourceOwnershipMode =
  | "owned"
  | "borrowed-shared"
  | "borrowed-exclusive"
  | "external";

export interface ResourceLifetime {
  id: string;
  resourceRef: ProgramRef | string;
  ownership: ResourceOwnershipMode;
  ownerRef?: ProgramRef | string;
  beginsAt: number;
  endsAt?: number;
  transferable: boolean;
}

export const validateResourceLifetimes = (
  lifetimes: readonly ResourceLifetime[],
): Result<void> => {
  const ids = lifetimes.map((lifetime) => lifetime.id);
  if (!uniqueNonEmpty(ids)) {
    return err(
      new StructuredError(
        "PIR_LIFETIME_ID",
        "Resource lifetimes require unique non-empty ids.",
      ),
    );
  }
  for (const lifetime of lifetimes) {
    if (
      String(lifetime.resourceRef).trim() === "" ||
      !Number.isSafeInteger(lifetime.beginsAt) ||
      lifetime.beginsAt < 0 ||
      (lifetime.endsAt !== undefined &&
        (!Number.isSafeInteger(lifetime.endsAt) ||
          lifetime.endsAt < lifetime.beginsAt)) ||
      ((lifetime.ownership === "owned" ||
        lifetime.ownership === "borrowed-shared" ||
        lifetime.ownership === "borrowed-exclusive") &&
        (lifetime.ownerRef === undefined ||
          String(lifetime.ownerRef).trim() === ""))
    ) {
      return err(
        new StructuredError(
          "PIR_LIFETIME",
          `Invalid lifetime ${lifetime.id}.`,
        ),
      );
    }
  }

  const exclusive = lifetimes.filter(
    (lifetime) => lifetime.ownership === "borrowed-exclusive",
  );
  for (let leftIndex = 0; leftIndex < exclusive.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < exclusive.length;
      rightIndex += 1
    ) {
      const left = exclusive[leftIndex]!;
      const right = exclusive[rightIndex]!;
      if (String(left.resourceRef) !== String(right.resourceRef)) continue;
      const leftEnd = left.endsAt ?? Number.POSITIVE_INFINITY;
      const rightEnd = right.endsAt ?? Number.POSITIVE_INFINITY;
      const overlaps =
        left.beginsAt <= rightEnd && right.beginsAt <= leftEnd;
      if (overlaps) {
        return err(
          new StructuredError(
            "PIR_EXCLUSIVE_BORROW_OVERLAP",
            "Exclusive borrows of the same resource may not overlap.",
          ),
        );
      }
    }
  }
  return ok(undefined);
};

export interface TypeSubstitution {
  variables: Record<string, PirType>;
}

export const substitutePirType = (
  type: PirType,
  substitution: TypeSubstitution,
): PirType => {
  switch (type.kind) {
    case "type-variable":
      return structuredClone(substitution.variables[type.id] ?? type);
    case "list":
      return { kind: "list", element: substitutePirType(type.element, substitution) };
    case "tuple":
      return {
        kind: "tuple",
        elements: type.elements.map((item) =>
          substitutePirType(item, substitution),
        ),
      };
    case "optional":
      return {
        kind: "optional",
        inner: substitutePirType(type.inner, substitution),
      };
    case "union":
      return {
        kind: "union",
        options: type.options.map((item) =>
          substitutePirType(item, substitution),
        ),
      };
    case "intersection":
      return {
        kind: "intersection",
        members: type.members.map((item) =>
          substitutePirType(item, substitution),
        ),
      };
    case "function":
      return {
        kind: "function",
        parameters: type.parameters.map((item) =>
          substitutePirType(item, substitution),
        ),
        returns: substitutePirType(type.returns, substitution),
        ...(type.effects === undefined
          ? {}
          : { effects: structuredClone(type.effects) }),
      };
    case "named":
      return {
        ...structuredClone(type),
        ...(type.typeArguments === undefined
          ? {}
          : {
              typeArguments: type.typeArguments.map((item) =>
                substitutePirType(item, substitution),
              ),
            }),
      };
    case "generic":
      return {
        kind: "generic",
        base: substitutePirType(type.base, substitution),
        arguments: type.arguments.map((item) =>
          substitutePirType(item, substitution),
        ),
      };
    case "collection":
      return {
        ...structuredClone(type),
        value: substitutePirType(type.value, substitution),
        ...(type.key === undefined
          ? {}
          : { key: substitutePirType(type.key, substitution) }),
      };
    case "result":
      return {
        kind: "result",
        ok: substitutePirType(type.ok, substitution),
        error: substitutePirType(type.error, substitution),
      };
    case "variant":
      return {
        kind: "variant",
        cases: Object.fromEntries(
          Object.entries(type.cases).map(([tag, payload]) => [
            tag,
            payload === null
              ? null
              : substitutePirType(payload, substitution),
          ]),
        ),
      };
    case "promise":
      return {
        kind: "promise",
        value: substitutePirType(type.value, substitution),
      };
    default:
      return structuredClone(type);
  }
};

export type AlgebraicDataType =
  | {
      kind: "sum";
      id: string;
      cases: Record<string, PirType | null>;
    }
  | {
      kind: "product";
      id: string;
      fields: Record<string, PirType>;
    };

export const lowerAlgebraicDataType = (
  type: AlgebraicDataType,
): Result<PirType> => {
  if (type.id.trim() === "") {
    return err(
      new StructuredError(
        "PIR_ADT_ID",
        "Algebraic data types require a non-empty id.",
      ),
    );
  }
  if (type.kind === "sum") {
    const tags = Object.keys(type.cases);
    if (!uniqueNonEmpty(tags) || tags.length === 0) {
      return err(
        new StructuredError(
          "PIR_ADT_SUM",
          "Sum types require at least one unique non-empty case tag.",
        ),
      );
    }
    return ok({ kind: "variant", cases: structuredClone(type.cases) });
  }
  const fields = Object.keys(type.fields);
  if (!uniqueNonEmpty(fields) || fields.length === 0) {
    return err(
      new StructuredError(
        "PIR_ADT_PRODUCT",
        "Product types require at least one unique non-empty field.",
      ),
    );
  }
  return ok({ kind: "record", fields: structuredClone(type.fields) });
};

export interface ExhaustivenessReport {
  exhaustive: boolean;
  missingCases: string[];
  duplicateCases: string[];
  wildcard: boolean;
}

export const analyzePatternExhaustiveness = (
  type: PirType,
  patterns: readonly PirPattern[],
): Result<ExhaustivenessReport> => {
  if (type.kind !== "variant") {
    return err(
      new StructuredError(
        "PIR_EXHAUSTIVENESS_TYPE",
        "Exhaustiveness analysis currently requires a variant type.",
      ),
    );
  }
  const wildcard = patterns.some((pattern) => pattern.kind === "wildcard");
  const variantTags = patterns
    .filter(
      (pattern): pattern is Extract<PirPattern, { kind: "variant" }> =>
        pattern.kind === "variant",
    )
    .map((pattern) => pattern.tag);
  const known = new Set(Object.keys(type.cases));
  const unknown = variantTags.filter((tag) => !known.has(tag));
  if (unknown.length > 0) {
    return err(
      new StructuredError(
        "PIR_EXHAUSTIVENESS_UNKNOWN_CASE",
        `Pattern set references unknown variant cases: ${[
          ...new Set(unknown),
        ].sort().join(", ")}.`,
      ),
    );
  }
  const counts = new Map<string, number>();
  for (const tag of variantTags) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const duplicateCases = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([tag]) => tag)
    .sort();
  const covered = new Set(variantTags);
  const missingCases = wildcard
    ? []
    : [...known].filter((tag) => !covered.has(tag)).sort();
  return ok({
    exhaustive: wildcard || missingCases.length === 0,
    missingCases,
    duplicateCases,
    wildcard,
  });
};

export type ClosureCaptureMode =
  | "by-value"
  | "by-reference"
  | "by-mutable-reference";

export interface ClosureCapture {
  symbolId: ProgramRef;
  mode: ClosureCaptureMode;
}

export interface PirClosureDescriptor {
  id: string;
  parameters: ProgramRef[];
  captures: ClosureCapture[];
  bodyType: PirType;
  effects: EffectSpec[];
}

export const validateClosureDescriptor = (
  closure: PirClosureDescriptor,
  visibleSymbols: readonly ProgramRef[],
): Result<void> => {
  const closureEffects = normalizeEffectSet(closure.effects);
  if (
    closure.id.trim() === "" ||
    !closureEffects.ok ||
    !uniqueNonEmpty(closure.parameters) ||
    !uniqueNonEmpty(visibleSymbols)
  ) {
    return err(
      new StructuredError(
        "PIR_CLOSURE_SCHEMA",
        "Closure id, parameters and visible-symbol input must be valid.",
      ),
    );
  }
  const captureIds = closure.captures.map((capture) => capture.symbolId);
  const visible = new Set(visibleSymbols);
  if (
    !uniqueNonEmpty(captureIds) ||
    captureIds.some((id) => !visible.has(id)) ||
    captureIds.some((id) => closure.parameters.includes(id))
  ) {
    return err(
      new StructuredError(
        "PIR_CLOSURE_CAPTURE",
        "Closure captures must be unique visible non-parameter symbols.",
      ),
    );
  }
  return ok(undefined);
};

export type OpaqueMetaOperationKind =
  | "reflection"
  | "metaprogramming";

export interface OpaqueMetaOperation {
  id: string;
  kind: OpaqueMetaOperationKind;
  backend: string;
  payload: JsonValue;
  executable: false;
  declaredEffects: EffectSpec[];
  evidenceRefs: string[];
  semanticContract?: string;
}

export const validateOpaqueMetaOperation = (
  operation: OpaqueMetaOperation,
): Result<void> => {
  if (
    operation.id.trim() === "" ||
    operation.backend.trim() === "" ||
    !["reflection", "metaprogramming"].includes(operation.kind) ||
    operation.executable !== false ||
    operation.evidenceRefs.length === 0 ||
    !uniqueNonEmpty(operation.evidenceRefs)
  ) {
    return err(
      new StructuredError(
        "PIR_OPAQUE_META_BOUNDARY",
        "Opaque reflection/metaprogramming IR must be non-executable and evidence-bound.",
      ),
    );
  }
  const effects = normalizeEffectSet(operation.declaredEffects);
  return effects.ok ? ok(undefined) : err(effects.error);
};
