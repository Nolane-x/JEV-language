# JEV Language Playground

Static GitHub Pages chat surface for the experimental JEV Language project.

## Live

https://nolane-x.github.io/JEV-language/

The site is published from the `playground/` directory through GitHub Pages Actions. The base Pages deployment was previously verified. The relay backend is now independently deployment-verified at `https://jev-language-typesafe-relay.nolane-file.workers.dev` with health and GitHub Pages CORS preflight checks passing. This revision makes that verified relay the browser default; Direct TypeSafe remains available as a fallback if the provider later permits the Pages origin.

## Runtime model

- users bring their own TypeSafe API key;
- the key is kept only in JavaScript memory for the current tab;
- **Verified relay** is the default transport and targets `https://jev-language-typesafe-relay.nolane-file.workers.dev`;
- the relay forwards only `GET /v1/models` and `POST /v1/systemone` to the fixed TypeSafe upstream;
- **Direct TypeSafe** remains selectable, but the deployed GitHub Pages origin is currently blocked by TypeSafe's provider-side CORS policy;
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


## M19 blinded evaluator

`m19-evaluator.html` is the human-rating surface for the preregistered M19 natural-conversation study.

It is intentionally separate from the BYOK chat runtime:

- its CSP sets `connect-src 'none'`;
- it performs no TypeSafe/relay request and has no analytics;
- it does not use localStorage, sessionStorage, or cookies;
- it loads a local `jl-m19-rating-worksheet-1` JSON file;
- each stimulus shows the exact canonical conversation context plus one blinded response;
- item/arm identifiers remain in the JSON for later import but are not shown as evaluator-facing system identities;
- presentation order is deterministically shuffled from the study ID and pseudonymous evaluator ID;
- ratings stay in tab memory until the evaluator explicitly exports the completed JSON;
- export remains disabled until naturalness, semantic accuracy, multi-turn coherence, and template judgment are all present for every stimulus.

Study operators prepare and freeze files with `npm run m19:prepare` and `npm run m19:freeze`. The browser evaluator never fabricates human data and does not mark M19 complete by itself.
