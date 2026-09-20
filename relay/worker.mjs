const UPSTREAM_ORIGIN = "https://api.typesafe.ai";
const BROWSER_CONTRACT = "jev-relay-browser-v2";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://nolane-x.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const ROUTES = new Map([
  ["/v1/models", "GET"],
  ["/v1/systemone", "POST"],
]);

function allowedOrigins(env = {}) {
  const configured = String(env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set(configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS);
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Expose-Headers": "X-JEV-Relay, X-TypeSafe-Request-Id, Retry-After",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function verifiedCorsHeaders(origin) {
  return {
    ...corsHeaders(origin),
    "X-JEV-Relay": "1",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function copyUpstreamHeaders(upstream, origin) {
  const headers = new Headers(verifiedCorsHeaders(origin));
  headers.set("Cache-Control", "no-store");

  for (const name of ["content-type", "x-typesafe-request-id", "retry-after"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export async function handleRequest(request, env = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") ?? "";
  const origins = allowedOrigins(env);

  if (url.pathname === "/health" && request.method === "GET") {
    if (origin && !origins.has(origin)) {
      return json(
        { error: { message: "Origin is not allowed by this relay." } },
        403,
        { "Vary": "Origin" },
      );
    }
    return json({
      ok: true,
      relay: "jev-language-typesafe",
      upstream: UPSTREAM_ORIGIN,
      stores_credentials: false,
      browser_contract: BROWSER_CONTRACT,
    }, 200, origin ? verifiedCorsHeaders(origin) : {
      "X-JEV-Relay": "1",
    });
  }

  if (!origin || !origins.has(origin)) {
    return json(
      { error: { message: "Origin is not allowed by this relay." } },
      403,
      { "Vary": "Origin" },
    );
  }

  const expectedMethod = ROUTES.get(url.pathname);
  if (!expectedMethod) {
    return json(
      { error: { message: "This relay only exposes /v1/models and /v1/systemone." } },
      404,
      verifiedCorsHeaders(origin),
    );
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...verifiedCorsHeaders(origin),
        "Cache-Control": "no-store",
      },
    });
  }

  if (request.method !== expectedMethod) {
    return json(
      { error: { message: `Expected ${expectedMethod} for ${url.pathname}.` } },
      405,
      {
        ...verifiedCorsHeaders(origin),
        "Allow": expectedMethod,
      },
    );
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return json(
      { error: { message: "Authorization header is required." } },
      401,
      verifiedCorsHeaders(origin),
    );
  }

  const upstreamHeaders = new Headers({
    "Authorization": authorization,
    "Accept": request.headers.get("Accept") || "application/json",
  });
  if (expectedMethod === "POST") {
    upstreamHeaders.set(
      "Content-Type",
      request.headers.get("Content-Type") || "application/json",
    );
  }

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM_ORIGIN}${url.pathname}`, {
      method: expectedMethod,
      headers: upstreamHeaders,
      body: expectedMethod === "POST" ? request.body : undefined,
      redirect: "manual",
    });
  } catch {
    return json(
      { error: { message: "Relay could not reach TypeSafe." } },
      502,
      verifiedCorsHeaders(origin),
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: copyUpstreamHeaders(upstream, origin),
  });
}

export default {
  fetch: handleRequest,
};
