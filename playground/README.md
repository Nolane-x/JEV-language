# JEV Language Playground

Static GitHub Pages chat surface for the experimental JEV Language project.

## Live

https://nolane-x.github.io/JEV-language/

The site is published from the `playground/` directory through GitHub Pages Actions. The browser has one production connection route: the verified BYOK relay at `https://jev-language-typesafe-relay.nolane-file.workers.dev`. Users still provide their own TypeSafe API key, but the browser never calls TypeSafe directly, so provider-side browser CORS is removed from the normal user path.

## Runtime model

- users bring their own TypeSafe API key;
- the key is kept only in JavaScript memory for the current tab;
- the verified relay is the only production browser transport and targets `https://jev-language-typesafe-relay.nolane-file.workers.dev`;
- the browser first verifies the relay health contract, then verifies the user's key through `GET /v1/models`;
- the relay forwards only `GET /v1/models` and `POST /v1/systemone` to the fixed TypeSafe upstream;
- direct browser TypeSafe access is deliberately absent from the user UI because the deployed Pages origin is blocked by TypeSafe's provider-side CORS policy;
- the checked-in relay fixes the upstream to TypeSafe, permits only the required paths, enforces an origin allowlist, disables caching, and does not persist credentials;
- no API key is persisted to localStorage, sessionStorage, cookies, or URL state;
- successful provider payloads are runtime-validated before rendering.

The self-hosted relay receives the Authorization header transiently while forwarding a request. Do not use a relay deployment you do not control. Deployment and security details are in `../relay/README.md`.

The current browser surface intentionally focuses on Jev-shaped interactions:

- yes/no questions → `noul`;
- explicit two-option questions → `choice`;
- unsupported open-ended requests → typed coverage check and explicit limitation.

It does not pretend that the current repository has a verified unrestricted free-form generator.

## Visual direction

The interface follows the project-local NUI design packet:

- editorial/instrument aesthetic rather than generic AI neon;
- warm-metal chroma budget on an obsidian canvas;
- pointer-local illumination revealing grid/material detail;
- an inertial inspection-light field: the lead light follows the pointer while a much softer material bloom trails behind, without moving controls or hiding information behind hover;
- effect density concentrated around pointer, composer, focus, and new-message state;
- reduced-motion and high-contrast branches;
- responsive re-authoring for narrow screens.

## Local preview

Serve this directory with any static server, for example:

```bash
python -m http.server 8000 -d playground
```
