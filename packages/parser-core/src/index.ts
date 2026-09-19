import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type { GroundingDocument } from "../../grounding/src/index.ts";
import {
  type GraphCommit,
  type GraphOperation,
  type GraphValidator,
  InMemorySemanticGraph,
} from "../../semantic-graph/src/index.ts";

export type SyntaxNodeId = string;

export interface SyntaxAlternative {
  ruleId: string;
  children: SyntaxNodeId[];
  localScore?: number;
  annotations?: Record<string, JsonValue>;
}

export interface PackedSyntaxNode {
  id: SyntaxNodeId;
  category: string;
  tokenStart: number;
  tokenEnd: number;
  features?: Record<string, JsonValue>;
  alternatives: SyntaxAlternative[];
}

export interface SyntaxForest {
  version: string;
  roots: SyntaxNodeId[];
  nodes: PackedSyntaxNode[];
}

export interface SemanticConstructionContext<C = unknown> {
  forest: SyntaxForest;
  syntaxNode: PackedSyntaxNode;
  grounding: GroundingDocument;
  context: C;
}

export interface SemanticConstructionRule<C = unknown> {
  readonly id: string;
  supports(node: PackedSyntaxNode): boolean;
  construct(
    input: SemanticConstructionContext<C>,
  ): Result<GraphOperation[]>;
}

export type AmbiguityClass =
  | "none"
  | "lexical"
  | "syntactic"
  | "reference"
  | "scope"
  | "semantic"
  | "mixed"
  | "unknown";

export interface ParseCandidate {
  id: string;
  rootNodeId: SyntaxNodeId;
  operations: GraphOperation[];
  ambiguityTags: Exclude<AmbiguityClass, "none">[];
  deterministicScore?: number;
  notes?: string[];
}

export interface AmbiguitySet {
  classification: AmbiguityClass;
  candidates: ParseCandidate[];
}

export interface AmbiguityResolutionContext {
  grounding: GroundingDocument;
  forest: SyntaxForest;
}

export interface AmbiguityResolver {
  readonly id: string;
  readonly supported: readonly AmbiguityClass[];
  readonly kind: "deterministic" | "external-probabilistic";
  resolve(
    ambiguity: AmbiguitySet,
    context: AmbiguityResolutionContext,
  ): Result<string | undefined>;
}

export interface AmbiguityResolution {
  status: "unambiguous" | "resolved" | "preserved";
  classification: AmbiguityClass;
  candidates: ParseCandidate[];
  selected?: ParseCandidate;
  resolverId?: string;
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

export const validateSyntaxForest = (
  forest: SyntaxForest,
): Result<SyntaxForest> => {
  if (forest.version.trim() === "") {
    return err(
      new StructuredError(
        "PARSER_FOREST_VERSION",
        "Syntax forest version is required.",
      ),
    );
  }

  const nodes = new Map<SyntaxNodeId, PackedSyntaxNode>();
  for (const node of forest.nodes) {
    if (node.id.trim() === "" || nodes.has(node.id)) {
      return err(
        new StructuredError(
          "PARSER_FOREST_NODE_ID",
          `Syntax forest contains an empty or duplicate node id: ${node.id}.`,
        ),
      );
    }
    if (
      !Number.isInteger(node.tokenStart) ||
      !Number.isInteger(node.tokenEnd) ||
      node.tokenStart < 0 ||
      node.tokenEnd < node.tokenStart
    ) {
      return err(
        new StructuredError(
          "PARSER_FOREST_TOKEN_RANGE",
          `Invalid token range for syntax node ${node.id}.`,
        ),
      );
    }
    nodes.set(node.id, node);
  }

  for (const root of forest.roots) {
    if (!nodes.has(root)) {
      return err(
        new StructuredError(
          "PARSER_FOREST_ROOT_MISSING",
          `Syntax forest root does not exist: ${root}.`,
        ),
      );
    }
  }

  for (const node of forest.nodes) {
    for (const alternative of node.alternatives) {
      for (const child of alternative.children) {
        if (!nodes.has(child)) {
          return err(
            new StructuredError(
              "PARSER_FOREST_CHILD_MISSING",
              `Syntax alternative ${alternative.ruleId} references missing child ${child}.`,
            ),
          );
        }
      }
    }
  }

  return ok(structuredClone(forest));
};

export const classifyAmbiguity = (
  candidates: readonly ParseCandidate[],
): AmbiguityClass => {
  if (candidates.length <= 1) return "none";
  const tags = unique(candidates.flatMap((candidate) => candidate.ambiguityTags));
  if (tags.length === 0) return "unknown";
  if (tags.length === 1) return tags[0] ?? "unknown";
  return "mixed";
};

export class AmbiguityResolverRegistry {
  readonly #resolvers: AmbiguityResolver[] = [];

  register(resolver: AmbiguityResolver): void {
    if (this.#resolvers.some((entry) => entry.id === resolver.id)) {
      throw new StructuredError(
        "PARSER_RESOLVER_DUPLICATE",
        `Ambiguity resolver already registered: ${resolver.id}.`,
      );
    }
    this.#resolvers.push(resolver);
  }

  async resolve(
    candidates: readonly ParseCandidate[],
    context: AmbiguityResolutionContext,
  ): Promise<Result<AmbiguityResolution>> {
    const cloned = candidates.map((candidate) => structuredClone(candidate));
    const classification = classifyAmbiguity(cloned);

    if (cloned.length === 0) {
      return err(
        new StructuredError(
          "PARSER_NO_CANDIDATES",
          "Cannot resolve an empty parse-candidate set.",
        ),
      );
    }

    if (cloned.length === 1) {
      return ok({
        status: "unambiguous",
        classification: "none",
        candidates: cloned,
        selected: cloned[0],
      });
    }

    const ambiguity: AmbiguitySet = {
      classification,
      candidates: cloned,
    };

    for (const resolver of this.#resolvers) {
      if (!resolver.supported.includes(classification)) continue;
      const selectedId = await resolver.resolve(ambiguity, context);
      if (!selectedId.ok) return selectedId;
      if (selectedId.value === undefined) continue;

      const selected = cloned.find((candidate) => candidate.id === selectedId.value);
      if (selected === undefined) {
        return err(
          new StructuredError(
            "PARSER_RESOLVER_INVALID_SELECTION",
            `Resolver ${resolver.id} selected unknown candidate ${selectedId.value}.`,
          ),
        );
      }

      return ok({
        status: "resolved",
        classification,
        candidates: cloned,
        selected,
        resolverId: resolver.id,
      });
    }

    return ok({
      status: "preserved",
      classification,
      candidates: cloned,
    });
  }
}

export const deterministicHighestScoreResolver = (
  supported: readonly AmbiguityClass[] = [
    "lexical",
    "syntactic",
    "reference",
    "scope",
    "semantic",
    "mixed",
    "unknown",
  ],
): AmbiguityResolver => ({
  id: "parser.highest-deterministic-score.v1",
  supported,
  kind: "deterministic",
  resolve(ambiguity) {
    const scored = ambiguity.candidates.filter(
      (candidate) => candidate.deterministicScore !== undefined,
    );
    if (scored.length !== ambiguity.candidates.length) return ok(undefined);

    const ordered = [...scored].sort(
      (left, right) =>
        (right.deterministicScore ?? Number.NEGATIVE_INFINITY) -
        (left.deterministicScore ?? Number.NEGATIVE_INFINITY),
    );
    const first = ordered[0];
    const second = ordered[1];
    if (
      first === undefined ||
      second === undefined ||
      first.deterministicScore === second.deterministicScore
    ) {
      return ok(undefined);
    }
    return ok(first.id);
  },
});

export const buildParseCandidates = <C>(
  forest: SyntaxForest,
  grounding: GroundingDocument,
  rules: readonly SemanticConstructionRule<C>[],
  context: C,
): Result<ParseCandidate[]> => {
  const valid = validateSyntaxForest(forest);
  if (!valid.ok) return valid;

  const nodes = new Map(valid.value.nodes.map((node) => [node.id, node] as const));
  const candidates: ParseCandidate[] = [];

  for (const rootNodeId of valid.value.roots) {
    const syntaxNode = nodes.get(rootNodeId);
    if (syntaxNode === undefined) continue;

    for (const rule of rules) {
      if (!rule.supports(syntaxNode)) continue;
      const constructed = rule.construct({
        forest: valid.value,
        syntaxNode,
        grounding,
        context,
      });
      if (!constructed.ok) return constructed;

      candidates.push({
        id: `candidate:${rootNodeId}:${rule.id}`,
        rootNodeId,
        operations: constructed.value,
        ambiguityTags:
          syntaxNode.alternatives.length > 1 ? ["syntactic"] : [],
      });
    }
  }

  if (candidates.length === 0) {
    return err(
      new StructuredError(
        "PARSER_NO_SEMANTIC_CONSTRUCTION",
        "No semantic construction rule produced a parse candidate.",
      ),
    );
  }

  return ok(candidates);
};

export const commitParseCandidate = (
  graph: InMemorySemanticGraph,
  candidate: ParseCandidate,
  validate: GraphValidator,
): Result<GraphCommit> =>
  graph.commit(graph.beginTransaction(candidate.operations), validate);
