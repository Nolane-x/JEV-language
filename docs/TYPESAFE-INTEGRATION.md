# TypeSafe / Jev Integration

The provider adapter targets the official `@typesafe-ai/sdk` and reads `TYPESAFE_API_KEY` from the environment through the SDK.

## Runtime policy

- Production/provider calls go through the JDR adapter interface.
- JDR state is projected/minimized rather than forwarding the full semantic graph.
- Noul, Choice, and Score remain typed internal questions.
- Provider results are normalized before downstream use.
- Transport failures are structured; semantic uncertainty is not retried as transport.
- Recorded responses are first-class for deterministic replay.
- Live use is explicitly opt-in and separately budgeted.

## Secret policy

The API key must only exist in server/runtime secrets. Never put it in source, fixtures, traces, artifacts, browser bundles, or diagnostics.

## GitHub

Store the key as repository/organization Actions secret named `TYPESAFE_API_KEY`. Ordinary CI intentionally does not reference it. Only the manual live-smoke workflow does.
