# universal-expression

Status: **candidate / M16 implementation complete pending predecessor merge and gate CI**.

Implemented T248–T258 foundation:

- stable harness-neutral ExpressionTarget / ExpressionRequest / ExpressionArtifact / ExpressionResult contracts;
- explicit ResultEnvelope states: ok / partial / ambiguous / unsupported / error;
- capability discovery manifest;
- parse / realize / express / transform / verify public operations;
- registry-driven parser, realizer, transformer and verifier adapters;
- duplicate-adapter rejection and deterministic routing;
- operation traces with configuration digests;
- replay-manifest exposure through trace-replay;
- controlled semantic adapters for English and Vietnamese text;
- controlled structured-data realization;
- controlled backend-neutral PIR realization;
- consumer-declared Action IR realization with no execution authority.

Section-426 same-root acceptance is covered by one controlled delete-limit JSG root materialized through the same runtime into natural-language, structured-data, program and Action IR artifacts.

Broader target adapters remain future coverage work; M16 verifies the stable API/gate contract, not universal domain coverage.
