import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  ConceptDefinition,
  OntologyStore,
  RelationDefinition,
  RoleDefinition,
} from "../../ontology/src/index.ts";
import { OntologyStore as MutableOntologyStore } from "../../ontology/src/index.ts";
import type {
  HumanLanguagePack,
  LanguagePackManifest,
} from "../../language-pack-core/src/index.ts";
import type {
  ProgrammingBackend,
  ProgrammingBackendManifest,
} from "../../code-backend-core/src/backend.ts";
import { validateProgrammingBackendManifest } from "../../code-backend-core/src/backend.ts";
import type {
  VerificationObligation,
  VerificationResult,
  Verifier,
  VerifierManifest,
  VerifyContext,
} from "../../verifier-core/src/framework.ts";

export type ExtensionCategory =
  | "ontology-pack"
  | "natural-language-pack"
  | "lexicon-pack"
  | "programming-language-backend"
  | "formal-expression-backend"
  | "parser-plugin"
  | "verifier-plugin"
  | "decision-pack"
  | "domain-pack"
  | "candidate-generator"
  | "expression-backend";

export type ExtensionEffect =
  | "network"
  | "filesystem-read"
  | "filesystem-write"
  | "process"
  | "environment"
  | "action-execution"
  | "core-mutation";

export interface ExtensionDependency {
  id: string;
  versionRange: string;
  optional?: boolean;
}

export interface ExtensionManifest {
  schemaVersion: "jl-extension-1";
  id: string;
  version: string;
  category: ExtensionCategory;
  description?: string;
  compatibility: {
    engine: string;
    semanticSchema?: string;
    ontologyCore?: string;
    pir?: string;
  };
  dependencies: ExtensionDependency[];
  provides: string[];
  effects: ExtensionEffect[];
  annotations?: Record<string, JsonValue>;
}

export interface ExtensionRuntimeEnvironment {
  engineVersion: string;
  semanticSchemaVersion?: string;
  ontologyCoreVersion?: string;
  pirVersion?: string;
  allowedEffects?: readonly ExtensionEffect[];
}

export interface ExtensionCompatibilityReport {
  compatible: boolean;
  diagnostics: ExtensionDiagnostic[];
}

export interface ExtensionIsolationReport {
  isolated: boolean;
  diagnostics: ExtensionDiagnostic[];
}

export interface ExtensionDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  details?: JsonValue;
}

const EXTENSION_CATEGORIES = new Set<ExtensionCategory>([
  "ontology-pack",
  "natural-language-pack",
  "lexicon-pack",
  "programming-language-backend",
  "formal-expression-backend",
  "parser-plugin",
  "verifier-plugin",
  "decision-pack",
  "domain-pack",
  "candidate-generator",
  "expression-backend",
]);

const EXTENSION_EFFECTS = new Set<ExtensionEffect>([
  "network",
  "filesystem-read",
  "filesystem-write",
  "process",
  "environment",
  "action-execution",
  "core-mutation",
]);

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

const SEMVER =
  /^(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.-]+))?$/u;
const PARTIAL_SEMVER =
  /^(\\d+)(?:\\.(\\d+))?(?:\\.(\\d+))?(?:-([0-9A-Za-z.-]+))?$/u;

const parseSemver = (value: string): SemVer | undefined => {
  const match = SEMVER.exec(value);
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    return undefined;
  }
  return {
    major,
    minor,
    patch,
    ...(match[4] === undefined ? {} : { prerelease: match[4] }),
  };
};

interface PartialSemVer {
  version: SemVer;
  precision: 1 | 2 | 3;
}

const parsePartialSemver = (value: string): PartialSemVer | undefined => {
  const match = PARTIAL_SEMVER.exec(value);
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = match[2] === undefined ? 0 : Number(match[2]);
  const patch = match[3] === undefined ? 0 : Number(match[3]);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    return undefined;
  }
  const precision: 1 | 2 | 3 =
    match[3] !== undefined ? 3 : match[2] !== undefined ? 2 : 1;
  if (match[4] !== undefined && precision !== 3) return undefined;
  return {
    version: {
      major,
      minor,
      patch,
      ...(match[4] === undefined ? {} : { prerelease: match[4] }),
    },
    precision,
  };
};

const comparePrerelease = (
  left: string | undefined,
  right: string | undefined,
): number => {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;

  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const l = leftParts[index];
    const r = rightParts[index];
    if (l === r) continue;
    if (l === undefined) return -1;
    if (r === undefined) return 1;

    const lNumber = /^\\d+$/u.test(l) ? Number(l) : undefined;
    const rNumber = /^\\d+$/u.test(r) ? Number(r) : undefined;
    if (lNumber !== undefined && rNumber !== undefined) {
      return lNumber < rNumber ? -1 : 1;
    }
    if (lNumber !== undefined) return -1;
    if (rNumber !== undefined) return 1;
    return l.localeCompare(r);
  }
  return 0;
};

const compareSemver = (left: SemVer, right: SemVer): number => {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
};

const caretUpperBound = (version: SemVer): SemVer => {
  if (version.major > 0) {
    return { major: version.major + 1, minor: 0, patch: 0 };
  }
  if (version.minor > 0) {
    return { major: 0, minor: version.minor + 1, patch: 0 };
  }
  return { major: 0, minor: 0, patch: version.patch + 1 };
};

const tildeUpperBound = (
  version: SemVer,
  precision: 1 | 2 | 3,
): SemVer =>
  precision === 1
    ? { major: version.major + 1, minor: 0, patch: 0 }
    : { major: version.major, minor: version.minor + 1, patch: 0 };

const prefixMatches = (
  version: SemVer,
  target: SemVer,
  precision: 1 | 2 | 3,
): boolean => {
  if (version.major !== target.major) return false;
  if (precision === 1) return true;
  if (version.minor !== target.minor) return false;
  if (precision === 2) return true;
  return compareSemver(version, target) === 0;
};

const comparatorMatches = (
  version: SemVer,
  comparator: string,
): boolean | undefined => {
  if (comparator === "*" || comparator.toLowerCase() === "x") return true;

  const prefixed = /^(\\^|~|>=|<=|>|<|=)?(.+)$/u.exec(comparator);
  if (prefixed === null) return undefined;
  const operator = prefixed[1] ?? "=";
  const raw = prefixed[2];
  if (raw === undefined) return undefined;

  const wildcard = /^(\\d+)(?:\\.(\\d+|x|\\*))?(?:\\.(\\d+|x|\\*))?$/iu.exec(raw);
  if (wildcard !== null && (raw.includes("x") || raw.includes("*"))) {
    const major = Number(wildcard[1]);
    if (version.major !== major) return false;
    const minorToken = wildcard[2];
    if (
      minorToken !== undefined &&
      minorToken !== "x" &&
      minorToken !== "*" &&
      version.minor !== Number(minorToken)
    ) {
      return false;
    }
    const patchToken = wildcard[3];
    if (
      patchToken !== undefined &&
      patchToken !== "x" &&
      patchToken !== "*" &&
      version.patch !== Number(patchToken)
    ) {
      return false;
    }
    return true;
  }

  const parsedTarget = parsePartialSemver(raw);
  if (parsedTarget === undefined) return undefined;
  const { version: target, precision } = parsedTarget;
  const comparison = compareSemver(version, target);

  switch (operator) {
    case "=":
      return prefixMatches(version, target, precision);
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    case "^":
      return (
        comparison >= 0 &&
        compareSemver(version, caretUpperBound(target)) < 0
      );
    case "~":
      return (
        comparison >= 0 &&
        compareSemver(version, tildeUpperBound(target, precision)) < 0
      );
  }
};

export const satisfiesVersionRange = (
  versionValue: string,
  rangeValue: string,
): boolean => {
  const version = parseSemver(versionValue);
  const range = rangeValue.trim();
  if (version === undefined || range === "") return false;

  const alternatives = range.split("||").map((part) => part.trim());
  return alternatives.some((alternative) => {
    if (alternative === "") return false;
    const comparators = alternative.split(/\s+/u).filter(Boolean);
    return comparators.every(
      (comparator) => comparatorMatches(version, comparator) === true,
    );
  });
};

export const isVersionRangeValid = (rangeValue: string): boolean => {
  const range = rangeValue.trim();
  if (range === "") return false;
  const alternatives = range.split("||").map((part) => part.trim());
  return alternatives.every((alternative) => {
    if (alternative === "") return false;
    return alternative
      .split(/\s+/u)
      .filter(Boolean)
      .every((comparator) => {
        const probe = comparatorMatches({ major: 1, minor: 2, patch: 3 }, comparator);
        return probe !== undefined;
      });
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isJsonValue = (value: unknown): value is JsonValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
};

const hasExtensionManifestShape = (
  value: unknown,
): value is ExtensionManifest => {
  if (!isRecord(value)) return false;
  if (
    typeof value.schemaVersion !== "string" ||
    typeof value.id !== "string" ||
    typeof value.version !== "string" ||
    typeof value.category !== "string" ||
    !isRecord(value.compatibility) ||
    typeof value.compatibility.engine !== "string" ||
    !Array.isArray(value.dependencies) ||
    !Array.isArray(value.provides) ||
    !Array.isArray(value.effects)
  ) {
    return false;
  }

  for (const key of ["semanticSchema", "ontologyCore", "pir"] as const) {
    const candidate = value.compatibility[key];
    if (candidate !== undefined && typeof candidate !== "string") return false;
  }

  if (
    !value.dependencies.every(
      (dependency) =>
        isRecord(dependency) &&
        typeof dependency.id === "string" &&
        typeof dependency.versionRange === "string" &&
        (dependency.optional === undefined ||
          typeof dependency.optional === "boolean"),
    ) ||
    !value.provides.every((provided) => typeof provided === "string") ||
    !value.effects.every((effect) => typeof effect === "string")
  ) {
    return false;
  }

  if (value.description !== undefined && typeof value.description !== "string") {
    return false;
  }
  if (value.annotations !== undefined) {
    if (!isRecord(value.annotations) || !isJsonValue(value.annotations)) return false;
  }
  return true;
};

const duplicateValues = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
};

const manifestError = (
  code: string,
  message: string,
  details?: JsonValue,
): Result<ExtensionManifest> =>
  err(new StructuredError(code, message, details));

export const validateExtensionManifest = (
  input: unknown,
): Result<ExtensionManifest> => {
  if (!hasExtensionManifestShape(input)) {
    return manifestError(
      "EXT_MANIFEST_RUNTIME_SHAPE",
      "Extension manifest failed runtime boundary validation.",
    );
  }
  const manifest = input;
  if (manifest.schemaVersion !== "jl-extension-1") {
    return manifestError(
      "EXT_MANIFEST_SCHEMA",
      "Extension manifest schemaVersion must be jl-extension-1.",
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(manifest.id)) {
    return manifestError(
      "EXT_MANIFEST_ID",
      "Extension id must be a stable lowercase identifier.",
    );
  }
  if (parseSemver(manifest.version) === undefined) {
    return manifestError(
      "EXT_MANIFEST_VERSION",
      "Extension version must be strict semantic versioning.",
    );
  }
  if (!EXTENSION_CATEGORIES.has(manifest.category)) {
    return manifestError(
      "EXT_MANIFEST_CATEGORY",
      "Extension category is unsupported.",
    );
  }
  if (!isVersionRangeValid(manifest.compatibility.engine)) {
    return manifestError(
      "EXT_MANIFEST_ENGINE_RANGE",
      "Extension engine compatibility range is invalid.",
    );
  }
  for (const [key, range] of [
    ["semanticSchema", manifest.compatibility.semanticSchema],
    ["ontologyCore", manifest.compatibility.ontologyCore],
    ["pir", manifest.compatibility.pir],
  ] as const) {
    if (range !== undefined && !isVersionRangeValid(range)) {
      return manifestError(
        "EXT_MANIFEST_COMPATIBILITY_RANGE",
        `Extension compatibility range for ${key} is invalid.`,
      );
    }
  }

  const dependencyIds = manifest.dependencies.map((dependency) => dependency.id);
  const duplicateDependencies = duplicateValues(dependencyIds);
  if (duplicateDependencies.length > 0 || dependencyIds.includes(manifest.id)) {
    return manifestError(
      "EXT_MANIFEST_DEPENDENCY",
      "Extension dependencies must be unique and cannot depend on the extension itself.",
      { duplicateDependencies } as JsonValue,
    );
  }
  for (const dependency of manifest.dependencies) {
    if (
      !/^[a-z0-9][a-z0-9._-]*$/u.test(dependency.id) ||
      !isVersionRangeValid(dependency.versionRange)
    ) {
      return manifestError(
        "EXT_MANIFEST_DEPENDENCY",
        `Invalid extension dependency: ${dependency.id}.`,
      );
    }
  }

  const duplicateProvides = duplicateValues(manifest.provides);
  if (duplicateProvides.length > 0 || manifest.provides.some((value) => value.trim() === "")) {
    return manifestError(
      "EXT_MANIFEST_PROVIDES",
      "Provided capability identifiers must be non-empty and unique.",
      { duplicateProvides } as JsonValue,
    );
  }

  const duplicateEffects = duplicateValues(manifest.effects);
  if (
    duplicateEffects.length > 0 ||
    manifest.effects.some((effect) => !EXTENSION_EFFECTS.has(effect))
  ) {
    return manifestError(
      "EXT_MANIFEST_EFFECTS",
      "Extension effects must be declared, supported, and unique.",
      { duplicateEffects } as JsonValue,
    );
  }

  return ok(structuredClone(manifest));
};

const diagnostic = (
  code: string,
  message: string,
  details?: JsonValue,
): ExtensionDiagnostic => ({
  code,
  severity: "error",
  message,
  ...(details === undefined ? {} : { details }),
});

export const checkExtensionCompatibility = (
  manifest: ExtensionManifest,
  environment: ExtensionRuntimeEnvironment,
): ExtensionCompatibilityReport => {
  const diagnostics: ExtensionDiagnostic[] = [];

  const valid = validateExtensionManifest(manifest);
  if (!valid.ok) {
    diagnostics.push(
      diagnostic(valid.error.code, valid.error.message, valid.error.details),
    );
    return { compatible: false, diagnostics };
  }

  if (!satisfiesVersionRange(environment.engineVersion, manifest.compatibility.engine)) {
    diagnostics.push(
      diagnostic(
        "EXT_INCOMPATIBLE_ENGINE",
        `Extension ${manifest.id} does not support engine ${environment.engineVersion}.`,
      ),
    );
  }

  if (manifest.compatibility.semanticSchema !== undefined) {
    if (environment.semanticSchemaVersion === undefined) {
      diagnostics.push(
        diagnostic(
          "EXT_SEMANTIC_SCHEMA_UNKNOWN",
          "Extension requires a semantic schema version, but the environment did not declare one.",
        ),
      );
    } else if (
      !satisfiesVersionRange(
        environment.semanticSchemaVersion,
        manifest.compatibility.semanticSchema,
      )
    ) {
      diagnostics.push(
        diagnostic(
          "EXT_INCOMPATIBLE_SEMANTIC_SCHEMA",
          `Extension ${manifest.id} is incompatible with semantic schema ${environment.semanticSchemaVersion}.`,
        ),
      );
    }
  }

  if (manifest.compatibility.ontologyCore !== undefined) {
    if (environment.ontologyCoreVersion === undefined) {
      diagnostics.push(
        diagnostic(
          "EXT_ONTOLOGY_CORE_VERSION_UNKNOWN",
          "Extension requires an ontology-core version, but the environment did not declare one.",
        ),
      );
    } else if (
      !satisfiesVersionRange(
        environment.ontologyCoreVersion,
        manifest.compatibility.ontologyCore,
      )
    ) {
      diagnostics.push(
        diagnostic(
          "EXT_INCOMPATIBLE_ONTOLOGY_CORE",
          `Extension ${manifest.id} is incompatible with ontology core ${environment.ontologyCoreVersion}.`,
        ),
      );
    }
  }

  if (manifest.compatibility.pir !== undefined) {
    if (environment.pirVersion === undefined) {
      diagnostics.push(
        diagnostic(
          "EXT_PIR_VERSION_UNKNOWN",
          "Extension requires a PIR version, but the environment did not declare one.",
        ),
      );
    } else if (
      !satisfiesVersionRange(environment.pirVersion, manifest.compatibility.pir)
    ) {
      diagnostics.push(
        diagnostic(
          "EXT_INCOMPATIBLE_PIR",
          `Extension ${manifest.id} is incompatible with PIR ${environment.pirVersion}.`,
        ),
      );
    }
  }

  return { compatible: diagnostics.length === 0, diagnostics };
};

export const checkExtensionIsolation = (
  manifest: ExtensionManifest,
  environment: Pick<ExtensionRuntimeEnvironment, "allowedEffects"> = {},
): ExtensionIsolationReport => {
  const diagnostics: ExtensionDiagnostic[] = [];
  const allowed = new Set(environment.allowedEffects ?? []);

  if (manifest.effects.includes("core-mutation")) {
    diagnostics.push(
      diagnostic(
        "EXT_ISOLATION_CORE_MUTATION",
        "Extensions may not request direct mutation of Jev Language core state.",
      ),
    );
  }

  for (const effect of manifest.effects) {
    if (effect === "core-mutation") continue;
    if (!allowed.has(effect)) {
      diagnostics.push(
        diagnostic(
          "EXT_ISOLATION_EFFECT_DENIED",
          `Extension effect ${effect} is not permitted by the host policy.`,
          { effect } as JsonValue,
        ),
      );
    }
  }

  if (
    (manifest.category === "ontology-pack" || manifest.category === "domain-pack") &&
    manifest.effects.includes("action-execution")
  ) {
    diagnostics.push(
      diagnostic(
        "EXT_ISOLATION_DOMAIN_ACTION",
        "Ontology/domain packs are not automatically trusted to execute actions.",
      ),
    );
  }

  return { isolated: diagnostics.length === 0, diagnostics };
};

export interface RegisteredExtension<T = unknown> {
  manifest: ExtensionManifest;
  implementation: T;
}

export class ExtensionRegistry {
  readonly #entries = new Map<string, RegisteredExtension>();
  readonly #environment: ExtensionRuntimeEnvironment;

  constructor(environment: ExtensionRuntimeEnvironment) {
    this.#environment = {
      ...environment,
      ...(environment.allowedEffects === undefined
        ? {}
        : { allowedEffects: [...environment.allowedEffects] }),
    };
  }

  register<T>(entry: RegisteredExtension<T>): Result<void> {
    const validation = validateExtensionManifest(entry.manifest);
    if (!validation.ok) return err(validation.error);

    if (this.#entries.has(entry.manifest.id)) {
      return err(
        new StructuredError(
          "EXT_REGISTRY_DUPLICATE",
          `Extension already registered: ${entry.manifest.id}.`,
        ),
      );
    }

    const compatibility = checkExtensionCompatibility(
      entry.manifest,
      this.#environment,
    );
    if (!compatibility.compatible) {
      return err(
        new StructuredError(
          "EXT_REGISTRY_INCOMPATIBLE",
          `Extension ${entry.manifest.id} is incompatible with the runtime environment.`,
          compatibility.diagnostics as unknown as JsonValue,
        ),
      );
    }

    const isolation = checkExtensionIsolation(entry.manifest, this.#environment);
    if (!isolation.isolated) {
      return err(
        new StructuredError(
          "EXT_REGISTRY_ISOLATION",
          `Extension ${entry.manifest.id} violates the host isolation policy.`,
          isolation.diagnostics as unknown as JsonValue,
        ),
      );
    }

    for (const dependency of entry.manifest.dependencies) {
      const installed = this.#entries.get(dependency.id);
      if (installed === undefined) {
        if (dependency.optional === true) continue;
        return err(
          new StructuredError(
            "EXT_REGISTRY_DEPENDENCY_MISSING",
            `Required extension dependency is not installed: ${dependency.id}.`,
          ),
        );
      }
      if (!satisfiesVersionRange(installed.manifest.version, dependency.versionRange)) {
        return err(
          new StructuredError(
            "EXT_REGISTRY_DEPENDENCY_VERSION",
            `Installed dependency ${dependency.id}@${installed.manifest.version} does not satisfy ${dependency.versionRange}.`,
          ),
        );
      }
    }

    this.#entries.set(entry.manifest.id, {
      manifest: structuredClone(entry.manifest),
      implementation: entry.implementation,
    });
    return ok(undefined);
  }

  get<T = unknown>(id: string): RegisteredExtension<T> | undefined {
    const entry = this.#entries.get(id);
    if (entry === undefined) return undefined;
    return {
      manifest: structuredClone(entry.manifest),
      implementation: entry.implementation as T,
    };
  }

  list(category?: ExtensionCategory): RegisteredExtension[] {
    return [...this.#entries.values()]
      .filter((entry) => category === undefined || entry.manifest.category === category)
      .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id))
      .map((entry) => ({
        manifest: structuredClone(entry.manifest),
        implementation: entry.implementation,
      }));
  }

  resolveOrder(ids: readonly string[] = this.list().map((entry) => entry.manifest.id)): Result<string[]> {
    const requested = new Set(ids);
    for (const id of requested) {
      if (!this.#entries.has(id)) {
        return err(
          new StructuredError(
            "EXT_REGISTRY_NOT_FOUND",
            `Cannot resolve missing extension: ${id}.`,
          ),
        );
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (id: string): StructuredError | undefined => {
      if (visited.has(id)) return undefined;
      if (visiting.has(id)) {
        return new StructuredError(
          "EXT_REGISTRY_DEPENDENCY_CYCLE",
          `Extension dependency cycle detected at ${id}.`,
        );
      }
      visiting.add(id);
      const entry = this.#entries.get(id);
      if (entry === undefined) {
        return new StructuredError(
          "EXT_REGISTRY_NOT_FOUND",
          `Cannot resolve missing extension: ${id}.`,
        );
      }
      for (const dependency of entry.manifest.dependencies) {
        if (!this.#entries.has(dependency.id)) {
          if (dependency.optional === true) continue;
          return new StructuredError(
            "EXT_REGISTRY_DEPENDENCY_MISSING",
            `Required extension dependency is not installed: ${dependency.id}.`,
          );
        }
        const failure = visit(dependency.id);
        if (failure !== undefined) return failure;
      }
      visiting.delete(id);
      visited.add(id);
      order.push(id);
      return undefined;
    };

    for (const id of [...requested].sort()) {
      const failure = visit(id);
      if (failure !== undefined) return err(failure);
    }
    return ok(order);
  }
}

export type ConformanceCheckStatus = "pass" | "fail";

export interface ConformanceCheck {
  id: string;
  status: ConformanceCheckStatus;
  message?: string;
}

export interface ConformanceReport {
  suite: string;
  subjectId: string;
  passed: boolean;
  checks: ConformanceCheck[];
}

export interface ConformanceProbe {
  id: string;
  run(): boolean | Result<boolean>;
}

const runProbe = (probe: ConformanceProbe): ConformanceCheck => {
  try {
    const value = probe.run();
    if (typeof value === "boolean") {
      return {
        id: probe.id,
        status: value ? "pass" : "fail",
        ...(!value ? { message: "Probe returned false." } : {}),
      };
    }
    return value.ok && value.value
      ? { id: probe.id, status: "pass" }
      : {
          id: probe.id,
          status: "fail",
          message: value.ok ? "Probe returned false." : value.error.message,
        };
  } catch (cause) {
    return {
      id: probe.id,
      status: "fail",
      message: cause instanceof Error ? cause.message : "Probe threw a non-Error value.",
    };
  }
};

const finalizeConformance = (
  suite: string,
  subjectId: string,
  requiredProbeIds: readonly string[],
  checks: ConformanceCheck[],
  probes: readonly ConformanceProbe[],
): ConformanceReport => {
  const probeMap = new Map(probes.map((probe) => [probe.id, probe] as const));
  for (const id of requiredProbeIds) {
    const probe = probeMap.get(id);
    checks.push(
      probe === undefined
        ? {
            id,
            status: "fail",
            message: "Required conformance probe is missing.",
          }
        : runProbe(probe),
    );
  }
  checks.sort((left, right) => left.id.localeCompare(right.id));
  return {
    suite,
    subjectId,
    passed: checks.every((check) => check.status === "pass"),
    checks,
  };
};

export const LANGUAGE_PACK_REQUIRED_PROBES = [
  "lexeme-lookup",
  "morphology-contract",
  "basic-clause-realization",
  "basic-parse",
  "negation-preservation",
  "question-formation",
  "reference-forms",
  "round-trip-controlled-set",
  "unknown-token-preservation",
  "mixed-language-safety",
] as const;

export const runLanguagePackConformance = <
  TToken,
  TParseInput,
  TParseResult,
  TRealizeInput,
  TRealizeResult,
  TDiscourseContext,
  TDiscourseChoice,
>(
  pack: HumanLanguagePack<
    TToken,
    TParseInput,
    TParseResult,
    TRealizeInput,
    TRealizeResult,
    TDiscourseContext,
    TDiscourseChoice
  >,
  probes: readonly ConformanceProbe[],
): ConformanceReport => {
  const checks: ConformanceCheck[] = [];
  const manifest: LanguagePackManifest = pack.manifest;

  checks.push({
    id: "manifest-validation",
    status:
      manifest.schemaVersion === "jl-language-pack-1" &&
      manifest.id.trim() !== "" &&
      manifest.languageTag.trim() !== "" &&
      parseSemver(manifest.version) !== undefined
        ? "pass"
        : "fail",
  });

  const providerLanguages = [
    pack.tokenizer.language,
    pack.morphology.language,
    pack.lexicon.language,
    pack.grammar.language,
    pack.parserHooks.language,
    pack.realizationHooks.language,
    pack.punctuation.language,
    pack.discourse.language,
    pack.tests.language,
  ];
  checks.push({
    id: "provider-language-identity",
    status: providerLanguages.every((language) => language === manifest.languageTag)
      ? "pass"
      : "fail",
  });

  checks.push({
    id: "provider-abi",
    status:
      typeof pack.tokenizer.tokenize === "function" &&
      typeof pack.morphology.analyze === "function" &&
      typeof pack.morphology.realize === "function" &&
      typeof pack.lexicon.create === "function" &&
      typeof pack.grammar.create === "function" &&
      typeof pack.parserHooks.parse === "function" &&
      typeof pack.realizationHooks.realize === "function" &&
      typeof pack.punctuation.join === "function" &&
      typeof pack.discourse.choose === "function"
        ? "pass"
        : "fail",
  });

  return finalizeConformance(
    "language-pack-conformance",
    manifest.id,
    LANGUAGE_PACK_REQUIRED_PROBES,
    checks,
    probes,
  );
};

export const PROGRAM_BACKEND_REQUIRED_PROBES = [
  "primitive-types",
  "function",
  "branch",
  "loop",
  "call",
  "error-normalization",
  "parse-lift",
  "lower-parse-round-trip",
  "source-binding",
  "unsupported-feature-error",
] as const;

export const runProgrammingBackendConformance = <Ast>(
  backend: ProgrammingBackend<Ast>,
  probes: readonly ConformanceProbe[],
): ConformanceReport => {
  const checks: ConformanceCheck[] = [];
  const manifestCheck = validateProgrammingBackendManifest(backend.manifest);
  checks.push({
    id: "manifest-validation",
    status: manifestCheck.ok ? "pass" : "fail",
    ...(!manifestCheck.ok ? { message: manifestCheck.error.message } : {}),
  });
  checks.push({
    id: "backend-abi",
    status:
      typeof backend.parse === "function" &&
      typeof backend.lift === "function" &&
      typeof backend.lower === "function" &&
      typeof backend.print === "function" &&
      typeof backend.patch === "function" &&
      typeof backend.typecheck === "function"
        ? "pass"
        : "fail",
  });

  return finalizeConformance(
    "program-backend-conformance",
    backend.manifest.id,
    PROGRAM_BACKEND_REQUIRED_PROBES,
    checks,
    probes,
  );
};

export interface VerifierConformanceCase<T> {
  id: string;
  obligation: VerificationObligation;
  subject: T;
  context?: VerifyContext;
  expectedStatus?: VerificationResult["status"];
}

export interface AsyncConformanceReport {
  suite: string;
  subjectId: string;
  passed: boolean;
  checks: ConformanceCheck[];
}

const validateVerifierManifest = (manifest: VerifierManifest): ConformanceCheck => ({
  id: "manifest-validation",
  status:
    manifest.id.trim() !== "" &&
    parseSemver(manifest.version) !== undefined &&
    manifest.description.trim() !== "" &&
    manifest.kinds.length > 0 &&
    new Set(manifest.kinds).size === manifest.kinds.length
      ? "pass"
      : "fail",
});

export const runVerifierConformance = async <T>(
  verifier: Verifier<T>,
  cases: readonly VerifierConformanceCase<T>[],
): Promise<AsyncConformanceReport> => {
  const checks: ConformanceCheck[] = [validateVerifierManifest(verifier.manifest)];

  if (cases.length === 0) {
    checks.push({
      id: "verification-case",
      status: "fail",
      message: "At least one verifier conformance case is required.",
    });
  }

  for (const testCase of cases) {
    if (!verifier.canVerify(testCase.obligation, testCase.subject)) {
      checks.push({
        id: testCase.id,
        status: "fail",
        message: "Verifier rejected a declared conformance case.",
      });
      continue;
    }

    try {
      const result = await verifier.verify(
        testCase.obligation,
        testCase.subject,
        testCase.context ?? {},
      );
      const metadataMatches =
        result.obligationId === testCase.obligation.id &&
        result.verifier.id === verifier.manifest.id &&
        result.verifier.version === verifier.manifest.version &&
        result.verifier.mode === verifier.manifest.mode;
      const statusMatches =
        testCase.expectedStatus === undefined ||
        result.status === testCase.expectedStatus;
      checks.push({
        id: testCase.id,
        status: metadataMatches && statusMatches ? "pass" : "fail",
        ...(!metadataMatches
          ? { message: "Verifier result metadata does not match its obligation/manifest." }
          : !statusMatches
            ? { message: "Verifier result status does not match the conformance expectation." }
            : {}),
      });
    } catch (cause) {
      checks.push({
        id: testCase.id,
        status: "fail",
        message: cause instanceof Error ? cause.message : "Verifier threw a non-Error value.",
      });
    }
  }

  checks.sort((left, right) => left.id.localeCompare(right.id));
  return {
    suite: "verifier-conformance",
    subjectId: verifier.manifest.id,
    passed: checks.every((check) => check.status === "pass"),
    checks,
  };
};

export interface OntologyDomainPack {
  manifest: ExtensionManifest;
  namespaces: string[];
  concepts: ConceptDefinition[];
  relations: RelationDefinition[];
  roles: RoleDefinition[];
}

export interface OntologyPackLoadResult {
  ontology: OntologyStore;
  namespaceOwners: Record<string, string>;
}

const referencesKnownConcept = (
  id: ConceptDefinition["id"],
  store: OntologyStore,
): boolean => store.getConcept(id) !== undefined;

export const loadOntologyDomainPack = (
  base: OntologyStore,
  pack: OntologyDomainPack,
  namespaceOwners: Readonly<Record<string, string>> = {},
): Result<OntologyPackLoadResult> => {
  const validated = validateExtensionManifest(pack.manifest);
  if (!validated.ok) return err(validated.error);
  if (
    pack.manifest.category !== "ontology-pack" &&
    pack.manifest.category !== "domain-pack"
  ) {
    return err(
      new StructuredError(
        "EXT_ONTOLOGY_CATEGORY",
        "Ontology/domain loader only accepts ontology-pack or domain-pack extensions.",
      ),
    );
  }

  const isolation = checkExtensionIsolation(pack.manifest, { allowedEffects: [] });
  if (!isolation.isolated) {
    return err(
      new StructuredError(
        "EXT_ONTOLOGY_ISOLATION",
        "Ontology/domain pack violates deterministic loader isolation.",
        isolation.diagnostics as unknown as JsonValue,
      ),
    );
  }

  if (
    pack.namespaces.length === 0 ||
    duplicateValues(pack.namespaces).length > 0 ||
    pack.namespaces.some((namespace) => namespace.trim() === "" || namespace === "core")
  ) {
    return err(
      new StructuredError(
        "EXT_ONTOLOGY_NAMESPACE",
        "Ontology/domain packs require unique non-core namespaces.",
      ),
    );
  }

  const claims: Record<string, string> = { ...namespaceOwners };
  for (const namespace of pack.namespaces) {
    const existing = claims[namespace];
    if (existing !== undefined && existing !== pack.manifest.id) {
      return err(
        new StructuredError(
          "EXT_ONTOLOGY_NAMESPACE_COLLISION",
          `Namespace ${namespace} is already owned by ${existing}.`,
        ),
      );
    }
    claims[namespace] = pack.manifest.id;
  }

  const allowedNamespaces = new Set(pack.namespaces);
  for (const definition of [
    ...pack.concepts,
    ...pack.relations,
    ...pack.roles,
  ]) {
    if (!allowedNamespaces.has(definition.namespace)) {
      return err(
        new StructuredError(
          "EXT_ONTOLOGY_NAMESPACE_ESCAPE",
          `Definition ${definition.id} escapes declared extension namespaces.`,
        ),
      );
    }
  }

  const baseSnapshot = base.snapshot();
  const baseRelationIds = new Set(baseSnapshot.relations.map((value) => value.id));
  const baseRoleIds = new Set(baseSnapshot.roles.map((value) => value.id));
  if (
    pack.relations.some((definition) => baseRelationIds.has(definition.id)) ||
    pack.roles.some((definition) => baseRoleIds.has(definition.id))
  ) {
    return err(
      new StructuredError(
        "EXT_ONTOLOGY_OVERRIDE",
        "Ontology/domain packs may not overwrite existing relation or role definitions.",
      ),
    );
  }

  const staged = new MutableOntologyStore();
  const seeded = staged.mergeConcepts(baseSnapshot.concepts);
  if (!seeded.ok) return err(seeded.error);
  for (const relation of baseSnapshot.relations) staged.upsertRelation(relation);
  for (const role of baseSnapshot.roles) staged.upsertRole(role);

  const concepts = staged.mergeConcepts(pack.concepts);
  if (!concepts.ok) return err(concepts.error);

  const allRelationIds = new Set<string>([
    ...baseSnapshot.relations.map((value) => value.id),
    ...pack.relations.map((value) => value.id),
  ]);
  const allRoleIds = new Set<string>([
    ...baseSnapshot.roles.map((value) => value.id),
    ...pack.roles.map((value) => value.id),
  ]);
  if (
    duplicateValues(pack.relations.map((value) => value.id)).length > 0 ||
    duplicateValues(pack.roles.map((value) => value.id)).length > 0 ||
    [...allRelationIds].some((id) => allRoleIds.has(id))
  ) {
    return err(
      new StructuredError(
        "EXT_ONTOLOGY_RELATION_ROLE_COLLISION",
        "Ontology relation/role identifiers must remain unique across the loaded store.",
      ),
    );
  }

  for (const definition of [...pack.relations, ...pack.roles]) {
    for (const concept of [...(definition.domain ?? []), ...(definition.range ?? [])]) {
      if (!referencesKnownConcept(concept, staged)) {
        return err(
          new StructuredError(
            "EXT_ONTOLOGY_UNKNOWN_SIGNATURE_CONCEPT",
            `Relation/role ${definition.id} references unknown concept ${concept}.`,
          ),
        );
      }
    }
  }

  for (const relation of pack.relations) staged.upsertRelation(relation);
  for (const role of pack.roles) staged.upsertRole(role);

  return ok({
    ontology: staged,
    namespaceOwners: claims,
  });
};

export const programmingBackendExtensionManifest = (
  manifest: ProgrammingBackendManifest,
  engineRange: string,
): ExtensionManifest => ({
  schemaVersion: "jl-extension-1",
  id: manifest.id,
  version: manifest.version,
  category: "programming-language-backend",
  compatibility: {
    engine: engineRange,
    pir: manifest.pirVersion,
  },
  dependencies: [],
  provides: manifest.capabilities.map(
    (capability) => `program-backend:${manifest.language}:${capability}`,
  ),
  effects: [],
});
