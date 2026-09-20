# JEV Language Playground — GitHub Pages surface

Status: **deployed and deterministic-CI verified; authenticated browser CORS check pending**

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

Requests go directly from the browser to `https://api.typesafe.ai`. If TypeSafe does not allow the GitHub Pages origin through CORS, the UI reports the connection failure rather than proxying or collecting the key.

The official TypeSafe JavaScript SDK recognizes explicit browser use through its `dangerouslyAllowBrowser` option, but that is not treated here as proof that this exact GitHub Pages origin is accepted by the production API. Authenticated CORS remains pending until one real BYOK connection is observed from the deployed page.

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

Verified PR head:

- PR #67 head: `57ed0806fb1613e4bdb5248e8325aa84abd27113`
- CI #356: 78/78 test files, 634/634 tests;
- package boundaries: passed;
- strict TypeScript typecheck: passed.

Verified merged main:

- merge commit: `ca2a22c12e6a948fe2c688bbe0c62d772bd1c87c`;
- CI #357: 78/78 test files, 634/634 tests;
- package boundaries: passed;
- strict TypeScript typecheck: passed.

GitHub Pages:

- deployment workflow #2: success;
- `Configure Pages`: passed;
- artifact upload: passed;
- deployment: passed;
- deployed commit: `ca2a22c12e6a948fe2c688bbe0c62d772bd1c87c`;
- environment URL: `https://nolane-x.github.io/JEV-language/`.

## Remaining live verification

The static application, repository integration, deterministic tests, and Pages deployment are verified.

One external-provider property remains deliberately unclaimed: an authenticated browser request from the deployed GitHub Pages origin to TypeSafe. This requires a real user-supplied key in the page and must not be simulated by committing or exposing a credential.
