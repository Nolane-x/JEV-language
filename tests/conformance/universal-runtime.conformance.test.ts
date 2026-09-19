import { describe, expect, it } from "vitest";
import {
  createRegistryUniversalExpressionApi,
  type ParserAdapter,
  type RealizerAdapter,
  type TransformerAdapter,
  type ExpressionVerifierAdapter,
} from "../../packages/universal-expression/src/index.ts";

const parser: ParserAdapter = {
  id: "parser.controlled.en",
  sourceLanguages: ["en"],
  outputTargets: ["natural-language"],
  async parse(request) {
    const text =
      request.input.kind === "text" ? request.input.text : "unsupported";
    return {
      status: "ok",
      value: [{ artifactType: "text", text, language: "en" }],
      diagnostics: [],
      evidence: [],
      provenance: [],
    };
  },
};

const realizer: RealizerAdapter = {
  id: "realizer.controlled.en",
  targets: ["natural-language"],
  languages: ["en"],
  async realize() {
    return {
      status: "ok",
      value: [{ artifactType: "text", text: "realized", language: "en" }],
      diagnostics: [],
      evidence: [],
      provenance: [],
    };
  },
};

const transformer: TransformerAdapter = {
  id: "transformer.text.en-to-en",
  sourceArtifactTypes: ["text"],
  targets: ["natural-language"],
  async transform(request) {
    if (request.input.artifactType !== "text") {
      return {
        status: "unsupported",
        diagnostics: [
          {
            code: "TEST_TRANSFORM_UNSUPPORTED",
            message: "Only text is supported by this test transformer.",
            severity: "error",
          },
        ],
        evidence: [],
        provenance: [],
      };
    }
    return {
      status: "ok",
      value: [
        {
          artifactType: "text",
          text: request.input.text.toUpperCase(),
          ...((request.language ?? request.input.language) === undefined
            ? {}
            : { language: request.language ?? request.input.language }),
        },
      ],
      diagnostics: [],
      evidence: [],
      provenance: [],
    };
  },
};

const verifier: ExpressionVerifierAdapter = {
  id: "verifier.always-pass",
  profiles: ["test"],
  async verify() {
    return {
      status: "ok",
      value: true,
      diagnostics: [],
      evidence: [],
      provenance: [],
    };
  },
};

describe("universal expression runtime conformance", () => {
  it("discovers and routes registered adapters while emitting replayable traces", async () => {
    const api = createRegistryUniversalExpressionApi(
      {
        parsers: [parser],
        realizers: [realizer],
        transformers: [transformer],
        verifiers: [verifier],
      },
      {
        apiVersion: "0.1.0",
        configuration: { deterministic: true },
        languagePackVersions: { en: "0.1.0" },
        determinism: "D0",
      },
    );

    const manifest = api.capabilities();
    expect(manifest.backends).toContain("parser.controlled.en");
    expect(manifest.backends).toContain("realizer.controlled.en");
    expect(manifest.languagePacks).toContain("en");

    const parsed = await api.parse({
      input: { kind: "text", text: "hello", language: "en" },
      sourceLanguage: "en",
      expectedTarget: "natural-language",
    });
    expect(parsed.status).toBe("ok");
    expect(parsed.trace).toBeDefined();

    const realized = await api.realize({
      goal: { kind: "realize" },
      target: "natural-language",
      language: "en",
    });
    expect(realized.status).toBe("ok");
    expect(realized.trace).toBeDefined();

    const expressed = await api.express({
      goal: { kind: "express" },
      target: "natural-language",
      language: "en",
    });
    expect(expressed.status).toBe("ok");
    expect(expressed.trace).toBeDefined();

    const transformed = await api.transform({
      input: {
        artifactType: "text",
        text: "hello",
        language: "en",
      },
      target: "natural-language",
      semanticPreservationProfile: "technical-equivalence",
      language: "en",
    });
    expect(transformed.status).toBe("ok");
    expect(transformed.trace).toBeDefined();
    expect(transformed.value?.[0]).toMatchObject({
      artifactType: "text",
      text: "HELLO",
      language: "en",
    });

    const verified = await api.verify({
      artifacts: [{ artifactType: "text", text: "hello", language: "en" }],
      profile: "test",
    });
    expect(verified.status).toBe("ok");
    expect(verified.value).toBe(true);

    const events = api.traceEvents();
    expect(events.length).toBeGreaterThanOrEqual(10);
    expect(events.every((event) => event.configDigest.startsWith("sha256:"))).toBe(true);
    const stages = new Set(events.map((event) => event.stage));
    for (const stage of [
      "source-ingest",
      "realize",
      "express",
      "transform",
      "verify",
    ]) {
      expect(stages.has(stage), stage).toBe(true);
    }
    expect(api.replayManifest().traceId).toBe(parsed.trace);
  });

  it("returns explicit ambiguity instead of silently choosing among matching adapters", async () => {
    const other: RealizerAdapter = {
      ...realizer,
      id: "realizer.controlled.en.second",
    };
    const api = createRegistryUniversalExpressionApi({
      realizers: [realizer, other],
    });

    const result = await api.realize({
      goal: { kind: "realize" },
      target: "natural-language",
      language: "en",
    });
    expect(result.status).toBe("unsupported");
    expect(result.diagnostics[0]?.code).toBe(
      "EXPRESSION_REALIZE_ADAPTER_AMBIGUOUS",
    );
  });

  it("rejects duplicate adapter identities", () => {
    expect(() =>
      createRegistryUniversalExpressionApi({
        parsers: [parser],
        realizers: [{ ...realizer, id: parser.id }],
      }),
    ).toThrow(/Duplicate universal-expression adapter id/);
  });
});
