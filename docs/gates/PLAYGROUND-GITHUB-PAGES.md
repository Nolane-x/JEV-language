# JEV Language Playground — GitHub Pages surface

Status: **implementation candidate; CI and deployment pending**

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
- is validated directly against `GET /v1/models`;
- is held only in in-memory JavaScript state;
- is not written to localStorage, sessionStorage, cookies, URL state, repository files, or analytics;
- is cleared on disconnect or tab close.

Requests go directly from the browser to `https://api.typesafe.ai`. If TypeSafe does not allow the GitHub Pages origin through CORS, the UI reports the connection failure rather than proxying or collecting the key.

## NUI visual contract

The design uses the supplied Nolane UI Intelligence principles:

- obsidian/editorial instrument aesthetic rather than generic neon AI styling;
- one warm-metal accent budget;
- pointer-local spotlight and grid reveal;
- localized reactive surfaces around hover/focus;
- subtle message-entry and thinking motion;
- no decorative orb/sparkle/AI mascot vocabulary;
- reduced-motion and increased-contrast alternatives;
- responsive mobile layout with no intentional horizontal overflow.

## Verification

Static/runtime conformance lives in:

`tests/conformance/playground-runtime.conformance.test.js`

Runtime rendering was exercised locally in Chromium at desktop and 390px mobile widths before repository integration. The deployed GitHub Pages URL must not be reported as live until the Pages workflow succeeds.
