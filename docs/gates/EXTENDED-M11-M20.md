# Extended M11-M20 evidence gate

Status vocabulary follows the repository contract: implementation is not verification.
This gate does not infer milestone completion from task numbering.

## Evidence map

| Extended milestone | Candidate evidence | Current branch status |
| --- | --- | --- |
| M11 deep semantics | `tests/conformance/t311-t320-scope-quantification.conformance.test.ts`; `t321-t330-event-time-modality`; `t331-t340-deixis-attitudes-evidence`; `t341-t350-presupposition-pragmatics` | implemented; existing suites already regression-tested |
| M12 discourse robustness | `t361-t370-questions-dialogue-acts`; `t371-t380-reference-ellipsis`; `t381-t390-discourse-information-structure` | implemented; existing suites already regression-tested |
| M13 typology robustness | `t401-t410-language-typology` plus full synthetic SOV/pro-drop `HumanLanguagePack` in `extended-m11-m20-gates.conformance.test.ts` | implemented, verification pending branch CI |
| M14 open vocabulary | `t391-t400-lexicon-open-vocabulary` and M18 open-world lexicon suites | implemented; existing suites already regression-tested |
| M15 synthesis grammar | grammar-backed `CandidateGenerator` integrated with `synthesizeProgram`; two held-out literal synthesis cases; `maxJevCalls=0` | implemented, verification pending branch CI |
| M16 CEGIS | `t461-t470-cegis.conformance.test.ts`: first candidate fails, counterexample retained, next candidate succeeds | verified on main |
| M17 proof evidence | `t471-t480-solver-proof.conformance.test.ts`: SAT/UNSAT plus honest UNKNOWN/TIMEOUT and bounded metadata | verified on main |
| M18 source-preserving repair | TypeScript compiler-backed repair + test/regression evidence + preservation benchmark + structural diff in extended gate suite | implemented, verification pending branch CI |
| M19 universal formal expression | one provenance-bearing semantic fact projected into Logic IR and structured Data IR with identical critical value | implemented, verification pending branch CI |
| M20 Action IR neutrality | externally supplied capability schema validates/builds without execution; undeclared capability is rejected | implemented, verification pending branch CI |

## Closure rules

The extended gate is verified only if the full deterministic CI gate passes with the new acceptance suite included.
A failure in any pre-existing regression suite invalidates closure even if the new extended tests pass.
No live or generative Jev request is permitted by this gate.

The following release gates remain separately accountable after M11-M20 evidence closure:
semantic preservation, ambiguity honesty, candidate recall, open-world safety, long-discourse stress,
multilingual invariance, translation-loss disclosure, program correctness, search-budget honesty,
solver honesty, source preservation, reproducibility, extension compatibility, anti-template,
anti-hidden-generator, anti-benchmark-special-case, phenomenon coverage accounting, and the
machine-readable unsupported-case ledger.
