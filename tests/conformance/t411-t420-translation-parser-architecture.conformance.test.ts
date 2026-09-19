import { describe, expect, it } from "vitest";
import type { GraphSnapshot } from "../../packages/semantic-graph/src/index.ts";
import {
  ROBUST_PARSER_PROFILE,
  STRICT_PARSER_PROFILE,
  buildParseRankingBreakdown,
  forcedDisambiguationDiagnostic,
  stagedDeterministicPrune,
  validatePackedLexicalLattice,
  validatePackedSyntaxSemanticForest,
  validateParserProfile,
  validatePartialSemanticCandidate,
  type TypedSemanticComposition,
} from "../../packages/parser-core/src/index.ts";
import { translateViaSemanticTransfer } from "../../packages/universal-expression/src/index.ts";
import { verifyTranslationInvariants } from "../../packages/verifier-core/src/index.ts";

const graph = (revision: string): GraphSnapshot => ({
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  revision,
  nodes: [],
});

describe("T411-T420 translation and parser architecture conformance", () => {
  it("T411 performs semantic-transfer translation through a shared graph", async () => {
    const shared = graph("rev:source");
    const result = await translateViaSemanticTransfer({
      request: {
        sourceLanguage: "en",
        targetLanguage: "vi",
        sourceSurface: "System ready.",
      },
      parser: {
        id: "mock-parser",
        parse: () => ({ ok: true, value: shared }),
      },
      realizer: {
        id: "mock-realizer",
        realize: () => ({ ok: true, value: "Hệ thống sẵn sàng." }),
      },
      reparseTarget: {
        id: "mock-reparser",
        parse: () => ({ ok: true, value: shared }),
      },
      targetSurfaceToString: (surface) => surface,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sourceGraph).toEqual(shared);
      expect(result.value.targetGraph).toEqual(shared);
      expect(result.value.targetSurface).toBe("Hệ thống sẵn sàng.");
    }
  });

  it("T412 verifies translation invariants over source/target semantic graphs", () => {
    const source=graph("rev:a");
    const target=graph("rev:b");
    const result=verifyTranslationInvariants({
      sourceLanguage:"en",
      targetLanguage:"vi",
      sourceGraph:source,
      targetGraph:target,
    });
    expect(result.ok).toBe(true);
    if(result.ok){
      expect(result.value.ok).toBe(true);
      expect(result.value.preservation.violations).toEqual([]);
    }
  });

  it("T413 requires explicit diagnostics whenever ambiguity is forcibly collapsed", () => {
    const diagnostic=forcedDisambiguationDiagnostic({
      ambiguityClass:"scope",
      sourceAlternatives:["scope:a","scope:b"],
      selectedAlternative:"scope:a",
      reason:"target grammar requires one overt ordering",
      targetConstraint:"mock-target.scope-order",
    });
    expect(diagnostic.ok).toBe(true);
    if(diagnostic.ok){
      expect(diagnostic.value.code).toBe("PARSER_FORCED_DISAMBIGUATION");
      expect(diagnostic.value.sourceAlternatives).toHaveLength(2);
    }
    expect(
      forcedDisambiguationDiagnostic({
        ambiguityClass:"scope",
        sourceAlternatives:["scope:a"],
        selectedAlternative:"scope:a",
        reason:"bad",
      }).ok,
    ).toBe(false);
  });

  it("T414 validates packed lexical lattices with overlapping alternatives", () => {
    const result=validatePackedLexicalLattice({
      tokenCount:2,
      alternatives:[
        {id:"lex:a",tokenStart:0,tokenEnd:1,senseId:"sense:a",score:1},
        {id:"lex:b",tokenStart:0,tokenEnd:1,senseId:"sense:b",score:0.8},
        {id:"lex:mwe",tokenStart:0,tokenEnd:2,semanticTag:"multiword",score:0.9},
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("T415-T417 validates packed syntax/semantic forests and typed partial graph holes", () => {
    const partial={
      id:"partial:1",
      rootNodeId:"syntax:S:0:1",
      operations:[],
      holes:[
        {
          id:"hole:predicate",
          expectedKinds:["concept","event"],
          required:true,
          sourceSyntaxNode:"syntax:S:0:1",
        },
      ],
    };
    expect(validatePartialSemanticCandidate(partial).ok).toBe(true);
    expect(
      validatePackedSyntaxSemanticForest({
        syntax:{
          version:"1.0.0",
          roots:["syntax:S:0:1"],
          nodes:[
            {
              id:"syntax:S:0:1",
              category:"S",
              tokenStart:0,
              tokenEnd:1,
              alternatives:[{ruleId:"mock.s",children:[]}],
            },
          ],
        },
        lexical:{
          tokenCount:1,
          alternatives:[
            {id:"lex:0",tokenStart:0,tokenEnd:1,semanticTag:"unknown"},
          ],
        },
        semanticAlternatives:[
          {
            id:"sem:partial",
            syntaxRoot:"syntax:S:0:1",
            candidate:partial,
            ambiguityTags:["semantic"],
          },
        ],
      }).ok,
    ).toBe(true);
  });

  it("T416 provides typed semantic composition functions", () => {
    const composition:TypedSemanticComposition<{predicate:string}>={
      id:"compose:predicate",
      compose(input){
        return {
          ok:true,
          value:{
            operations:[],
            holes:input.binding.predicate===""
              ? [{
                  id:"hole:predicate",
                  expectedKinds:["concept"],
                  required:true,
                  sourceSyntaxNode:input.syntaxNodeId,
                }]
              : [],
          },
        };
      },
    };
    const result=composition.compose({
      binding:{predicate:""},
      syntaxNodeId:"syntax:S:0:1",
    });
    expect(result.ok).toBe(true);
    if(result.ok) expect(result.value.holes).toHaveLength(1);
  });

  it("T418 prunes deterministically in inspectable stage order", () => {
    const result=stagedDeterministicPrune(
      [{id:"a"},{id:"b"},{id:"c"}],
      [
        {
          candidateId:"b",
          stage:"semantic-type",
          reject:true,
          reason:"type mismatch",
        },
        {
          candidateId:"c",
          stage:"grammar-constraints",
          reject:true,
          reason:"agreement mismatch",
        },
      ],
    );
    expect(result.ok).toBe(true);
    if(result.ok){
      expect(result.value.retained.map(item=>item.id)).toEqual(["a"]);
      expect(result.value.rejected).toMatchObject([
        {candidate:{id:"b"},stage:"semantic-type"},
        {candidate:{id:"c"},stage:"grammar-constraints"},
      ]);
    }
  });

  it("T419 exposes parse-ranking components and deterministic total", () => {
    const result=buildParseRankingBreakdown("candidate:a",[
      {name:"grammar",score:0.9,weight:2,rationale:"grammar coverage"},
      {name:"semantic",score:1,weight:3,rationale:"semantic compatibility"},
    ]);
    expect(result.ok).toBe(true);
    if(result.ok){
      expect(result.value.total).toBeCloseTo(4.8,10);
      expect(result.value.components).toHaveLength(2);
    }
  });

  it("T420 distinguishes strict and robust parser profiles explicitly", () => {
    expect(validateParserProfile(STRICT_PARSER_PROFILE).ok).toBe(true);
    expect(validateParserProfile(ROBUST_PARSER_PROFILE).ok).toBe(true);
    expect(STRICT_PARSER_PROFILE.allowPartialGraphs).toBe(false);
    expect(STRICT_PARSER_PROFILE.maximumSemanticHoles).toBe(0);
    expect(ROBUST_PARSER_PROFILE.allowPartialGraphs).toBe(true);
    expect(ROBUST_PARSER_PROFILE.allowUnknownLexemes).toBe(true);
  });
});
