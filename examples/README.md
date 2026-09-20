# Replayable native demos

## Controlled requirement round trip

Run:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run demo:native-roundtrip
```

The demo executes the native deterministic path:

1. controlled English requirement → JSG;
2. JSG → constrained English realization;
3. realized text → JSG;
4. semantic-equivalence verification;
5. zero-generative audit.

Expected semantic content is the delete-limit requirement; the realization may use the canonical controlled surface. The process fails loudly if parsing, realization, round-trip equivalence, or the zero-generative audit fails.

Source: `examples/native-v0.4-roundtrip.ts`.

This demo does not substitute for M19 human naturalness evaluation.
