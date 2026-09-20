const UPSTREAM_ORIGIN = "https://api.typesafe.ai";
const PUBLIC_MODEL = "typesafe/jev";
const PUBLIC_MODEL_ALIASES = ["jev-latest", "jev-1.13.0", "jev-preview"];
const MAX_PUBLIC_BODY_BYTES = 131_072;
const MAX_PUBLIC_QUESTIONS = 16;
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
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
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

function publicHeaders(origin) {
  return {
    ...corsHeaders(origin),
    "X-JEV-Relay": "1",
    "X-JEV-Provider": "cloudflare-workers-ai",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
}

function copyUpstreamHeaders(upstream, origin) {
  const headers = new Headers(corsHeaders(origin));
  headers.set("Cache-Control", "no-store");
  headers.set("X-JEV-Relay", "1");
  headers.set("X-JEV-Provider", "typesafe-byok");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");

  for (const name of ["content-type", "x-typesafe-request-id", "retry-after"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function publicModels(origin) {
  return json(
    {
      models: PUBLIC_MODEL_ALIASES.map((name) => ({ name })),
      provider: "cloudflare-workers-ai",
      public: true,
    },
    200,
    publicHeaders(origin),
  );
}

function validatePublicRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object.";
  }
  if (!Object.prototype.hasOwnProperty.call(body, "state")) {
    return "Request body must include state.";
  }
  if (!body.questions || typeof body.questions !== "object" || Array.isArray(body.questions)) {
    return "Request body must include a questions object.";
  }
  const questionCount = Object.keys(body.questions).length;
  if (questionCount < 1 || questionCount > MAX_PUBLIC_QUESTIONS) {
    return `Public mode accepts 1-${MAX_PUBLIC_QUESTIONS} questions per request.`;
  }
  if (
    body.model !== undefined &&
    (!PUBLIC_MODEL_ALIASES.includes(body.model) || typeof body.model !== "string")
  ) {
    return "Unsupported Jev model alias for public mode.";
  }
  return null;
}

async function enforcePublicRateLimit(request, env) {
  if (!env.PUBLIC_JEV_RATE_LIMITER?.limit) return true;
  const actor =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "anonymous";
  const result = await env.PUBLIC_JEV_RATE_LIMITER.limit({
    key: `jev-public:${actor}`,
  });
  return result?.success !== false;
}

async function runPublicJev(request, env, origin) {
  if (!env.AI?.run) {
    return json(
      { error: { message: "Public Jev runtime is not configured." } },
      503,
      publicHeaders(origin),
    );
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_PUBLIC_BODY_BYTES) {
    return json(
      { error: { message: "Request is too large for public mode." } },
      413,
      publicHeaders(origin),
    );
  }

  let raw;
  try {
    raw = await request.text();
  } catch {
    return json(
      { error: { message: "Could not read request body." } },
      400,
      publicHeaders(origin),
    );
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_PUBLIC_BODY_BYTES) {
    return json(
      { error: { message: "Request is too large for public mode." } },
      413,
      publicHeaders(origin),
    );
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(
      { error: { message: "Request body must be valid JSON." } },
      400,
      publicHeaders(origin),
    );
  }

  const validationError = validatePublicRequest(body);
  if (validationError) {
    return json({ error: { message: validationError } }, 400, publicHeaders(origin));
  }

  const withinLimit = await enforcePublicRateLimit(request, env);
  if (!withinLimit) {
    return json(
      { error: { message: "Public Jev is busy. Please try again shortly." } },
      429,
      {
        ...publicHeaders(origin),
        "Retry-After": "60",
      },
    );
  }

  try {
    const result = await env.AI.run(PUBLIC_MODEL, {
      state: body.state,
      questions: body.questions,
    });
    return json(result, 200, publicHeaders(origin));
  } catch (error) {
    const status =
      Number(error?.status || error?.statusCode || error?.cause?.status) || 502;
    const safeStatus = [400, 403, 408, 413, 429].includes(status) ? status : 502;
    return json(
      {
        error: {
          message:
            safeStatus === 429
              ? "Public Jev is temporarily at capacity. Please try again shortly."
              : "Public Jev could not complete this request.",
        },
      },
      safeStatus,
      publicHeaders(origin),
    );
  }
}

async function forwardByok(request, origin, expectedMethod) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return null;
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
    upstream = await fetch(`${UPSTREAM_ORIGIN}${new URL(request.url).pathname}`, {
      method: expectedMethod,
      headers: upstreamHeaders,
      body: expectedMethod === "POST" ? request.body : undefined,
      redirect: "manual",
    });
  } catch {
    return json(
      { error: { message: "Relay could not reach TypeSafe." } },
      502,
      corsHeaders(origin),
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: copyUpstreamHeaders(upstream, origin),
  });
}

export async function handleRequest(request, env = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") ?? "";
  const origins = allowedOrigins(env);

  if (url.pathname === "/health" && request.method === "GET") {
    return json({
      ok: true,
      relay: "jev-language-gateway",
      public_provider: "cloudflare-workers-ai",
      public_model: PUBLIC_MODEL,
      byok_upstream: UPSTREAM_ORIGIN,
      public_inference: Boolean(env.AI?.run),
      stores_credentials: false,
    }, 200);
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
      corsHeaders(origin),
    );
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin),
        "Cache-Control": "no-store",
      },
    });
  }

  if (request.method !== expectedMethod) {
    return json(
      { error: { message: `Expected ${expectedMethod} for ${url.pathname}.` } },
      405,
      {
        ...corsHeaders(origin),
        "Allow": expectedMethod,
      },
    );
  }

  const byok = await forwardByok(request, origin, expectedMethod);
  if (byok) return byok;

  if (url.pathname === "/v1/models") {
    return publicModels(origin);
  }

  return runPublicJev(request, env, origin);
}

export default {
  fetch: handleRequest,
};
