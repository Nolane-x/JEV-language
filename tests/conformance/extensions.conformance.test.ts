import { describe, expect, it } from "vitest";
import { createTypeScriptBackend } from "../../packages/code-backend-core/src/index.ts";
import {
  checkExtensionCompatibility,
  checkExtensionIsolation,
  ExtensionRegistry,
  isVersionRangeValid,
  LANGUAGE_PACK_REQUIRED_PROBES,
  loadOntologyDomainPack,
  PROGRAM_BACKEND_REQUIRED_PROBES,
  runLanguagePackConformance,
  runProgrammingBackendConformance,
  runVerifierConformance,
  satisfiesVersionRange,
  validateExtensionManifest,
  type ConformanceProbe,
  type ExtensionManifest,
  type OntologyDomainPack,
} from "../../packages/extension-core/src/index.ts";
import { englishLanguagePack } from "../../packages/language-en/src/index.ts";
import { createCoreOntology } from "../../packages/ontology/src/index.ts";
import type {
  VerificationObligation,
  Verifier,
} from "../../packages/verifier-core/src/framework.ts";

const extensionManifest = (
  id: string,
  overrides: Partial<ExtensionManifest> = {},
): ExtensionManifest => ({
  schemaVersion: "jl-extension-1",
  id,
  version: "1.2.3",
  category: "domain-pack",
  compatibility: {
    engine: ">=0.3 <0.5",
    semanticSchema: ">=0.3 <0.4",
  },
  dependencies: [],
  provides: [],
  effects: [],
  ...overrides,
});

const passingProbes = (
  ids: readonly string[],
): ConformanceProbe[] =>
  ids.map((id) => ({
    id,
    run: () => true,
  }));

describe("T268-T275 extension framework conformance", () => {
  it("T268 validates typed extension manifests and rejects malformed boundaries", () => {
    const valid = validateExtensionManifest(extensionManifest("domain.example"));
    expect(valid.ok).toBe(true);

    const duplicateEffects = validateExtensionManifest(
      extensionManifest("domain.invalid", {
        effects: ["network", "network"],
      }),
    );
    expect(duplicateEffects.ok).toBe(false);
    if (!duplicateEffects.ok) {
      expect(duplicateEffects.error.code).toBe("EXT_MANIFEST_EFFECTS");
    }

    const selfDependency = validateExtensionManifest(
      extensionManifest("domain.self", {
        dependencies: [
          { id: "domain.self", versionRange: ">=1.0" },
        ],
      }),
    );
    expect(selfDependency.ok).toBe(false);
    if (!selfDependency.ok) {
      expect(selfDependency.error.code).toBe("EXT_MANIFEST_DEPENDENCY");
    }
  });

  it("T270 accepts spec-style partial semantic-version ranges deterministically", () => {
    expect(isVersionRangeValid(">=0.3 <0.4")).toBe(true);
    expect(isVersionRangeValid(">=0.2")).toBe(true);
    expect(satisfiesVersionRange("0.3.7", ">=0.3 <0.4")).toBe(true);
    expect(satisfiesVersionRange("0.4.0", ">=0.3 <0.4")).toBe(false);
    expect(satisfiesVersionRange("1.2.9", "1.2")).toBe(true);
    expect(satisfiesVersionRange("1.3.0", "1.2")).toBe(false);
    expect(satisfiesVersionRange("1.8.0", "^1.2")).toBe(true);
    expect(satisfiesVersionRange("2.0.0", "^1.2")).toBe(false);
    expect(satisfiesVersionRange("1.2.9", "~1.2")).toBe(true);
    expect(satisfiesVersionRange("1.3.0", "~1.2")).toBe(false);

    const compatibility = checkExtensionCompatibility(
      extensionManifest("domain.compat"),
      {
        engineVersion: "0.4.1",
        semanticSchemaVersion: "0.3.9",
      },
    );
    expect(compatibility.compatible).toBe(true);
  });

  it("T269 enforces duplicate, dependency, compatibility and dependency-order rules", () => {
    const registry = new ExtensionRegistry({
      engineVersion: "0.4.1",
      semanticSchemaVersion: "0.3.9",
      allowedEffects: [],
    });

    const base = extensionManifest("domain.base", {
      compatibility: { engine: ">=0.4 <0.5" },
    });
    const child = extensionManifest("domain.child", {
      compatibility: { engine: ">=0.4 <0.5" },
      dependencies: [{ id: "domain.base", versionRange: "^1.2" }],
    });

    expect(registry.register({ manifest: base, implementation: {} }).ok).toBe(true);
    expect(registry.register({ manifest: child, implementation: {} }).ok).toBe(true);

    const order = registry.resolveOrder(["domain.child"]);
    expect(order).toEqual({
      ok: true,
      value: ["domain.base", "domain.child"],
    });

    const duplicate = registry.register({ manifest: base, implementation: {} });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.code).toBe("EXT_REGISTRY_DUPLICATE");
    }

    const incompatible = registry.register({
      manifest: extensionManifest("domain.future", {
        compatibility: { engine: ">=9.0" },
      }),
      implementation: {},
    });
    expect(incompatible.ok).toBe(false);
    if (!incompatible.ok) {
      expect(incompatible.error.code).toBe("EXT_REGISTRY_INCOMPATIBLE");
    }
  });

  it("T271 requires all language-pack conformance probes and validates the common ABI", () => {
    const full = runLanguagePackConformance(
      englishLanguagePack,
      passingProbes(LANGUAGE_PACK_REQUIRED_PROBES),
    );
    expect(full.passed).toBe(true);

    const missing = runLanguagePackConformance(
      englishLanguagePack,
      passingProbes(LANGUAGE_PACK_REQUIRED_PROBES.slice(1)),
    );
    expect(missing.passed).toBe(false);
    expect(
      missing.checks.find((check) => check.id === LANGUAGE_PACK_REQUIRED_PROBES[0]),
    ).toMatchObject({
      status: "fail",
      message: "Required conformance probe is missing.",
    });
  });

  it("T272 validates programming-backend ABI plus mandatory probe coverage", () => {
    const backend = createTypeScriptBackend();
    expect(backend.ok).toBe(true);
    if (!backend.ok) return;

    const report = runProgrammingBackendConformance(
      backend.value,
      passingProbes(PROGRAM_BACKEND_REQUIRED_PROBES),
    );
    expect(report.passed).toBe(true);

    const missing = runProgrammingBackendConformance(
      backend.value,
      passingProbes(PROGRAM_BACKEND_REQUIRED_PROBES.slice(0, -1)),
    );
    expect(missing.passed).toBe(false);
  });

  it("T273 executes verifier conformance cases and checks returned verifier metadata", async () => {
    const obligation: VerificationObligation = {
      id: "verify:extension-conformance",
      kind: "structural-validity",
      subject: "artifact:extension",
      severity: "required",
      verifierCandidates: [],
      provenance: [],
    };

    const verifier: Verifier<{ valid: boolean }> = {
      manifest: {
        id: "verifier.extension-test",
        version: "1.0.0",
        description: "Deterministic extension conformance fixture.",
        mode: "deterministic",
        kinds: ["structural-validity"],
      },
      canVerify: (candidate) => candidate.kind === "structural-validity",
      verify: async (candidate, subject) => ({
        obligationId: candidate.id,
        status: subject.valid ? "pass" : "fail",
        evidence: ["extension:test"],
        diagnostics: [],
        verifier: {
          id: "verifier.extension-test",
          version: "1.0.0",
          mode: "deterministic",
          evidenceGrade: "executable-test-evidence",
        },
      }),
    };

    const report = await runVerifierConformance(verifier, [
      {
        id: "valid-structure",
        obligation,
        subject: { valid: true },
        expectedStatus: "pass",
      },
    ]);
    expect(report.passed).toBe(true);

    const noCases = await runVerifierConformance(verifier, []);
    expect(noCases.passed).toBe(false);
  });

  it("T274 loads ontology/domain packs transactionally without mutating the base store", () => {
    const base = createCoreOntology();
    const pack: OntologyDomainPack = {
      manifest: extensionManifest("domain.widgets", {
        category: "ontology-pack",
        compatibility: { engine: ">=0.3" },
      }),
      namespaces: ["widgets"],
      concepts: [
        {
          id: "concept:widgets.widget",
          namespace: "widgets",
          labels: { en: "widget" },
          parents: ["concept:core.entity"],
          status: "domain",
          kind: "entity",
          provenance: [],
        },
      ],
      relations: [],
      roles: [],
    };

    const loaded = loadOntologyDomainPack(base, pack);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    expect(base.getConcept("concept:widgets.widget")).toBeUndefined();
    expect(
      loaded.value.ontology.getConcept("concept:widgets.widget"),
    ).toMatchObject({
      namespace: "widgets",
      status: "domain",
    });
    expect(loaded.value.namespaceOwners.widgets).toBe("domain.widgets");

    const collision = loadOntologyDomainPack(base, pack, {
      widgets: "domain.other",
    });
    expect(collision.ok).toBe(false);
    if (!collision.ok) {
      expect(collision.error.code).toBe(
        "EXT_ONTOLOGY_NAMESPACE_COLLISION",
      );
    }
  });

  it("T275 denies effects by default and never grants direct core mutation", () => {
    const network = extensionManifest("parser.networked", {
      category: "parser-plugin",
      effects: ["network"],
    });
    expect(checkExtensionIsolation(network).isolated).toBe(false);
    expect(
      checkExtensionIsolation(network, { allowedEffects: ["network"] }).isolated,
    ).toBe(true);

    const coreMutation = extensionManifest("domain.core-mutation", {
      effects: ["core-mutation"],
    });
    const report = checkExtensionIsolation(coreMutation, {
      allowedEffects: ["core-mutation"],
    });
    expect(report.isolated).toBe(false);
    expect(report.diagnostics.map((entry) => entry.code)).toContain(
      "EXT_ISOLATION_CORE_MUTATION",
    );
  });
});
