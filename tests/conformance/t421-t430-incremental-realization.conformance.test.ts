import { describe, expect, it } from "vitest";
import {
  IncrementalUtteranceParseState,
  createParserRecoveryDiagnostic,
} from "../../packages/parser-core/src/index.ts";
import {
  createRealizationReplay,
  deaggregateFallback,
  evaluateRealizationCandidates,
  planAggregation,
  replayRealization,
  simulateReferenceAmbiguity,
  validateRealizationCandidateLattice,
  type RealizationCandidate,
} from "../../packages/realizer-core/src/index.ts";
import type { SemanticId } from "../../packages/core-types/src/index.ts";

const sid=(value:string):SemanticId=>value as SemanticId;
const candidates:RealizationCandidate[]=[
  {id:"candidate:a",surface:"The system is ready.",semanticRefs:[sid("prop:ready")]},
  {id:"candidate:b",surface:"The system is fully ready.",semanticRefs:[sid("prop:ready")]},
];

describe("T421-T430 incremental parsing and realization conformance",()=>{
  it("T421 maintains revisioned incremental utterance parse state",()=>{
    const state=new IncrementalUtteranceParseState("parse:1","en");
    expect(state.appendToken("The")).toEqual({ok:true,value:1});
    expect(state.appendToken("system")).toEqual({ok:true,value:2});
    expect(state.snapshot()).toMatchObject({
      id:"parse:1",
      language:"en",
      revision:2,
      tokens:["The","system"],
    });
  });

  it("T422 separates provisional semantics from monotonically committed semantics",()=>{
    const state=new IncrementalUtteranceParseState("parse:2","en");
    state.appendToken("maybe");
    expect(state.replaceProvisionalSemantic([]).ok).toBe(true);
    expect(state.snapshot().semantic.provisionalOperations).toEqual([]);
    expect(state.commitSemanticBoundary({throughToken:1,operations:[]}).ok).toBe(true);
    state.appendToken("tomorrow");
    expect(state.replaceProvisionalSemantic([]).ok).toBe(true);
    expect(
      state.commitSemanticBoundary({throughToken:0,operations:[]}).ok,
    ).toBe(false);
    expect(state.snapshot().semantic.committedThroughToken).toBe(1);
  });

  it("T423 produces inspectable parser recovery diagnostics without claiming semantic safety",()=>{
    const diagnostic=createParserRecoveryDiagnostic({
      tokenStart:2,
      tokenEnd:3,
      unexpectedSurface:"???",
      expected:["NP","VP"],
      recovery:"preserve-hole",
      message:"Preserve a typed semantic hole until more context arrives.",
      committedSemanticSafe:false,
    });
    expect(diagnostic.ok).toBe(true);
    if(diagnostic.ok){
      expect(diagnostic.value.code).toBe("PARSER_RECOVERY");
      expect(diagnostic.value.committedSemanticSafe).toBe(false);
    }
  });

  it("T424 validates a realization candidate lattice indexed by semantic refs",()=>{
    expect(
      validateRealizationCandidateLattice({
        candidates,
        alternativesBySemanticRef:{
          "prop:ready":["candidate:a","candidate:b"],
        },
      }).ok,
    ).toBe(true);
  });

  it("T425 rejects hard realization constraint violations before soft preference",()=>{
    const result=evaluateRealizationCandidates({
      candidates,
      hardConstraints:[
        {
          id:"must-not-add-fully",
          description:"Do not add unsupported intensification.",
          check:candidate=>!candidate.surface.includes("fully"),
        },
      ],
      softObjectives:[
        {
          id:"brevity",
          description:"Prefer shorter surfaces.",
          weight:1,
          score:candidate=>-candidate.surface.length,
        },
      ],
    });
    expect(result.ok).toBe(true);
    if(result.ok){
      expect(result.value[0]?.candidate.id).toBe("candidate:a");
      expect(result.value[0]?.hardFailures).toEqual([]);
      expect(result.value[1]?.hardFailures).toEqual(["must-not-add-fully"]);
    }
  });

  it("T426 keeps soft realization objectives separate and inspectable",()=>{
    const result=evaluateRealizationCandidates({
      candidates,
      hardConstraints:[],
      softObjectives:[
        {
          id:"brevity",
          description:"Prefer shorter surface.",
          weight:2,
          score:candidate=>-candidate.surface.length,
        },
        {
          id:"directness",
          description:"Mock directness score.",
          weight:1,
          score:candidate=>candidate.id==="candidate:a"?1:0.5,
        },
      ],
    });
    expect(result.ok).toBe(true);
    if(result.ok){
      expect(result.value[0]?.softComponents).toHaveLength(2);
      expect(result.value[0]?.hardFailures).toEqual([]);
    }
  });

  it("T427 simulates reference ambiguity before emitting a referring expression",()=>{
    const result=simulateReferenceAmbiguity({
      expression:"the server",
      intendedRef:sid("server:a"),
      candidateRefs:[sid("server:a"),sid("server:b")],
      compatible:()=>true,
    });
    expect(result.ok).toBe(true);
    if(result.ok){
      expect(result.value.ambiguous).toBe(true);
      expect(result.value.compatibleRefs).toEqual([
        sid("server:a"),
        sid("server:b"),
      ]);
    }
  });

  it("T428 plans aggregation only for compatible semantic units",()=>{
    const result=planAggregation([
      {
        id:"u1",
        semanticRefs:[sid("prop:a")],
        subjectRef:sid("entity:server"),
        polarity:"positive",
        tense:"present",
      },
      {
        id:"u2",
        semanticRefs:[sid("prop:b")],
        subjectRef:sid("entity:server"),
        polarity:"positive",
        tense:"present",
      },
      {
        id:"u3",
        semanticRefs:[sid("prop:c")],
        subjectRef:sid("entity:server"),
        polarity:"negative",
        tense:"present",
      },
    ]);
    expect(result.ok).toBe(true);
    if(result.ok){
      expect(result.value.groups).toMatchObject([
        {memberIds:["u1","u2"],reversible:true},
      ]);
      expect(result.value.ungroupedIds).toEqual(["u3"]);
    }
  });

  it("T429 deaggregates a reversible group without losing original unit identity",()=>{
    expect(
      deaggregateFallback({
        id:"aggregation:u1+u2",
        memberIds:["u1","u2"],
        reversible:true,
        reason:"shared subject, polarity, and tense",
      }),
    ).toEqual(["u1","u2"]);
  });

  it("T430 replays realization selection deterministically from seed and candidate set",()=>{
    const first=createRealizationReplay(candidates,"seed:t430");
    expect(first.ok).toBe(true);
    if(first.ok){
      expect(replayRealization(candidates,first.value)).toEqual({
        ok:true,
        value:first.value.selectedId,
      });
      expect(
        replayRealization(
          [...candidates,{id:"candidate:c",surface:"Ready.",semanticRefs:[sid("prop:ready")]}],
          first.value,
        ).ok,
      ).toBe(false);
    }
  });
});
