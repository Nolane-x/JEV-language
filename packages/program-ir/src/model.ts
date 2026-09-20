import type {
  Digest,
  JsonValue,
  SemanticId,
} from "../../core-types/src/index.ts";

export type ProgramId = string;
export type ProgramRef = ProgramId;
export type HoleId = string;

export type Visibility =
  | "public"
  | "internal"
  | "private"
  | "protected"
  | "package";

export interface NamingIntent {
  semanticPurpose?: SemanticId;
  preferredTerms?: string[];
  style?: "camel" | "pascal" | "snake" | "backend-default";
}

export interface SourceBinding {
  sourceId: string;
  language?: string;
  existingName?: string;
  start?: number;
  end?: number;
  digest?: Digest;
}

export type PirType =
  | { kind: "boolean" }
  | { kind: "number" }
  | { kind: "string" }
  | { kind: "null" }
  | { kind: "void" }
  | { kind: "never" }
  | { kind: "unknown" }
  | { kind: "record"; fields: Record<string, PirType> }
  | { kind: "list"; element: PirType }
  | { kind: "tuple"; elements: PirType[] }
  | { kind: "optional"; inner: PirType }
  | { kind: "union"; options: PirType[] }
  | { kind: "intersection"; members: PirType[] }
  | {
      kind: "function";
      parameters: PirType[];
      returns: PirType;
      effects?: EffectSpec[];
    }
  | {
      kind: "named";
      symbolId: ProgramRef;
      typeArguments?: PirType[];
    }
  | {
      kind: "generic";
      base: PirType;
      arguments: PirType[];
    }
  | {
      kind: "collection";
      collectionKind: "set" | "map" | "iterable";
      value: PirType;
      key?: PirType;
    }
  | {
      kind: "type-variable";
      id: ProgramId;
      name: string;
      bound?: PirType;
    }
  | {
      kind: "result";
      ok: PirType;
      error: PirType;
    }
  | {
      kind: "variant";
      cases: Record<string, PirType | null>;
    }
  | {
      kind: "promise";
      value: PirType;
    };

export type PirEffectKind =
  | "pure"
  | "read-memory"
  | "write-memory"
  | "filesystem-read"
  | "filesystem-write"
  | "network"
  | "process"
  | "randomness"
  | "time"
  | "throw"
  | "async"
  | "unknown";

export interface EffectSpec {
  kind: PirEffectKind;
  resource?: ProgramRef | SemanticId;
}

export interface HoleBudget {
  maxExpansions?: number;
  maxDepth?: number;
  maxCost?: number;
}

export interface ProgramHoleScope {
  visibleSymbols: ProgramRef[];
  allowGlobalSymbols: boolean;
  functionRef?: ProgramRef;
}

export interface ProgramHoleEffectConstraints {
  allowed: PirEffectKind[];
  forbidden: PirEffectKind[];
}

export interface ProgramHoleConstraintSet {
  allowedCandidateFamilies?: string[];
  forbiddenCandidateFamilies?: string[];
  requiredCapabilities?: string[];
  maxCandidateCost?: number;
  deterministicOnly?: boolean;
}

export interface ProgramHole {
  id: HoleId;
  expectedType?: PirType;
  expectedEffect?: PirEffectKind | PirEffectKind[];
  requiredFacts: SemanticId[];
  forbiddenFacts: SemanticId[];
  scopeSymbols: ProgramRef[];
  /**
   * Structured scope/effect/constraint surface for synthesis grammar expansion.
   * Legacy scopeSymbols/expectedEffect remain normative compatibility fields.
   */
  scope?: ProgramHoleScope;
  effectConstraints?: ProgramHoleEffectConstraints;
  constraints?: ProgramHoleConstraintSet;
  purpose?: SemanticId;
  budget: HoleBudget;
  sourceBinding?: SourceBinding;
}

export interface PirParameter {
  id: ProgramId;
  name: string;
  type: PirType;
  semanticPurpose?: SemanticId;
  sourceBinding?: SourceBinding;
}

export interface PirSymbol {
  id: ProgramId;
  symbolKind:
    | "type"
    | "function"
    | "variable"
    | "field"
    | "parameter"
    | "module";
  semanticPurpose?: SemanticId;
  existingName?: string;
  namingIntent?: NamingIntent;
  type?: PirType;
  visibility: Visibility;
  sourceBinding?: SourceBinding;
}

export interface ImportIntent {
  module: string;
  symbols?: string[];
  typeOnly?: boolean;
  semanticPurpose?: SemanticId;
}

export interface PirModule {
  id: ProgramId;
  kind: "module";
  nameIntent: NamingIntent;
  exports: ProgramRef[];
  imports: ImportIntent[];
  declarations: ProgramRef[];
  documentation?: SemanticId[];
  sourceBinding?: SourceBinding;
}

export type PirLiteral = JsonValue;

export type PirUnaryOperator = "not" | "negate" | "positive" | "bit-not";
export type PirBinaryOperator =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "modulo"
  | "power";
export type PirComparisonOperator =
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "identity";
export type PirLogicalOperator = "and" | "or" | "xor";

export type PirPattern =
  | { kind: "wildcard" }
  | { kind: "literal"; value: PirLiteral }
  | { kind: "variant"; tag: string; bindingSymbolId?: ProgramId }
  | { kind: "type"; type: PirType; bindingSymbolId?: ProgramId };

export type PirExpression =
  | {
      kind: "hole";
      id: HoleId;
      expected: PirType;
      purpose?: SemanticId;
    }
  | { kind: "literal"; value: PirLiteral; type: PirType }
  | { kind: "variable"; symbolId: ProgramRef }
  | { kind: "symbol-ref"; symbolId: ProgramRef }
  | { kind: "property"; object: PirExpression; property: string }
  | { kind: "field-access"; object: PirExpression; field: string }
  | { kind: "index-access"; object: PirExpression; index: PirExpression }
  | {
      kind: "call";
      callee: PirExpression;
      arguments: PirExpression[];
    }
  | {
      kind: "construct";
      targetType: PirType;
      arguments: PirExpression[];
    }
  | {
      kind: "unary";
      operator: PirUnaryOperator;
      operand: PirExpression;
    }
  | {
      kind: "binary";
      operator: PirBinaryOperator;
      left: PirExpression;
      right: PirExpression;
    }
  | {
      kind: "comparison";
      operator: PirComparisonOperator;
      left: PirExpression;
      right: PirExpression;
    }
  | {
      kind: "logical";
      operator: PirLogicalOperator;
      values: PirExpression[];
    }
  | {
      kind: "conditional";
      condition: PirExpression;
      whenTrue: PirExpression;
      whenFalse: PirExpression;
    }
  | {
      kind: "lambda";
      parameters: PirParameter[];
      body: PirExpression;
      effects?: EffectSpec[];
    }
  | {
      kind: "await";
      value: PirExpression;
    }
  | {
      kind: "cast";
      value: PirExpression;
      targetType: PirType;
    }
  | {
      kind: "collection";
      collectionKind: "list" | "set" | "tuple";
      elements: PirExpression[];
      elementType?: PirType;
    }
  | {
      kind: "record";
      fields: Record<string, PirExpression>;
    }
  | {
      kind: "match";
      value: PirExpression;
      cases: Array<{ pattern: PirPattern; expression: PirExpression }>;
      resultType: PirType;
    }
  | {
      kind: "filter";
      collection: PirExpression;
      item: PirParameter;
      predicate: PirExpression;
    }
  | {
      kind: "map";
      collection: PirExpression;
      item: PirParameter;
      mapper: PirExpression;
      resultElementType: PirType;
    };

export interface PirCatchClause {
  parameter?: PirParameter;
  body: PirStatement[];
}

export type PirStatement =
  | {
      kind: "declare";
      symbol: PirSymbol;
      type: PirType;
      initializer?: PirExpression;
    }
  | {
      kind: "assign";
      target: PirExpression;
      value: PirExpression;
    }
  | { kind: "expression"; expression: PirExpression }
  | { kind: "return"; value?: PirExpression }
  | {
      kind: "if";
      condition: PirExpression;
      then: PirStatement[];
      else?: PirStatement[];
    }
  | {
      kind: "loop";
      condition?: PirExpression;
      body: PirStatement[];
    }
  | {
      kind: "for-each";
      item: PirParameter;
      collection: PirExpression;
      body: PirStatement[];
    }
  | {
      kind: "match";
      value: PirExpression;
      cases: Array<{ pattern: PirPattern; body: PirStatement[] }>;
      default?: PirStatement[];
    }
  | {
      kind: "try";
      body: PirStatement[];
      catch?: PirCatchClause;
      finally?: PirStatement[];
    }
  | { kind: "throw"; value: PirExpression }
  | { kind: "assert"; condition: PirExpression; message?: string }
  | { kind: "break" }
  | { kind: "continue" }
  | { kind: "defer"; body: PirStatement[] }
  | { kind: "block"; statements: PirStatement[] }
  | { kind: "hole"; holeId: HoleId };

export interface ErrorContract {
  id: string;
  condition?: SemanticId;
  errorType?: PirType;
  recoverable: boolean;
}

export interface ContractProvenance {
  source: "requirement" | "type" | "test" | "inferred";
  refs: Array<SemanticId | string>;
}

export interface FunctionContract {
  preconditions: SemanticId[];
  postconditions: SemanticId[];
  invariants?: SemanticId[];
  effects?: EffectSpec[];
  errorCases?: ErrorContract[];
  provenance: ContractProvenance[];
}

export interface PirFunction {
  kind: "function";
  id: ProgramId;
  name: string;
  parameters: PirParameter[];
  returnType: PirType;
  typeParameters?: Array<Extract<PirType, { kind: "type-variable" }>>;
  body?: PirExpression;
  statements?: PirStatement[];
  contract?: FunctionContract;
  effects?: EffectSpec[];
  async?: boolean;
  visibility?: Visibility;
  semanticPurpose?: SemanticId;
  sourceBinding?: SourceBinding;
}

export interface PirProgram {
  version: string;
  modules?: PirModule[];
  symbols?: PirSymbol[];
  functions: PirFunction[];
  holes?: ProgramHole[];
  sourceBindings?: SourceBinding[];
  annotations?: Record<string, JsonValue>;
}

export type PirGraph = PirProgram;

const sameTypeList = (
  a: readonly PirType[],
  b: readonly PirType[],
): boolean =>
  a.length === b.length && a.every((value, index) => samePirType(value, b[index]!));

const sameEffects = (
  a: readonly EffectSpec[] | undefined,
  b: readonly EffectSpec[] | undefined,
): boolean => {
  const left = [...(a ?? [])].map((effect) => JSON.stringify(effect)).sort();
  const right = [...(b ?? [])].map((effect) => JSON.stringify(effect)).sort();
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
};

export const samePirType = (a: PirType, b: PirType): boolean => {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "boolean":
    case "number":
    case "string":
    case "null":
    case "void":
    case "never":
    case "unknown":
      return true;
    case "list":
      return b.kind === "list" && samePirType(a.element, b.element);
    case "record": {
      if (b.kind !== "record") return false;
      const aKeys = Object.keys(a.fields).sort();
      const bKeys = Object.keys(b.fields).sort();
      return (
        aKeys.length === bKeys.length &&
        aKeys.every(
          (key, index) =>
            key === bKeys[index] &&
            b.fields[key] !== undefined &&
            samePirType(a.fields[key]!, b.fields[key]!),
        )
      );
    }
    case "tuple":
      return b.kind === "tuple" && sameTypeList(a.elements, b.elements);
    case "optional":
      return b.kind === "optional" && samePirType(a.inner, b.inner);
    case "union":
      return b.kind === "union" && sameTypeList(a.options, b.options);
    case "intersection":
      return b.kind === "intersection" && sameTypeList(a.members, b.members);
    case "function":
      return (
        b.kind === "function" &&
        sameTypeList(a.parameters, b.parameters) &&
        samePirType(a.returns, b.returns) &&
        sameEffects(a.effects, b.effects)
      );
    case "named":
      return (
        b.kind === "named" &&
        a.symbolId === b.symbolId &&
        sameTypeList(a.typeArguments ?? [], b.typeArguments ?? [])
      );
    case "generic":
      return (
        b.kind === "generic" &&
        samePirType(a.base, b.base) &&
        sameTypeList(a.arguments, b.arguments)
      );
    case "collection":
      return (
        b.kind === "collection" &&
        a.collectionKind === b.collectionKind &&
        samePirType(a.value, b.value) &&
        ((a.key === undefined && b.key === undefined) ||
          (a.key !== undefined &&
            b.key !== undefined &&
            samePirType(a.key, b.key)))
      );
    case "type-variable":
      return (
        b.kind === "type-variable" &&
        a.id === b.id &&
        ((a.bound === undefined && b.bound === undefined) ||
          (a.bound !== undefined &&
            b.bound !== undefined &&
            samePirType(a.bound, b.bound)))
      );
    case "result":
      return (
        b.kind === "result" &&
        samePirType(a.ok, b.ok) &&
        samePirType(a.error, b.error)
      );
    case "variant": {
      if (b.kind !== "variant") return false;
      const aKeys = Object.keys(a.cases).sort();
      const bKeys = Object.keys(b.cases).sort();
      return (
        aKeys.length === bKeys.length &&
        aKeys.every((key, index) => {
          if (key !== bKeys[index]) return false;
          const left = a.cases[key];
          const right = b.cases[key];
          return left === null
            ? right === null
            : left !== undefined &&
                right !== undefined &&
                right !== null &&
                samePirType(left, right);
        })
      );
    }
    case "promise":
      return b.kind === "promise" && samePirType(a.value, b.value);
  }
};

export const isStatementBody = (
  fn: PirFunction,
): fn is PirFunction & { statements: PirStatement[] } =>
  fn.statements !== undefined;

export const isExpressionBody = (
  fn: PirFunction,
): fn is PirFunction & { body: PirExpression } =>
  fn.body !== undefined;
