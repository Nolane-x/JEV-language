# M17 — Verification Hardening Gate Evidence

Status: **candidate — pending CI**

Specification basis: Section 427 and tasks T259–T267 of the v0.4 master specification.

## Section-427 mapping

| Requirement | Repository evidence |
| --- | --- |
| semantic equivalence verifier | `SemanticPreservationVerifier`, critical preservation profile and semantic invariant diagnostics |
| round-trip verifier | `RoundTripVerifier`; realization → parse-back → semantic comparison with parser failure retained as `unknown` |
| provenance checks | `ProvenanceIntegrityVerifier`: required refs, ancestry closure, duplicate IDs, cycles and trust monotonicity |
| trust checks | `TrustVerifier`: authority escalation and provenance retention |
| requirement satisfaction | `RequirementSatisfactionVerifier` and per-requirement status report |
| language grammar validation | `GrammarVerifierAdapter` across feature/morphology/language-pack/parse-back/forbidden-form evidence |
| program compile/test evidence | `ProgramEvidenceVerifier` with missing tests never promoted to success |
| replay bundles | `runVerificationPlan()` + `createReplayBundle()` + replay digest/result/authoritative integrity checks |

## Orchestration hardening

`VerificationRegistry` rejects duplicate verifier IDs and routes only verifiers that declare support for an obligation.

`runVerificationPlan()` additionally enforces:

- returned obligation ID must match the requested obligation;
- returned verifier ID/version/mode must match the registered manifest;
- a claimed `pass` without evidence is downgraded to `unknown`;
- deterministic evidence precedes external-tool evidence, which precedes Jev judgment;
- conflicting determinate results inside the same authoritative tier become explicit `unknown`, never first-result-wins;
- deterministic failure cannot be overridden by Jev judgment;
- required `unknown` remains distinct from pass;
- the report includes both strongest available evidence and the weakest required-evidence floor.

## Replay hardening

Each verification run records:

- execution-plan digest;
- per-verifier result digest;
- authoritative result digest for every obligation;
- verifier start/finish events;
- authoritative-selection events;
- configuration digest;
- external/recorded evidence references where present.

`verifyReplayBundleIntegrity()` recomputes the canonical replay bundle digest.

`verifyVerificationReplay()` additionally recomputes and checks:

- execution-plan digest;
- raw result digests;
- authoritative decision digests;
- trace references for every raw and authoritative result.

Modifying a replay event without regenerating the digest is a hard failure.

## Integrated acceptance

`tests/conformance/m17-verification-orchestration.conformance.test.ts` runs one required verification suite containing:

1. semantic preservation;
2. semantic round-trip;
3. provenance integrity;
4. trust propagation;
5. requirement satisfaction;
6. grammar validation;
7. program compile/test evidence.

The suite must pass as a whole and produce a replay bundle that verifies itself.

Negative controls prove:

- conflicting deterministic verifiers do not become pass;
- Jev pass cannot override deterministic fail;
- pass-without-evidence is downgraded;
- missing/duplicate/cyclic/trust-escalating provenance is detected;
- replay tampering is detected.

## Non-claims

M17 does not claim naturalness correctness from grammar correctness, a safe runtime sandbox for arbitrary program execution, or coverage of future extension/domain verifiers.

## Gate rule

Do not mark M17 verified or advance to M18 until package boundaries, strict TypeScript and the full deterministic suite pass on the complete branch head.

Live Jev requests required by M17: **0**.
