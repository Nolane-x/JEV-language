# JEV Language Playground

Static GitHub Pages chat surface for the experimental JEV Language project.

## Live

https://nolane-x.github.io/JEV-language/

The site is published from the `playground/` directory through GitHub Pages Actions. The base Pages deployment was previously verified. The transport revision merged in PR #70 passed deterministic CI #366 with 79/79 test files and 643/643 tests; post-merge Pages publication of that exact revision has not been independently observed from the available tooling.

## Runtime model

- users bring their own TypeSafe API key;
- the key is kept only in JavaScript memory for the current tab;
- **Direct TypeSafe** sends `GET /v1/models` and `POST /v1/systemone` directly to `https://api.typesafe.ai`;
- the deployed GitHub Pages origin is currently blocked by TypeSafe's provider-side CORS policy;
- **Self-hosted relay** is an explicit optional transport for a relay deployment the user controls;
- the checked-in relay fixes the upstream to TypeSafe, permits only the two required paths, enforces an origin allowlist, disables caching, and does not persist credentials;
- changing transport clears the in-memory key and requires reconnecting;
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
