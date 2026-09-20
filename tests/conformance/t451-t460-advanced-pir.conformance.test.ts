import { describe, expect, it } from "vitest";
import {
  analyzePatternExhaustiveness,
  checkEffectPolicy,
  lowerAlgebraicDataType,
  normalizeEffectSet,
  substitutePirType,
  validateClosureDescriptor,
  validateConcurrencyPlan,
  validateErrorFlow,
  validateOpaqueMetaOperation,
  validateResourceLifetimes,
  validateTaskGraph,
  type PirErrorDescriptor,
  type PirTaskDescriptor,
  type PirType,
} from "../../packages/program-ir/src/index.ts";

const numberType: PirType = { kind: "number" };
const stringType: PirType = { kind: "string" };

describe("T451-T460 advanced PIR conformance", () => {
  it("T451 normalizes effects and enforces explicit effect/resource policy", () => {
    const normalized = normalizeEffectSet([
      { kind: "network", resource: "service:a" },
      { kind: "filesystem-read", resource: "file:a" },
      { kind: "network", resource: "service:a" },
    ]);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.value.effects).toEqual([
        { kind: "filesystem-read", resource: "file:a" },
        { kind: "network", resource: "service:a" },
      ]);
    }

    const check = checkEffectPolicy(
      [
        { kind: "network", resource: "service:a" },
        { kind: "filesystem-read", resource: "file:a" },
      ],
      {
        allowedKinds: ["network", "filesystem-read"],
        forbiddenKinds: ["process"],
        allowedResources: ["service:a"],
      },
    );
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.value.allowed).toBe(false);
      expect(check.value.violations).toEqual([
        "RESOURCE_NOT_ALLOWED:file:a",
      ]);
    }
  });

  it("T452 models typed error flow with handled/propagated separation", () => {
    const descriptors: PirErrorDescriptor[] = [
      {
        id: "error:not-found",
        code: "NOT_FOUND",
        payloadType: stringType,
        recoverable: true,
        retryable: false,
      },
      {
        id: "error:timeout",
        code: "TIMEOUT",
        payloadType: numberType,
        recoverable: true,
        retryable: true,
      },
    ];
    expect(
      validateErrorFlow(descriptors, {
        thrown: ["error:not-found", "error:timeout"],
        handled: ["error:not-found"],
        propagated: ["error:timeout"],
      }).ok,
    ).toBe(true);
    expect(
      validateErrorFlow(descriptors, {
        thrown: ["error:not-found"],
        handled: ["error:not-found"],
        propagated: ["error:not-found"],
      }).ok,
    ).toBe(false);
  });

  it("T453 validates deterministic async/task dependency DAGs and rejects cycles", () => {
    const tasks: PirTaskDescriptor[] = [
      {
        id: "task:fetch",
        resultType: stringType,
        state: "declared",
        dependencies: [],
        effects: [{ kind: "network" }],
        cancellation: "cooperative",
      },
      {
        id: "task:parse",
        resultType: numberType,
        state: "declared",
        dependencies: ["task:fetch"],
        effects: [{ kind: "pure" }],
        cancellation: "unsupported",
      },
    ];
    expect(validateTaskGraph(tasks)).toEqual({
      ok: true,
      value: { topologicalOrder: ["task:fetch", "task:parse"] },
    });

    const cycle = structuredClone(tasks);
    cycle[0]!.dependencies = ["task:parse"];
    expect(validateTaskGraph(cycle).ok).toBe(false);
  });

  it("T454 validates spawn/join/channel/lock concurrency primitives", () => {
    const tasks: PirTaskDescriptor[] = [
      {
        id: "task:producer",
        resultType: numberType,
        state: "declared",
        dependencies: [],
        effects: [{ kind: "async" }],
        cancellation: "cooperative",
      },
      {
        id: "task:consumer",
        resultType: numberType,
        state: "declared",
        dependencies: ["task:producer"],
        effects: [{ kind: "async" }],
        cancellation: "cooperative",
      },
    ];
    expect(
      validateConcurrencyPlan({
        tasks,
        channels: [{ id: "channel:numbers", valueType: numberType }],
        primitives: [
          { kind: "spawn", taskId: "task:producer" },
          {
            kind: "channel-send",
            channelId: "channel:numbers",
            valueType: numberType,
          },
          {
            kind: "channel-receive",
            channelId: "channel:numbers",
            valueType: numberType,
          },
          { kind: "join", taskId: "task:consumer" },
          { kind: "lock", resourceId: "resource:cache", mode: "exclusive" },
        ],
      }).ok,
    ).toBe(true);

    expect(
      validateConcurrencyPlan({
        tasks,
        channels: [{ id: "channel:numbers", valueType: numberType }],
        primitives: [
          {
            kind: "channel-send",
            channelId: "channel:numbers",
            valueType: stringType,
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("T455 validates ownership/lifetime metadata and rejects overlapping exclusive borrows", () => {
    expect(
      validateResourceLifetimes([
        {
          id: "lifetime:owner",
          resourceRef: "resource:file",
          ownership: "owned",
          ownerRef: "function:main",
          beginsAt: 0,
          endsAt: 20,
          transferable: true,
        },
        {
          id: "lifetime:borrow-a",
          resourceRef: "resource:file",
          ownership: "borrowed-exclusive",
          ownerRef: "function:a",
          beginsAt: 2,
          endsAt: 5,
          transferable: false,
        },
        {
          id: "lifetime:borrow-b",
          resourceRef: "resource:file",
          ownership: "borrowed-exclusive",
          ownerRef: "function:b",
          beginsAt: 6,
          endsAt: 8,
          transferable: false,
        },
      ]).ok,
    ).toBe(true);

    expect(
      validateResourceLifetimes([
        {
          id: "lifetime:a",
          resourceRef: "resource:file",
          ownership: "borrowed-exclusive",
          ownerRef: "function:a",
          beginsAt: 2,
          endsAt: 6,
          transferable: false,
        },
        {
          id: "lifetime:b",
          resourceRef: "resource:file",
          ownership: "borrowed-exclusive",
          ownerRef: "function:b",
          beginsAt: 5,
          endsAt: 8,
          transferable: false,
        },
      ]).ok,
    ).toBe(false);
  });

  it("T456 substitutes parametric types structurally without mutating the source", () => {
    const generic: PirType = {
      kind: "function",
      parameters: [
        { kind: "type-variable", id: "T", name: "T" },
      ],
      returns: {
        kind: "result",
        ok: { kind: "type-variable", id: "T", name: "T" },
        error: stringType,
      },
      effects: [{ kind: "pure" }],
    };
    const substituted = substitutePirType(generic, {
      variables: { T: numberType },
    });
    expect(substituted).toEqual({
      kind: "function",
      parameters: [numberType],
      returns: {
        kind: "result",
        ok: numberType,
        error: stringType,
      },
      effects: [{ kind: "pure" }],
    });
    expect(generic).not.toEqual(substituted);
  });

  it("T457 lowers explicit sum/product algebraic data types into existing PIR variant/record types", () => {
    expect(
      lowerAlgebraicDataType({
        kind: "sum",
        id: "adt:option",
        cases: { None: null, Some: numberType },
      }),
    ).toEqual({
      ok: true,
      value: {
        kind: "variant",
        cases: { None: null, Some: numberType },
      },
    });
    expect(
      lowerAlgebraicDataType({
        kind: "product",
        id: "adt:point",
        fields: { x: numberType, y: numberType },
      }),
    ).toEqual({
      ok: true,
      value: {
        kind: "record",
        fields: { x: numberType, y: numberType },
      },
    });
  });

  it("T458 reports pattern-match exhaustiveness, missing cases and duplicates", () => {
    const optionType: PirType = {
      kind: "variant",
      cases: { None: null, Some: numberType },
    };
    const partial = analyzePatternExhaustiveness(optionType, [
      { kind: "variant", tag: "Some" },
      { kind: "variant", tag: "Some" },
    ]);
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.value).toEqual({
        exhaustive: false,
        missingCases: ["None"],
        duplicateCases: ["Some"],
        wildcard: false,
      });
    }

    const exhaustive = analyzePatternExhaustiveness(optionType, [
      { kind: "wildcard" },
    ]);
    expect(exhaustive.ok).toBe(true);
    if (exhaustive.ok) expect(exhaustive.value.exhaustive).toBe(true);
  });

  it("T459 validates higher-order closure captures against lexical visibility", () => {
    expect(
      validateClosureDescriptor(
        {
          id: "closure:add-offset",
          parameters: ["param:value"],
          captures: [
            { symbolId: "symbol:offset", mode: "by-value" },
          ],
          bodyType: numberType,
          effects: [{ kind: "pure" }],
        },
        ["symbol:offset", "symbol:other"],
      ).ok,
    ).toBe(true);

    expect(
      validateClosureDescriptor(
        {
          id: "closure:bad",
          parameters: ["param:value"],
          captures: [
            { symbolId: "symbol:hidden", mode: "by-reference" },
          ],
          bodyType: numberType,
          effects: [],
        },
        ["symbol:offset"],
      ).ok,
    ).toBe(false);
  });

  it("T460 keeps reflection/metaprogramming behind an evidence-bound non-executable opaque boundary", () => {
    expect(
      validateOpaqueMetaOperation({
        id: "meta:reflect-fields",
        kind: "reflection",
        backend: "typescript",
        payload: { operation: "list-fields", target: "User" },
        executable: false,
        declaredEffects: [],
        evidenceRefs: ["source:reflection-request"],
        semanticContract: "inspect declared field names only",
      }).ok,
    ).toBe(true);

    expect(
      validateOpaqueMetaOperation({
        id: "meta:bad",
        kind: "metaprogramming",
        backend: "python",
        payload: null,
        executable: false,
        declaredEffects: [],
        evidenceRefs: [],
      }).ok,
    ).toBe(false);
  });
});
