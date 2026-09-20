# JEV Language Playground

Static GitHub Pages chat surface for the experimental JEV Language project.

## Live

https://nolane-x.github.io/JEV-language/

The site is published from the `playground/` directory through GitHub Pages Actions. The gateway backend lives at `https://jev-language-typesafe-relay.nolane-file.workers.dev`. The browser default is now **Public Jev**, which needs no visitor API key and invokes Jev through Cloudflare Workers AI. Direct TypeSafe and TypeSafe BYOK-through-relay remain advanced transports.

## Runtime model

- **Public Jev** is the default transport and requires no visitor API key;
- public inference targets the fixed Cloudflare Workers AI model `typesafe/jev`;
- the gateway exposes only `GET /v1/models` and `POST /v1/systemone`;
- public requests are bounded by origin, request size, question count and a Worker rate limiter;
- **TypeSafe BYOK via verified relay** remains available and forwards a supplied Authorization header transiently without persistence;
- **Direct TypeSafe** remains available for advanced testing, although the deployed GitHub Pages origin is currently blocked by TypeSafe's provider-side CORS policy;
- switching back to Public Jev clears any in-memory BYOK key;
- no API key is persisted to localStorage, sessionStorage, cookies, or URL state;
- successful provider payloads are runtime-validated before rendering.

Deployment and security details are in `../relay/README.md`.

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
