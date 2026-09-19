# action-ir

Status: **candidate / M15 implementation complete pending gate CI**.

Implemented for T245–T247:

- consumer-supplied capability definitions and bounded ActionSchema;
- Action IR carrying parameters, preconditions, expected effects, risk hints, semantic purpose and provenance;
- required capability-registry membership;
- required/type/reference checks for action parameters;
- capability-output compatibility validation;
- explicit ClarificationNeed contract for unresolved choices;
- canonical deterministic Action IR rendering;
- conformance fixtures proving unknown capabilities, missing required parameters, unknown references and missing provenance are rejected.

The package describes intended actions only. It exposes no execution authority, network/file side effects, permission approval or autonomous loop.
