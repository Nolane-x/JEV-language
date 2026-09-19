import { describe, expect, it } from "vitest";
import { createSemanticId } from "../../packages/core-types/src/index.ts";
import {
  renderCommandIr,
  renderDataIr,
  renderLogicIr,
  renderMathIr,
  renderQueryIr,
  renderSchemaIr,
  validateCommandIr,
  validateDataIr,
  validateLogicIr,
  validateMathIr,
  validateQueryIr,
  validateSchemaIr,
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
  validateActionIr,
  validateCapabilityDefinition,
  type ActionIR,
  type ActionValidationContext,
  type CapabilityDefinition,
} from "../../packages/action-ir/src/index.ts";

const literal = (value: string) => ({
  kind: "surface-literal" as const,
  value,
  origin: "configured" as const,
});

const semanticString = (value: string) => ({
  kind: "string" as const,
  value: literal(value),
});

const dataFixture: DataIr = {
  kind: "object",
  fields: [
    {
      key: "name",
      required: true,
      value: {
        kind: "string",
        value: semanticString("Ada"),
      },
    },
    {
      key: "scores",
      value: {
        kind: "array",
        items: [
          { kind: "number", value: 3 },
          { kind: "number", value: 5 },
        ],
      },
    },
    {
      key: "status",
      value: {
        kind: "tagged-union",
        tag: "active",
        value: { kind: "boolean", value: true },
      },
    },
  ],
};

const schemaFixture: SchemaIr = {
  kind: "object",
  additionalProperties: false,
  fields: [
    {
      name: "name",
      required: true,
      schema: {
        kind: "primitive",
        type: "string",
        constraints: [{ kind: "min-length", value: 1 }],
      },
    },
    {
      name: "age",
      required: false,
      schema: {
        kind: "optional",
        inner: {
          kind: "primitive",
          type: "integer",
          constraints: [{ kind: "min", value: 0 }],
        },
      },
    },
    {
      name: "roles",
      required: true,
      schema: {
        kind: "array",
        minItems: 1,
        items: {
          kind: "enum",
          values: ["reader", "writer"],
        },
      },
    },
  ],
};

const queryFixture: QueryIr = {
  id: "query:active-users",
  mode: "read",
  source: {
    id: "source:users",
    kind: "named",
    name: "users",
    alias: "u",
  },
  projection: [
    {
      expression: {
        kind: "field",
        sourceAlias: "u",
        path: ["id"],
      },
      alias: "user_id",
    },
    {
      expression: {
        kind: "field",
        sourceAlias: "u",
        path: ["name"],
      },
    },
  ],
  filter: {
    kind: "operator",
    operator: "and",
    args: [
      {
        kind: "operator",
        operator: "eq",
        args: [
          {
            kind: "field",
            sourceAlias: "u",
            path: ["active"],
          },
          {
            kind: "literal",
            value: { kind: "boolean", value: true },
          },
        ],
      },
      {
        kind: "operator",
        operator: "gte",
        args: [
          {
            kind: "field",
            sourceAlias: "u",
            path: ["age"],
          },
          {
            kind: "parameter",
            name: "minimumAge",
          },
        ],
      },
    ],
  },
  orderBy: [
    {
      expression: {
        kind: "field",
        sourceAlias: "u",
        path: ["name"],
      },
      direction: "asc",
    },
  ],
  limit: 50,
  offset: 0,
  parameters: [
    {
      name: "minimumAge",
      schema: { kind: "primitive", type: "integer" },
    },
  ],
};

const predicateId = createSemanticId("predicate");
const roleId = createSemanticId("role");

const logicFixture: LogicIr = {
  kind: "implies",
  antecedent: {
    kind: "predicate",
    predicate: predicateId,
    args: [
      {
        role: roleId,
        value: { kind: "number", value: 7 },
      },
    ],
  },
  consequent: {
    kind: "quantifier",
    quantifier: "exists",
    variable: "x",
    body: {
      kind: "comparison",
      operator: "gte",
      left: { kind: "variable", name: "x" },
      right: { kind: "constant", value: { kind: "number", value: 0 } },
    },
  },
};

const meterUnit = createSemanticId("unit");
const mathFixture: MathIr = {
  kind: "relation",
  relation: "eq",
  left: {
    kind: "derivative",
    variable: "x",
    expression: {
      kind: "power",
      base: { kind: "symbol", name: "x" },
      exponent: { kind: "constant", value: 2 },
    },
  },
  right: {
    kind: "product",
    factors: [
      { kind: "constant", value: 2 },
      { kind: "symbol", name: "x" },
      {
        kind: "constant",
        value: 1,
        unit: meterUnit,
      },
    ],
  },
};

const commandFixture: CommandIr = {
  executable: semanticString("git"),
  args: [
    { kind: "subcommand", name: "status" },
    { kind: "flag", name: "--short" },
    {
      kind: "option",
      name: "--pathspec-from-file",
      value: semanticString("paths.txt"),
    },
  ],
  cwd: semanticString("/repo"),
  env: [
    {
      name: "LC_ALL",
      value: semanticString("C"),
    },
  ],
};

const provenanceRef = createSemanticId("provenance");
const resourceRef = createSemanticId("entity");
const purposeRef = createSemanticId("goal");

const actionCapability: CapabilityDefinition = {
  id: "storage.read-record",
  input: {
    kind: "object",
    additionalProperties: false,
    fields: [
      {
        name: "resource",
        schema: { kind: "reference" },
        required: true,
      },
      {
        name: "limit",
        schema: { kind: "number" },
        required: false,
      },
    ],
  },
  output: {
    kind: "object",
    fields: [
      {
        name: "records",
        schema: {
          kind: "collection",
          items: { kind: "any" },
        },
        required: true,
      },
    ],
  },
  sideEffect: "read",
};

const actionFixture: ActionIR = {
  actionType: actionCapability.id,
  parameters: {
    kind: "structured",
    fields: {
      resource: { kind: "ref", ref: resourceRef },
      limit: { kind: "number", value: 10 },
    },
  },
  provenance: [provenanceRef],
  semanticPurpose: purposeRef,
  riskHints: ["read-only"],
};

const actionContext: ActionValidationContext = {
  capabilities: [actionCapability],
  knownReferences: new Set([
    provenanceRef,
    resourceRef,
    purposeRef,
  ]),
};

describe("M15 formal/data/action IR conformance", () => {
  it("validates and canonically renders one fixture family for every M15 IR", () => {
    const families = [
      ["data", validateDataIr(dataFixture), renderDataIr(dataFixture)],
      [
        "schema",
        validateSchemaIr(schemaFixture),
        renderSchemaIr(schemaFixture),
      ],
      [
        "query",
        validateQueryIr(queryFixture),
        renderQueryIr(queryFixture),
      ],
      [
        "logic",
        validateLogicIr(logicFixture),
        renderLogicIr(logicFixture),
      ],
      [
        "math",
        validateMathIr(mathFixture),
        renderMathIr(mathFixture),
      ],
      [
        "command",
        validateCommandIr(commandFixture),
        renderCommandIr(commandFixture),
      ],
      [
        "action",
        validateActionIr(actionFixture, actionContext),
        renderActionIr(actionFixture, actionContext),
      ],
    ] as const;

    expect(families.map(([name]) => name)).toEqual([
      "data",
      "schema",
      "query",
      "logic",
      "math",
      "command",
      "action",
    ]);

    for (const [name, validation, rendering] of families) {
      expect(validation.ok, `${name} validator`).toBe(true);
      expect(rendering.ok, `${name} renderer`).toBe(true);
      if (!rendering.ok) continue;

      const reparsed = JSON.parse(rendering.value);
      expect(reparsed).toBeDefined();

      const second =
        name === "data"
          ? renderDataIr(dataFixture)
          : name === "schema"
            ? renderSchemaIr(schemaFixture)
            : name === "query"
              ? renderQueryIr(queryFixture)
              : name === "logic"
                ? renderLogicIr(logicFixture)
                : name === "math"
                  ? renderMathIr(mathFixture)
                  : name === "command"
                    ? renderCommandIr(commandFixture)
                    : renderActionIr(actionFixture, actionContext);

      expect(second).toEqual(rendering);
    }
  });

  it("rejects structurally invalid Data IR rather than serializing it", () => {
    const invalid: DataIr = {
      kind: "object",
      fields: [
        { key: "same", value: { kind: "number", value: 1 } },
        { key: "same", value: { kind: "number", value: 2 } },
      ],
    };

    const validation = validateDataIr(invalid);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.error.code).toBe("FORMAL_DATA_OBJECT_KEY");
    }
    expect(renderDataIr(invalid).ok).toBe(false);
  });

  it("rejects invalid Schema IR bounds and duplicate field definitions", () => {
    const badBounds: SchemaIr = {
      kind: "array",
      minItems: 5,
      maxItems: 2,
      items: { kind: "primitive", type: "string" },
    };
    const bounds = validateSchemaIr(badBounds);
    expect(bounds.ok).toBe(false);
    if (!bounds.ok) {
      expect(bounds.error.code).toBe("FORMAL_SCHEMA_ARRAY_BOUNDS");
    }

    const duplicateFields: SchemaIr = {
      kind: "object",
      fields: [
        {
          name: "id",
          required: true,
          schema: { kind: "primitive", type: "string" },
        },
        {
          name: "id",
          required: false,
          schema: { kind: "primitive", type: "number" },
        },
      ],
    };
    const duplicate = validateSchemaIr(duplicateFields);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.code).toBe("FORMAL_SCHEMA_FIELD");
    }
  });

  it("keeps read and mutation semantics structurally distinct in Query IR", () => {
    const readWithMutation: QueryIr = {
      ...queryFixture,
      mutation: {
        kind: "delete",
        target: {
          id: "source:users",
          kind: "named",
          name: "users",
        },
        filter: {
          kind: "operator",
          operator: "eq",
          args: [
            { kind: "field", path: ["id"] },
            { kind: "parameter", name: "id" },
          ],
        },
      },
    };
    const invalidRead = validateQueryIr(readWithMutation);
    expect(invalidRead.ok).toBe(false);
    if (!invalidRead.ok) {
      expect(invalidRead.error.code).toBe(
        "FORMAL_QUERY_READ_MUTATION",
      );
    }

    const mutationWithoutMutation: QueryIr = {
      id: "query:bad-mutation",
      mode: "mutation",
      source: {
        id: "source:users",
        kind: "named",
        name: "users",
      },
    };
    const missing = validateQueryIr(mutationWithoutMutation);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe(
        "FORMAL_QUERY_MUTATION_MISSING",
      );
    }

    const rendered = renderQueryIr(queryFixture);
    expect(rendered.ok).toBe(true);
    if (rendered.ok) {
      expect(rendered.value).toContain('"kind":"parameter"');
      expect(rendered.value).toContain('"name":"minimumAge"');
    }
  });

  it("rejects malformed Logic and Math structures deterministically", () => {
    const emptyAnd: LogicIr = {
      kind: "and",
      values: [],
    };
    const logic = validateLogicIr(emptyAnd);
    expect(logic.ok).toBe(false);
    if (!logic.ok) {
      expect(logic.error.code).toBe("FORMAL_LOGIC_ARITY");
    }

    const jagged: MathIr = {
      kind: "matrix",
      rows: [
        [
          { kind: "constant", value: 1 },
          { kind: "constant", value: 2 },
        ],
        [{ kind: "constant", value: 3 }],
      ],
    };
    const math = validateMathIr(jagged);
    expect(math.ok).toBe(false);
    if (!math.ok) {
      expect(math.error.code).toBe("FORMAL_MATH_MATRIX_SHAPE");
    }
  });

  it("keeps Command IR structural and rejects an invalid executable value", () => {
    const valid = validateCommandIr(commandFixture);
    expect(valid.ok).toBe(true);

    const invalid: CommandIr = {
      executable: { kind: "number", value: 7 },
      args: [],
    };
    const result = validateCommandIr(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORMAL_COMMAND_EXECUTABLE");
    }
  });

  it("emits Action IR only for declared capabilities and valid parameters", () => {
    expect(validateCapabilityDefinition(actionCapability).ok).toBe(true);

    const built = buildAction(actionFixture, actionContext);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.actionType).toBe(actionCapability.id);
      expect(built.value.expectedReturn).toEqual(actionCapability.output);
    }

    const unknownCapability = validateActionIr(
      {
        ...actionFixture,
        actionType: "storage.unknown",
      },
      actionContext,
    );
    expect(unknownCapability.ok).toBe(false);
    if (!unknownCapability.ok) {
      expect(unknownCapability.error.code).toBe(
        "ACTION_CAPABILITY_UNKNOWN",
      );
    }

    const missingRequired = validateActionIr(
      {
        ...actionFixture,
        parameters: {
          kind: "structured",
          fields: {
            limit: { kind: "number", value: 10 },
          },
        },
      },
      actionContext,
    );
    expect(missingRequired.ok).toBe(false);
    if (!missingRequired.ok) {
      expect(missingRequired.error.code).toBe(
        "ACTION_PARAMETER_REQUIRED",
      );
    }
  });

  it("rejects Action IR references outside the consumer-supplied known-reference set", () => {
    const missingRef = createSemanticId("entity");
    const invalid = validateActionIr(
      {
        ...actionFixture,
        parameters: {
          kind: "structured",
          fields: {
            resource: { kind: "ref", ref: missingRef },
          },
        },
      },
      actionContext,
    );

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe("ACTION_REFERENCE_MISSING");
    }
  });

  it("requires Action IR provenance and preserves the no-execution boundary", () => {
    const noProvenance = validateActionIr(
      {
        ...actionFixture,
        provenance: [],
      },
      actionContext,
    );
    expect(noProvenance.ok).toBe(false);
    if (!noProvenance.ok) {
      expect(noProvenance.error.code).toBe(
        "ACTION_PROVENANCE_REQUIRED",
      );
    }

    const rendered = renderActionIr(actionFixture, actionContext);
    expect(rendered.ok).toBe(true);
    if (rendered.ok) {
      const value = JSON.parse(rendered.value) as {
        actionType: string;
        parameters: unknown;
      };
      expect(value.actionType).toBe("storage.read-record");
      expect(value.parameters).toBeDefined();
    }
  });
});
