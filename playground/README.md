# JEV Language Playground

Static GitHub Pages chat surface for the experimental JEV Language project.

## Runtime model

- no server is used by this repository;
- users bring their own TypeSafe API key;
- the key is kept only in JavaScript memory for the current tab;
- connection is validated with `GET https://api.typesafe.ai/v1/models`;
- decisions are sent to `POST https://api.typesafe.ai/v1/systemone`;
- no API key is persisted to localStorage, sessionStorage, cookies, or URL state.

The current browser-safe surface intentionally focuses on Jev-shaped interactions:

- yes/no questions → `noul`;
- explicit two-option questions → `choice`;
- unsupported open-ended requests → typed coverage check and explicit limitation.

It does not pretend that the current repository has a verified unrestricted free-form generator.

## Visual direction

The interface follows the project-local NUI design packet:

- editorial/instrument aesthetic rather than generic AI neon;
- warm-metal chroma budget on an obsidian canvas;
- pointer-local illumination revealing grid/material detail;
- effect density concentrated around pointer, composer, focus, and new-message state;
- reduced-motion and high-contrast branches;
- responsive re-authoring for narrow screens.

## Local preview

Serve this directory with any static server, for example:

```bash
python -m http.server 8000 -d playground
```
