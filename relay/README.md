# JEV Language self-hosted TypeSafe relay

This optional Cloudflare Worker exists because the production TypeSafe API currently does not return `Access-Control-Allow-Origin` for the deployed GitHub Pages origin.

The relay is intentionally narrow:

- fixed upstream: `https://api.typesafe.ai`;
- fixed routes: `GET /v1/models` and `POST /v1/systemone`;
- origin allowlist;
- no arbitrary target URL;
- no credential persistence;
- no cookies;
- no cache;
- no analytics or logging code in this repository.

The relay **does receive the user's Authorization header transiently in memory while forwarding the request**. Only use a relay deployment you control.

## Deploy

From this directory:

```bash
npx wrangler deploy
```

Before production use, set `ALLOWED_ORIGINS` to the exact browser origins that should be allowed. The checked-in default permits the public JEV Language GitHub Pages origin and two local preview origins.

After deployment, Cloudflare returns a URL similar to:

```text
https://jev-language-typesafe-relay.<your-subdomain>.workers.dev
```

Choose **Self-hosted relay** in the Playground and paste only that origin. Do not add `/v1/models` or `/v1/systemone`; the Playground appends the only two allowed paths.

## Security notes

This is not an anonymous public CORS proxy. Requests from origins outside the allowlist are rejected, arbitrary paths are rejected, and the upstream host cannot be changed by the browser request.

If TypeSafe later allows the GitHub Pages origin directly, prefer **Direct TypeSafe** mode and remove the relay from the request path.
