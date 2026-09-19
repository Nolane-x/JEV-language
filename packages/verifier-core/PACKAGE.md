# verifier-core

Status: **candidate / M17 integration complete pending gate CI**.

Implemented verification families:

- semantic preservation/equivalence over JSG invariants;
- natural-language round-trip verification with parser limitations preserved as `unknown`;
- provenance ancestry/integrity validation;
- conservative trust propagation validation;
- requirement satisfaction reports retaining satisfied/failed/unknown/not-applicable states;
- grammar evidence normalization across the required grammar dimensions;
- compiler/test program evidence normalization;
- evidence-grade ordering and required-evidence floor;
- registry-driven verification orchestration;
- deterministic/external/Jev precedence with same-tier conflict protection;
- verifier identity/result validation;
- replay bundles tied to execution-plan, raw-result and authoritative-result digests.

M17 does not claim that all future extension/domain verifiers exist. It closes the Section-427 hardening gate for the current public verifier families.
