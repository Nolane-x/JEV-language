import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import {
  evaluateGrammarConstraints,
  grammarFeaturesSatisfy,
  type GrammarBinding,
  type GrammarCategory,
  type GrammarFeatures,
  type GrammarPattern,
  type GrammarRule,
} from "../../grammar-core/src/index.ts";
import type { LexicalMatch } from "../../lexicon-core/src/index.ts";
import {
  validateSyntaxForest,
  type PackedSyntaxNode,
  type SyntaxAlternative,
  type SyntaxForest,
} from "./index.ts";

export interface GrammarToken {
  surface: string;
  normalized: string;
  lexical: LexicalMatch[];
  features?: GrammarFeatures;
}

export interface PackedChartParseOptions {
  language: string;
  rules: GrammarRule[];
  rootCategories: GrammarCategory[];
  version?: string;
  maxPasses?: number;
}

interface MatchState {
  position: number;
  children: string[];
  binding: GrammarBinding;
}

const emptyBinding = (): GrammarBinding => ({
  categories: {},
  surfaces: {},
  lexical: {},
  features: {},
  featureSets: {},
});

const cloneBinding = (binding: GrammarBinding): GrammarBinding => ({
  categories: Object.fromEntries(
    Object.entries(binding.categories).map(([key, value]) => [
      key,
      [...value],
    ]),
  ),
  surfaces: Object.fromEntries(
    Object.entries(binding.surfaces).map(([key, value]) => [
      key,
      [...value],
    ]),
  ),
  lexical: Object.fromEntries(
    Object.entries(binding.lexical).map(([key, value]) => [
      key,
      value.map((item) => structuredClone(item)),
    ]),
  ),
  features: structuredClone(binding.features),
  ...(binding.featureSets === undefined
    ? {}
    : {
        featureSets: Object.fromEntries(
          Object.entries(binding.featureSets).map(([key, value]) => [
            key,
            structuredClone(value),
          ]),
        ),
      }),
});

const appendCapture = (
  binding: GrammarBinding,
  pattern: GrammarPattern,
  input: {
    categoryNodeId?: string;
    surface?: string;
    lexical?: LexicalMatch[];
    features?: GrammarFeatures;
  },
): GrammarBinding => {
  if (pattern.capture === undefined) return binding;
  const next = cloneBinding(binding);
  const capture = pattern.capture;
  if (input.categoryNodeId !== undefined) {
    next.categories[capture] = [
      ...(next.categories[capture] ?? []),
      input.categoryNodeId,
    ];
  }
  if (input.surface !== undefined) {
    next.surfaces[capture] = [
      ...(next.surfaces[capture] ?? []),
      input.surface,
    ];
  }
  if (input.lexical !== undefined) {
    next.lexical[capture] = [
      ...(next.lexical[capture] ?? []),
      ...input.lexical.map((item) => structuredClone(item)),
    ];
  }
  if (input.features !== undefined) {
    next.featureSets ??= {};
    next.featureSets[capture] = {
      ...(next.featureSets[capture] ?? {}),
      ...structuredClone(input.features),
    };
  }
  return next;
};

const lexicalMatchesPattern = (
  token: GrammarToken,
  pattern: Extract<GrammarPattern, { kind: "lexical" }>,
): LexicalMatch[] =>
  token.lexical.filter(
    (match) =>
      (pattern.partOfSpeech === undefined ||
        match.partOfSpeech === pattern.partOfSpeech) &&
      (pattern.semanticTag === undefined ||
        match.semanticTag === pattern.semanticTag),
  );

const nodeKey = (
  category: string,
  start: number,
  end: number,
): string => `${category}\u0000${start}\u0000${end}`;

const nodeId = (
  category: string,
  start: number,
  end: number,
): string => `syntax:${category}:${start}:${end}`;

const altSignature = (alternative: SyntaxAlternative): string =>
  JSON.stringify([
    alternative.ruleId,
    alternative.children,
    alternative.annotations ?? {},
  ]);

const bindingAnnotation = (binding: GrammarBinding): JsonValue => ({
  categories: binding.categories,
  surfaces: binding.surfaces,
  lexical: Object.fromEntries(
    Object.entries(binding.lexical).map(([capture, matches]) => [
      capture,
      matches.map((match) => ({
        lexemeId: match.lexemeId,
        senseId: match.senseId,
        lemma: match.lemma,
        partOfSpeech: match.partOfSpeech,
        semanticTag: match.semanticTag ?? null,
      })),
    ]),
  ),
  featureSets: binding.featureSets ?? {},
});

const categoryMatches = (
  nodes: ReadonlyMap<string, PackedSyntaxNode>,
  category: GrammarCategory,
  position: number,
  featureConstraints: GrammarPattern["featureConstraints"],
): PackedSyntaxNode[] =>
  [...nodes.values()]
    .filter(
      (node) =>
        node.category === category &&
        node.tokenStart === position &&
        grammarFeaturesSatisfy(
          (node.features ?? {}) as GrammarFeatures,
          featureConstraints,
        ),
    )
    .sort(
      (a, b) =>
        a.tokenEnd - b.tokenEnd ||
        a.id.localeCompare(b.id),
    );

const consumeSingle = (
  pattern: GrammarPattern,
  state: MatchState,
  tokens: readonly GrammarToken[],
  nodes: ReadonlyMap<string, PackedSyntaxNode>,
): MatchState[] => {
  if (pattern.kind === "category") {
    return categoryMatches(
      nodes,
      pattern.category,
      state.position,
      pattern.featureConstraints,
    ).map((node) => ({
      position: node.tokenEnd,
      children: [...state.children, node.id],
      binding: appendCapture(state.binding, pattern, {
        categoryNodeId: node.id,
        features: (node.features ?? {}) as GrammarFeatures,
      }),
    }));
  }

  const token = tokens[state.position];
  if (token === undefined) return [];
  if (
    !grammarFeaturesSatisfy(
      token.features ?? {},
      pattern.featureConstraints,
    )
  ) {
    return [];
  }

  if (pattern.kind === "literal") {
    const expected = pattern.caseSensitive === true
      ? pattern.surface
      : pattern.surface.toLocaleLowerCase();
    const actual = pattern.caseSensitive === true
      ? token.surface
      : token.normalized;
    if (expected !== actual) return [];
    return [
      {
        position: state.position + 1,
        children: [...state.children, nodeId("TOKEN", state.position, state.position + 1)],
        binding: appendCapture(state.binding, pattern, {
          surface: token.surface,
          features: token.features,
        }),
      },
    ];
  }

  const matches = lexicalMatchesPattern(token, pattern);
  if (matches.length === 0) return [];
  return [
    {
      position: state.position + 1,
      children: [...state.children, nodeId("TOKEN", state.position, state.position + 1)],
      binding: appendCapture(state.binding, pattern, {
        surface: token.surface,
        lexical: matches,
        features: token.features,
      }),
    },
  ];
};

const consumeRepeated = (
  pattern: GrammarPattern,
  state: MatchState,
  tokens: readonly GrammarToken[],
  nodes: ReadonlyMap<string, PackedSyntaxNode>,
  minimum: number,
): MatchState[] => {
  const output: MatchState[] = [];
  const queue: Array<{ state: MatchState; count: number }> = [
    { state, count: 0 },
  ];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const signature = JSON.stringify([
      current.state.position,
      current.state.children,
      current.count,
    ]);
    if (seen.has(signature)) continue;
    seen.add(signature);

    if (current.count >= minimum) {
      output.push(current.state);
    }
    if (current.state.position >= tokens.length) continue;

    const singlePattern = {
      ...pattern,
      repeat: undefined,
      optional: undefined,
    } as GrammarPattern;
    for (const next of consumeSingle(
      singlePattern,
      current.state,
      tokens,
      nodes,
    )) {
      if (next.position <= current.state.position) continue;
      queue.push({ state: next, count: current.count + 1 });
    }
  }

  return output;
};

const consumePattern = (
  pattern: GrammarPattern,
  state: MatchState,
  tokens: readonly GrammarToken[],
  nodes: ReadonlyMap<string, PackedSyntaxNode>,
): MatchState[] => {
  if (pattern.repeat === "zero-or-more") {
    return consumeRepeated(pattern, state, tokens, nodes, 0);
  }
  if (pattern.repeat === "one-or-more") {
    return consumeRepeated(pattern, state, tokens, nodes, 1);
  }

  const consumed = consumeSingle(pattern, state, tokens, nodes);
  return pattern.optional === true ? [state, ...consumed] : consumed;
};

const matchRuleAt = (
  rule: GrammarRule,
  start: number,
  tokens: readonly GrammarToken[],
  nodes: ReadonlyMap<string, PackedSyntaxNode>,
): MatchState[] => {
  let states: MatchState[] = [
    {
      position: start,
      children: [],
      binding: emptyBinding(),
    },
  ];

  for (const pattern of rule.rhs) {
    states = states.flatMap((state) =>
      consumePattern(pattern, state, tokens, nodes),
    );
    if (states.length === 0) return [];
  }

  return states.filter(
    (state) =>
      state.position > start &&
      evaluateGrammarConstraints(rule, state.binding),
  );
};

const terminalNodes = (
  tokens: readonly GrammarToken[],
): PackedSyntaxNode[] =>
  tokens.map((token, index) => ({
    id: nodeId("TOKEN", index, index + 1),
    category: "TOKEN",
    tokenStart: index,
    tokenEnd: index + 1,
    ...(token.features === undefined
      ? {}
      : { features: structuredClone(token.features) }),
    alternatives: [
      {
        ruleId: "terminal.token",
        children: [],
        annotations: {
          surface: token.surface,
          normalized: token.normalized,
          lexicalCount: token.lexical.length,
        },
      },
    ],
  }));

export const buildPackedGrammarForest = (
  tokens: readonly GrammarToken[],
  options: PackedChartParseOptions,
): Result<SyntaxForest> => {
  if (options.language.trim() === "") {
    return err(
      new StructuredError(
        "PARSER_CHART_LANGUAGE",
        "Packed chart parser requires a language.",
      ),
    );
  }
  if (tokens.length === 0) {
    return err(
      new StructuredError(
        "PARSER_CHART_EMPTY",
        "Packed chart parser requires at least one token.",
      ),
    );
  }

  const rules = options.rules
    .filter((rule) => rule.language === options.language)
    .sort(
      (a, b) =>
        (b.priority ?? 0) - (a.priority ?? 0) ||
        a.id.localeCompare(b.id),
    );
  if (rules.length === 0) {
    return err(
      new StructuredError(
        "PARSER_CHART_NO_RULES",
        `No grammar rules are available for ${options.language}.`,
      ),
    );
  }

  const nodes = new Map<string, PackedSyntaxNode>();
  for (const terminal of terminalNodes(tokens)) {
    nodes.set(
      nodeKey(terminal.category, terminal.tokenStart, terminal.tokenEnd),
      terminal,
    );
  }

  const maxPasses =
    options.maxPasses ??
    Math.max(8, rules.length * Math.max(2, tokens.length));
  let changed = true;
  let pass = 0;

  while (changed && pass < maxPasses) {
    changed = false;
    pass += 1;

    for (const rule of rules) {
      for (let start = 0; start < tokens.length; start += 1) {
        for (const match of matchRuleAt(rule, start, tokens, nodes)) {
          const key = nodeKey(rule.lhs, start, match.position);
          const existing = nodes.get(key);
          const alternative: SyntaxAlternative = {
            ruleId: rule.id,
            children: match.children,
            ...(rule.priority === undefined
              ? {}
              : { localScore: rule.priority }),
            annotations: {
              binding: bindingAnnotation(match.binding),
            },
          };

          if (existing === undefined) {
            nodes.set(key, {
              id: nodeId(rule.lhs, start, match.position),
              category: rule.lhs,
              tokenStart: start,
              tokenEnd: match.position,
              ...(rule.resultFeatures === undefined
                ? {}
                : {
                    features: structuredClone(rule.resultFeatures),
                  }),
              alternatives: [alternative],
            });
            changed = true;
            continue;
          }

          const signature = altSignature(alternative);
          if (
            !existing.alternatives.some(
              (value) => altSignature(value) === signature,
            )
          ) {
            existing.alternatives.push(alternative);
            existing.alternatives.sort(
              (a, b) =>
                (b.localScore ?? 0) - (a.localScore ?? 0) ||
                a.ruleId.localeCompare(b.ruleId) ||
                a.children.join("\u0000").localeCompare(
                  b.children.join("\u0000"),
                ),
            );
            changed = true;
          }
        }
      }
    }
  }

  if (changed) {
    return err(
      new StructuredError(
        "PARSER_CHART_PASS_BUDGET",
        `Packed chart parser exceeded maxPasses=${maxPasses}; grammar may contain non-consuming recursion.`,
      ),
    );
  }

  const roots = [...nodes.values()]
    .filter(
      (node) =>
        node.tokenStart === 0 &&
        node.tokenEnd === tokens.length &&
        options.rootCategories.includes(node.category),
    )
    .map((node) => node.id)
    .sort();

  if (roots.length === 0) {
    return err(
      new StructuredError(
        "PARSER_CHART_NO_ROOT",
        "Grammar produced no requested root spanning the complete token sequence.",
      ),
    );
  }

  return validateSyntaxForest({
    version: options.version ?? "1.0.0",
    roots,
    nodes: [...nodes.values()].sort(
      (a, b) =>
        a.tokenStart - b.tokenStart ||
        a.tokenEnd - b.tokenEnd ||
        a.category.localeCompare(b.category),
    ),
  });
};
