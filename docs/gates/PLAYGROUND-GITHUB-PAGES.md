# JEV Language Playground — GitHub Pages surface

Status: **base Pages deployment verified; direct TypeSafe browser transport CORS-blocked; self-hosted relay deployment verified; authenticated relay request verified**

Live URL:

https://nolane-x.github.io/JEV-language/

The Playground is an experimental public surface, not a new claim of unrestricted language generation.

## Purpose

Give anyone a zero-install way to interact with current JEV Language behavior using their own TypeSafe/Jev API key.

## Capability boundary

The browser surface currently supports:

- greetings through deterministic local text;
- yes/no prompts through a Jev `noul` question;
- explicit two-option prompts through a Jev `choice` question;
- other prompts through a typed coverage/answerability check.

If a request needs unrestricted free-form string generation, the UI reports that limitation. It does not synthesize a hidden LLM answer.

## BYOK security boundary

The API key:

- is entered into a password field;
- requires explicit acknowledgement that browser-side keys are visible to the page runtime/developer tools;
- is validated directly against `GET https://api.typesafe.ai/v1/models`;
- is held only in in-memory JavaScript state;
- is not written to localStorage, sessionStorage, cookies, URL state, repository files, or analytics;
- is cleared on disconnect or tab close.

The default transport is now the verified self-hosted relay at `https://jev-language-typesafe-relay.nolane-file.workers.dev`. Direct TypeSafe remains selectable, but the 2026-09-20 preflight probe established that this GitHub Pages origin is not currently allowed by the production API's CORS policy.

The repository relay in `relay/` has a fixed TypeSafe upstream, only `/v1/models` and `/v1/systemone`, an origin allowlist, no cache, and no credential persistence. It is not an anonymous public proxy and the browser accepts only HTTPS `*.workers.dev` relay origins or localhost.

A relay deployment still sees the Authorization header transiently while forwarding it. The UI therefore requires the user to choose relay mode explicitly and warns that only a relay they control should be used. Changing transport clears the in-memory key and requires reconnecting.

## Authenticated relay evidence

A real authenticated one-request smoke was completed on 2026-09-20 through the deployed relay using the existing GitHub Actions secret `TYPESAFE_API_KEY`. The key value was neither printed nor persisted. The observed response carried `X-JEV-Relay: 1`, returned `Access-Control-Allow-Origin: https://nolane-x.github.io`, validated as a `jev-1.13.0` Noul answer, and reported 372 input tokens plus 20 output tokens. The run was hard-limited to exactly one request with no retry loop.

Sanitized evidence is frozen at `docs/evidence/PLAYGROUND-RELAY-LIVE-SMOKE.json` (recording commit `553a373`). The temporary push trigger and write permission used only to capture that one-shot evidence are removed after closure; the retained live-smoke workflow is manual-only.

## TypeSafe wire contract

The browser runtime follows the current official TypeSafe JavaScript SDK wire contract:

- `GET /v1/models`;
- `POST /v1/systemone`;
- Bearer authentication;
- `{ state, questions, model }` System One requests;
- `noul`, `choice`, and `score` question shapes;
- `{ model, answers, usage }` success responses.

The Playground validates model-list and System One success payloads before rendering them. Malformed successful responses fail closed instead of being interpreted as valid Jev output.

## NUI visual contract

The design uses the supplied Nolane UI Intelligence principles:

- obsidian/editorial instrument aesthetic rather than generic neon AI styling;
- one warm-metal accent budget;
- pointer-local spotlight and grid reveal;
- inertial inspection-light behavior with a fast lead and subdued trailing diffusion, disabled for coarse pointers/reduced motion;
- localized reactive surfaces around hover/focus and nearby material regions;
- subtle message-entry and thinking motion;
- no decorative orb/sparkle/AI mascot vocabulary;
- reduced-motion and increased-contrast alternatives;
- responsive mobile layout with no intentional horizontal overflow.

The inspection-light is the product-native signature: the pointer behaves like a small instrument light that reveals material/grid structure without moving controls, hiding information, or changing task semantics.

## Verification

Static/runtime conformance:

`tests/conformance/playground-runtime.conformance.test.js`

Latest verified transport PR head:

- PR #70 head: `93bd36733ced592d1fa1e08337a2e31ce13067e2`;
- CI #366: 79/79 test files, 643/643 tests;
- package boundaries: passed;
- strict TypeScript typecheck: passed;
- PR #70 squash-merged to main as `81099f027f88d13b21d049f5e1d0a744f981ae5e`.

Last independently observed merged-main CI before the relay revision:

- merge commit: `ca2a22c12e6a948fe2c688bbe0c62d772bd1c87c`;
- CI #357: 78/78 test files, 634/634 tests;
- package boundaries: passed;
- strict TypeScript typecheck: passed.

The PR #70 tree is deterministic-CI verified and is merged on main, but a separate post-merge main workflow result for `81099f0` has not been independently observed through the currently available connector surface.

GitHub Pages:

- previously observed deployment workflow #2: success;
- `Configure Pages`: passed;
- artifact upload: passed;
- deployment: passed;
- previously observed deployed commit: `ca2a22c12e6a948fe2c688bbe0c62d772bd1c87c`;
- environment URL: `https://nolane-x.github.io/JEV-language/`;
- publication of the newer PR #70 transport revision has not been independently observed from the available tooling, so it is not reported as deployment-verified.

## Remaining live verification

The transport revision is repository-integrated and deterministic-CI verified. The base Pages deployment is verified, while publication of the exact PR #70 revision is still an external deployment-verification item.

Direct browser transport is no longer an unknown: the provider CORS policy blocks the deployed GitHub Pages origin.

The relay backend itself is no longer an unverified live item. Deployment status `jev-language-relay-deployment/v2` recorded `verified: true` for source SHA `7a0e9d8491534f0f817074c712d82c1ecd178c6d`, with health and GitHub Pages CORS preflight checks passing at `https://jev-language-typesafe-relay.nolane-file.workers.dev`.

The remaining live item is one authenticated BYOK request using a real TypeSafe API key. No credential will be committed, logged, or simulated to close this item.


## CORS preflight probe — 2026-09-20

A one-shot GitHub Actions probe sent browser-equivalent preflight requests with:

- Origin: `https://nolane-x.github.io`
- `OPTIONS https://api.typesafe.ai/v1/models`
- `OPTIONS https://api.typesafe.ai/v1/systemone`

Observed for both endpoints:

- HTTP status: `400`
- `Access-Control-Allow-Methods`: present
- `Access-Control-Allow-Headers`: present, including `Authorization` and `Content-Type`
- `Access-Control-Allow-Credentials: true`
- **no `Access-Control-Allow-Origin` header**

Therefore the deployed GitHub Pages origin is not currently permitted to call the TypeSafe API directly from a browser. This is an external-provider CORS policy, not an API-key validation failure and not something static GitHub Pages can override.

The frontend now distinguishes this network/CORS class from HTTP 401/403 failures. No public CORS proxy is used because forwarding user API keys through an untrusted proxy would violate the BYOK trust boundary.


## Optional self-hosted relay

Implementation:

- `relay/worker.mjs`
- `relay/wrangler.toml`
- `relay/README.md`

Security properties enforced in source and conformance tests:

- fixed upstream `https://api.typesafe.ai`;
- route allowlist: `GET /v1/models`, `POST /v1/systemone`;
- exact browser-origin allowlist;
- unknown paths rejected before upstream fetch;
- no cookies, credential persistence, cache, or analytics;
- CORS emitted only for approved origins;
- the verified relay is the browser default; direct transport remains available if TypeSafe changes its CORS policy.
