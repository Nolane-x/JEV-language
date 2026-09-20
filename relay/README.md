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

### Recommended: GitHub Actions

Do **not** commit a Cloudflare token or account ID into repository files.

In GitHub, open **Settings → Secrets and variables → Actions** and create these repository secrets:

- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID;
- `CLOUDFLARE_API_TOKEN` — a narrowly scoped token allowed to create/deploy this Worker.

Then open **Actions → Deploy TypeSafe Relay → Run workflow**.

The workflow:

1. checks that both secrets exist;
2. checks whether the Cloudflare account already has a `workers.dev` subdomain and creates a deterministic one if the account is new;
3. deploys `relay/wrangler.toml` with Wrangler CLI;
4. obtains the resulting `workers.dev` deployment URL;
5. verifies `/health` with first-deploy propagation retries;
6. verifies a browser-style CORS preflight from `https://nolane-x.github.io`;
7. records only non-secret deployment evidence so failures can be diagnosed without exposing credentials.

Cloudflare explicitly recommends storing `CLOUDFLARE_API_TOKEN` in CI/CD secrets rather than in the repository.

### Local alternative

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


### First-deploy bootstrap

A newly created Cloudflare account may not have a `workers.dev` account subdomain yet. Interactive Wrangler can prompt for one, but CI cannot answer that prompt. The deployment workflow therefore checks the account subdomain first and, only when none exists, creates a deterministic `nolane-<account-prefix>.workers.dev` account subdomain through the Cloudflare API. An existing account subdomain is never replaced.
