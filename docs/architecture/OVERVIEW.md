# Architecture Overview

JEV Language follows one-way semantic layering:

```text
observed expression
  -> grounding / parsing
  -> JSG (canonical meaning)
  -> domain IR (discourse / program / action / formal)
  -> planning / candidate lattice
  -> bounded Jev judgment where needed
  -> deterministic realization
  -> verification
  -> expression artifact
```

## Architectural boundaries

- **JSG** is the canonical language-independent semantic graph.
- **JDR** is the only provider-facing bounded-judgment runtime.
- **Decision packs** version questions, projectors, calibration, fallback, and fixtures.
- **Language stacks** parse/realize surface language without owning agent lifecycles.
- **PIR** represents program intent independently of source syntax.
- **Action IR** describes actions but never executes them.
- **Verification** is an evidence-producing subsystem, not a boolean.
- **Universal Expression** is a harness-neutral facade over these components.

## Non-negotiable behavior

The core does not invoke a generative LLM, smuggle semantic control through arbitrary strings, or let a probabilistic preference override hard grammar/schema/type constraints.
