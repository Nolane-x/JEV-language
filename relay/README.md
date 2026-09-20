# JEV Language public gateway

This Cloudflare Worker gives the browser a stable Jev path without exposing provider credentials and without depending on TypeSafe browser CORS.

## Default public path

The public Playground calls this Worker with **no API key**. The Worker invokes Cloudflare Workers AI through an `AI` binding using the fixed model:

```text
typesafe/jev
```

Public mode is intentionally narrow:

- fixed browser origins;
- fixed routes: `GET /v1/models` and `POST /v1/systemone`;
- fixed Jev model surface;
- bounded request size and question count;
- Cloudflare Worker rate limiting;
- no arbitrary target URL;
- no browser/provider credential requirement;
- no cookies;
- no cache;
- no credential persistence.

## Advanced BYOK compatibility

If an allowed request explicitly includes an `Authorization` header, the same routes retain the prior TypeSafe BYOK behavior and forward only to the fixed upstream `https://api.typesafe.ai`. The key exists only in request memory while the Worker forwards that request.

This compatibility path is for advanced testing. Ordinary visitors should stay on **Public Jev**.

## Deploy

### Recommended: GitHub Actions

Do **not** commit a Cloudflare token or account ID into repository files.

Repository Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The deploy workflow runs manually and also on `main` changes under `relay/**` or the deployment workflow itself. It:

1. validates Cloudflare deployment credentials;
2. ensures the account has a `workers.dev` subdomain;
3. deploys the Worker with the Workers AI and rate-limit bindings;
4. verifies `/health`;
5. verifies GitHub Pages CORS;
6. executes one bounded anonymous Jev smoke request;
7. rejects the deployment gate unless a typed Noul answer is returned.

The smoke uses no TypeSafe API key.

### Local alternative

```bash
npx wrangler deploy
```

The checked-in origin allowlist permits the public JEV Language GitHub Pages origin and the two local preview origins.

## Security notes

The Worker is not an open forwarding proxy. An attacker cannot choose an upstream URL or arbitrary route. Public inference is still a billable/shared resource, so rate limiting and bounded request validation are part of the production boundary rather than optional UI behavior.

The origin allowlist is a browser boundary, not a complete abuse-control mechanism; rate limiting remains required because non-browser clients can forge an `Origin` header.

## First-deploy bootstrap

A newly created Cloudflare account may not have a `workers.dev` account subdomain yet. The deployment workflow checks for one and creates a deterministic account subdomain only when none exists. An existing account subdomain is never replaced.
