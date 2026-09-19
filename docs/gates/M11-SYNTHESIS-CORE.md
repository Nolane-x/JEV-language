# M11 — Synthesis Core Gate Evidence

Status: **candidate — pending CI**

Specification basis: Sections 272–280, 419–420 and tasks T194–T208 of the v0.4 master specification.

## Definition-of-Done mapping

| M11 requirement | Repository evidence |
| --- | --- |
| typed holes | M10 `ProgramHole` plus expression/statement-hole location support |
| ExpansionCandidate | `ExpansionCandidate` + expression/statement replacement union |
| CandidateGenerator ABI | `CandidateGenerator`, `CandidateGeneratorRegistry` |
| in-scope symbol generator | `InScopeSymbolGenerator` |
| literal generator | `LiteralGenerator` |
| function-call generator | `FunctionCallGenerator` with typed argument holes |
| branch generator | `BranchGenerator` with typed true/false child holes |
| collection-pattern generators | `CollectionPatternGenerator` for typed filter/map patterns |
| return generator | `ReturnGenerator` for statement holes |
| hard constraint pruning | `evaluateHardConstraints()`, `hardPruneCandidates()` |
| state hashing | `hashSynthesisState()` excludes path cost/priority so equivalent states deduplicate |
| best-first frontier | `BestFirstFrontier` |
| beam frontier | `BeamFrontier` |
| search budgets | global state/depth/Jev/compiler/test/deadline/memory plus per-hole expansion/depth/cost limits |
| Jev ranking | `JevChoiceCandidateRanker` uses bounded JDR Choice over already-valid candidate IDs |
| partial failures | structured `SynthesisFailure` retaining best partial PIR, unresolved holes, diagnostics, trace and usage |
| semantic acceptance | `ProgramAcceptanceVerifier` must accept a complete candidate before success |
| traceability | generator history plus candidate/state/pruning/ranking/solution/failure trace events |

Jev never creates PIR or source text in this search path. Type/effect/scope/PIR-validity pruning happens first; Jev receives only bounded, already-legal candidate IDs plus the synthesis requirements.

## Unseen-program proof

`tests/conformance/m11-synthesis-core.conformance.test.ts` constructs hole-containing problem skeletons rather than storing complete target PIR programs.

The suite synthesizes multiple unseen structures through typed expansion:

1. identity function body from an in-scope typed symbol;
2. a boolean literal selected through recorded bounded Jev ranking and then accepted by a semantic verifier;
3. a function call plus a separately synthesized typed argument hole;
4. a conditional branch plus independently synthesized child holes;
5. a collection map pattern inferred from an in-scope record-list type;
6. a statement-body return expansion replacing an explicit statement hole.

The proof also checks that complete candidates must pass problem acceptance verifiers before being reported as solutions.

## Search/invariant conformance

The M11 suite additionally checks:

- illegal effects are deterministically pruned before ranking;
- equivalent states reached by different candidate IDs are deduplicated;
- recorded Jev ranking can influence only the soft frontier tie-break;
- duplicate generator IDs are rejected;
- best-first and beam frontiers are pluggable;
- state/deadline exhaustion returns a structured partial result;
- compiler and test verifier budgets are enforced;
- serialized-state memory budget is enforced;
- no live Jev request is used;
- the six required first-wave generator families are discoverable from the core registry.

## Non-claims

M11 does not claim:

- TypeScript/Python backend source generation;
- compiler-backed CEGIS;
- repair loops;
- symbolic solving;
- broad API/domain pattern libraries.

Those remain later milestones/research tasks.

## Gate rule

Do not mark M11 verified or advance `last_completed_gate` until this branch passes package-boundary validation, strict TypeScript, and the full deterministic test suite. No additional live Jev request is required or allowed for this gate.
