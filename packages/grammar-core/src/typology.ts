import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";

export interface ConstituentRange {
  start: number;
  end: number;
}

export interface DiscontinuousConstituent {
  id: string;
  category: string;
  ranges: ConstituentRange[];
  childIds: string[];
}

export interface SyntacticDependencyEdge {
  id: string;
  headToken: number;
  dependentToken: number;
  relation: string;
}

export interface DependencyStructure {
  tokenCount: number;
  edges: SyntacticDependencyEdge[];
}

const validRange = (range: ConstituentRange): boolean =>
  Number.isInteger(range.start) &&
  Number.isInteger(range.end) &&
  range.start >= 0 &&
  range.end > range.start;

export const validateDiscontinuousConstituent = (
  constituent: DiscontinuousConstituent,
): Result<void> => {
  if (
    constituent.id.trim() === "" ||
    constituent.category.trim() === "" ||
    constituent.ranges.length === 0 ||
    constituent.ranges.some((range) => !validRange(range))
  ) {
    return err(
      new StructuredError(
        "GRAMMAR_DISCONTINUOUS_CONSTITUENT",
        "Discontinuous constituents require id, category, and valid token ranges.",
      ),
    );
  }
  const ordered = [...constituent.ranges].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (current.start < previous.end) {
      return err(
        new StructuredError(
          "GRAMMAR_DISCONTINUOUS_OVERLAP",
          "Discontinuous constituent ranges must not overlap.",
        ),
      );
    }
  }
  return ok(undefined);
};

const crosses = (
  left: SyntacticDependencyEdge,
  right: SyntacticDependencyEdge,
): boolean => {
  const [a,b]=[left.headToken,left.dependentToken].sort((x,y)=>x-y) as [number,number];
  const [c,d]=[right.headToken,right.dependentToken].sort((x,y)=>x-y) as [number,number];
  return (a < c && c < b && b < d) || (c < a && a < d && d < b);
};

export const validateDependencyStructure = (
  structure: DependencyStructure,
): Result<{ nonProjectiveEdgePairs: Array<[string,string]> }> => {
  if (!Number.isInteger(structure.tokenCount) || structure.tokenCount < 1) {
    return err(
      new StructuredError(
        "GRAMMAR_DEPENDENCY_TOKEN_COUNT",
        "Dependency structures require a positive token count.",
      ),
    );
  }
  const ids=new Set<string>();
  for(const edge of structure.edges){
    if(
      edge.id.trim()==="" ||
      edge.relation.trim()==="" ||
      ids.has(edge.id) ||
      !Number.isInteger(edge.headToken) ||
      !Number.isInteger(edge.dependentToken) ||
      edge.headToken < 0 ||
      edge.dependentToken < 0 ||
      edge.headToken >= structure.tokenCount ||
      edge.dependentToken >= structure.tokenCount ||
      edge.headToken === edge.dependentToken
    ){
      return err(
        new StructuredError(
          "GRAMMAR_DEPENDENCY_EDGE",
          "Dependency edges require unique ids, valid distinct token indexes, and relation labels.",
        ),
      );
    }
    ids.add(edge.id);
  }
  const pairs:Array<[string,string]>=[];
  for(let i=0;i<structure.edges.length;i+=1){
    for(let j=i+1;j<structure.edges.length;j+=1){
      const left=structure.edges[i]!;
      const right=structure.edges[j]!;
      if(crosses(left,right)) pairs.push([left.id,right.id]);
    }
  }
  return ok({nonProjectiveEdgePairs:pairs});
};

export interface ConstituentOrderingRequest {
  semanticRoles: string[];
  discourseRoles?: Record<string,"topic"|"focus"|"given"|"new"|"neutral">;
  clauseType: string;
}

export interface ConstituentOrderingProvider {
  readonly id: string;
  readonly language: string;
  order(input: ConstituentOrderingRequest): string[];
}

export const validateConstituentOrder = (
  requestedRoles: readonly string[],
  orderedRoles: readonly string[],
): Result<void> => {
  if (
    requestedRoles.length !== orderedRoles.length ||
    new Set(requestedRoles).size !== requestedRoles.length ||
    new Set(orderedRoles).size !== orderedRoles.length ||
    requestedRoles.some((role) => !orderedRoles.includes(role))
  ) {
    return err(
      new StructuredError(
        "GRAMMAR_CONSTITUENT_ORDER",
        "Constituent ordering must be a permutation of the requested semantic roles.",
      ),
    );
  }
  return ok(undefined);
};
