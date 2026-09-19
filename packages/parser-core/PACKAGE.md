# parser-core

Status: **prototype / PARTIAL**.

Implemented M4 foundation:
- packed syntax-forest structures and runtime validation;
- semantic construction rule ABI and parse candidates;
- ambiguity classification with deterministic resolver registry;
- bounded JDR-backed Choice ambiguity resolver with stable candidate IDs;
- confidence-threshold ambiguity preservation;
- JSG parse commits through semantic validation.

The controlled M4 corpus covers the required bootstrap phenomena, but broad grammar/parser coverage remains intentionally outside this package's current maturity claim. Live provider quality is tracked by the separate M3 live-smoke gate.
