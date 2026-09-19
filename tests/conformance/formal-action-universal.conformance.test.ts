import { describe, expect, it } from "vitest";
import {
  renderCommandIr,
  renderDataIr,
  renderLogicIr,
  renderMathIr,
  renderQueryIr,
  renderSchemaIr,
  validateQueryIr,
  type CommandIr,
  type DataIr,
  type LogicIr,
  type MathIr,
  type QueryIr,
  type SchemaIr,
} from "../../packages/formal-ir/src/index.ts";
import {
  buildAction,
  renderActionIr,
  type ActionIR,
  type CapabilityDefinition,
} from "../../packages/action-ir/src/index.ts";
import {
  createCapabilityManifest,
  validateResultEnvelope,
} from "../../packages/universal-expression/src/index.ts";

describe("M15/M16 formal, action, and universal-expression conformance", () => {
  it("validates and deterministically renders the formal IR family", () => {
    const data: DataIr = { kind: "number", value: 42 };
    const schema: SchemaIr = {
      kind: "object",
      fields: [
        {
          name: "count",
          schema: { kind: "primitive", type: "integer" },
          required: true,
        },
      ],
      additionalProperties: false,
    };
    const query: QueryIr = {
      id: "query:read-items",
      mode: "read",
      source: { id: "source:items", kind: "named", name: "items" },
      projection: [
        { expression: { kind: "field", path: ["id"] }, alias: "id" },
      ],
      limit: 10,
    };
    const logic: LogicIr = {
      kind: "and",
      values: [
        { kind: "boolean", value: true },
        { kind: "boolean", value: false },
      ],
    };
    const math: MathIr = {
      kind: "relation",
      relation: "eq",
      left: { kind: "sum", terms: [
        { kind: "constant", value: 20 },
        { kind: "constant", value: 22 },
      ] },
      right: { kind: "constant", value: 42 },
    };
    const command: CommandIr = {
      executable: { kind: "enum", value: "git" },
      args: [{ kind: "subcommand", name: "status" }],
    };

    expect(renderDataIr(data).ok).toBe(true);
    expect(renderSchemaIr(schema).ok).toBe(true);
    expect(renderQueryIr(query).ok).toBe(true);
    expect(renderLogicIr(logic).ok).toBe(true);
    expect(renderMathIr(math).ok).toBe(true);
    expect(renderCommandIr(command).ok).toBe(true);
  });

  it("preserves read-vs-mutation query safety", () => {
    const unsafe: QueryIr = {
      id: "query:unsafe",
      mode: "read",
      mutation: {
        kind: "delete",
        target: { id: "source:items", kind: "named", name: "items" },
      },
    };
    const result = validateQueryIr(unsafe);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORMAL_QUERY_READ_MUTATION");
    }
  });

  it("constructs only declared, schema-valid Action IR without executing it", () => {
    const capability: CapabilityDefinition = {
      id: "resource.read",
      input: {
        kind: "object",
        fields: [
          {
            name: "target",
            schema: { kind: "reference" },
            required: true,
          },
        ],
        additionalProperties: false,
      },
      output: { kind: "string" },
      sideEffect: "read",
    };
    const action: ActionIR = {
      actionType: "resource.read",
      parameters: {
        kind: "structured",
        fields: {
          target: { kind: "ref", ref: "entity:target" },
        },
      },
      provenance: ["prov:test"],
      semanticPurpose: "goal:read",
    };
    const context = {
      capabilities: [capability],
      knownReferences: new Set(["entity:target", "goal:read"] as const),
    };

    const built = buildAction(action, context);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.expectedReturn).toEqual({ kind: "string" });
      expect(renderActionIr(built.value, context).ok).toBe(true);
    }

    const undeclared = buildAction(
      { ...action, actionType: "resource.delete" },
      context,
    );
    expect(undeclared.ok).toBe(false);
    if (!undeclared.ok) {
      expect(undeclared.error.code).toBe("ACTION_CAPABILITY_UNKNOWN");
    }
  });

  it("keeps partial/ambiguous/error statuses distinct from ok", () => {
    expect(
      validateResultEnvelope({
        status: "ok",
        diagnostics: [],
        evidence: [],
        provenance: [],
      }).ok,
    ).toBe(false);

    expect(
      validateResultEnvelope({
        status: "ambiguous",
        alternatives: [1, 2],
        diagnostics: [],
        evidence: [],
        provenance: [],
      }).ok,
    ).toBe(true);

    const manifest = createCapabilityManifest({
      languagePacks: ["en", "vi"],
      backends: ["formal-json"],
      verifiers: ["semantic-preservation"],
    });
    expect(manifest.targets).toContain("action");
    expect(manifest.operations).toContain("transform");
  });
});
