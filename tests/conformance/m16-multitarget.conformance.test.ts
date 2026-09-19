import { describe, expect, it } from "vitest";
import { parseControlledRequirement } from "../../packages/grounding/src/index.ts";
import type { CapabilityDefinition } from "../../packages/action-ir/src/index.ts";
import {
  controlledDeleteLimitDataRealizer,
  controlledEnglishSemanticRealizer,
  controlledVietnameseSemanticRealizer,
  createControlledDeleteLimitActionRealizer,
  createRegistryUniversalExpressionApi,
} from "../../packages/universal-expression/src/index.ts";

const capability: CapabilityDefinition = {
  id: "policy.enforce-delete-limit",
  input: {
    kind: "object",
    fields: [
      {
        name: "constrainedAction",
        schema: { kind: "reference" },
        required: true,
      },
      {
        name: "maximumDeleteFiles",
        schema: { kind: "number" },
        required: true,
      },
    ],
    additionalProperties: false,
  },
  output: { kind: "boolean" },
  sideEffect: "write",
};

describe("M16 same-JSG multi-target acceptance", () => {
  it("materializes one semantic root into natural language, structured data, and declared Action IR", async () => {
    const parsed = parseControlledRequirement(
      "The service must not delete more than 3 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const root = parsed.value.ids.constraint;
    const api = createRegistryUniversalExpressionApi({
      realizers: [
        controlledEnglishSemanticRealizer,
        controlledDeleteLimitDataRealizer,
        createControlledDeleteLimitActionRealizer(capability.id),
      ],
    });

    const text = await api.realize({
      semanticState: parsed.value.snapshot,
      goal: { kind: "realize", semanticRoots: [root] },
      target: "natural-language",
      language: "en",
    });
    expect(text.status).toBe("ok");
    const textArtifact = text.value?.[0];
    expect(textArtifact?.artifactType).toBe("text");
    if (textArtifact?.artifactType === "text") {
      expect(textArtifact.text).toContain("3 files");
      expect(textArtifact.semanticRefs).toContain(root);
    }

    const structured = await api.realize({
      semanticState: parsed.value.snapshot,
      goal: { kind: "realize", semanticRoots: [root] },
      target: "structured-data",
    });
    expect(structured.status).toBe("ok");
    const dataArtifact = structured.value?.[0];
    expect(dataArtifact?.artifactType).toBe("structured-data");
    if (
      dataArtifact?.artifactType === "structured-data" &&
      dataArtifact.data.kind === "object"
    ) {
      const limit = dataArtifact.data.fields.find(
        (field) => field.key === "maximumDeleteFiles",
      );
      expect(limit?.value).toMatchObject({ kind: "number", value: 3 });
      expect(dataArtifact.semanticRefs).toContain(root);
    }

    const action = await api.realize({
      semanticState: parsed.value.snapshot,
      goal: { kind: "realize", semanticRoots: [root] },
      target: "action",
      availableCapabilities: [capability],
    });
    expect(action.status).toBe("ok");
    const actionArtifact = action.value?.[0];
    expect(actionArtifact?.artifactType).toBe("action");
    if (actionArtifact?.artifactType === "action") {
      expect(actionArtifact.action.actionType).toBe(capability.id);
      expect(actionArtifact.action.parameters).toMatchObject({
        kind: "structured",
        fields: {
          maximumDeleteFiles: { kind: "number", value: 3 },
        },
      });
      expect(actionArtifact.semanticRefs).toContain(root);
    }

    const manifest = api.capabilities();
    expect(manifest.targets).toEqual(
      expect.arrayContaining(["natural-language", "structured-data", "action"]),
    );
  });

  it("uses the same semantic core for Vietnamese realization", async () => {
    const parsed = parseControlledRequirement(
      "The service must not delete more than 2 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const api = createRegistryUniversalExpressionApi({
      realizers: [controlledVietnameseSemanticRealizer],
    });
    const result = await api.realize({
      semanticState: parsed.value.snapshot,
      goal: {
        kind: "realize",
        semanticRoots: [parsed.value.ids.constraint],
      },
      target: "natural-language",
      language: "vi",
    });

    expect(result.status).toBe("ok");
    const artifact = result.value?.[0];
    expect(artifact?.artifactType).toBe("text");
    if (artifact?.artifactType === "text") {
      expect(artifact.text).toBe("Dịch vụ không được phép xóa quá 2 tệp.");
    }
  });

  it("refuses an Action IR when the consumer did not declare the configured capability", async () => {
    const parsed = parseControlledRequirement(
      "The service must not delete more than 3 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const api = createRegistryUniversalExpressionApi({
      realizers: [
        createControlledDeleteLimitActionRealizer(capability.id),
      ],
    });
    const result = await api.realize({
      semanticState: parsed.value.snapshot,
      goal: {
        kind: "realize",
        semanticRoots: [parsed.value.ids.constraint],
      },
      target: "action",
      availableCapabilities: [],
    });

    expect(result.status).toBe("unsupported");
    expect(result.diagnostics[0]?.code).toBe("ACTION_CAPABILITY_UNKNOWN");
  });
});
