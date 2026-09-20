export {};

const RELAY_URL =
  process.env.JEV_RELAY_URL ??
  "https://jev-language-typesafe-relay.nolane-file.workers.dev";
const EXPECTED_ORIGIN = "https://nolane-x.github.io";

if (process.env.JEV_ALLOW_LIVE !== "1") {
  throw new Error(
    "Authenticated relay smoke is disabled. Set JEV_ALLOW_LIVE=1 only for an intentional one-request run.",
  );
}

const maxRequests = Number(process.env.JEV_LIVE_MAX_REQUESTS ?? "1");
if (!Number.isInteger(maxRequests) || maxRequests !== 1) {
  throw new Error("Authenticated relay smoke is hard-limited to exactly one request.");
}

const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) {
  throw new Error("TYPESAFE_API_KEY is not available in this runtime.");
}

if (!/^https:\/\/[a-z0-9.-]+\.workers\.dev$/iu.test(RELAY_URL)) {
  throw new Error("JEV_RELAY_URL must be an HTTPS workers.dev origin.");
}

const questions = {
  answer: {
    type: "noul",
    instructions:
      "Does the candidate preserve the source requirement's restriction against deleting more than three files?",
  },
};

const payload = {
  model: process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest",
  state: {
    latest_user_message:
      "Does this candidate preserve the source restriction against deleting more than three files?",
    source: "The system must not delete more than 3 files.",
    candidate: "The system is not permitted to delete more than 3 files.",
    conversation: [],
    note:
      "Authenticated JEV Language Playground relay smoke. Preserve uncertainty and do not invent evidence.",
  },
  questions,
};

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 20_000);

let response;
try {
  response = await fetch(`${RELAY_URL}/v1/systemone`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: EXPECTED_ORIGIN,
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
} finally {
  clearTimeout(timeout);
}

if (!response.ok) {
  throw new Error(
    `Authenticated relay smoke failed with HTTP ${response.status}; response body intentionally suppressed.`,
  );
}

if (response.headers.get("x-jev-relay") !== "1") {
  throw new Error("Response did not contain X-JEV-Relay: 1.");
}

if (response.headers.get("access-control-allow-origin") !== EXPECTED_ORIGIN) {
  throw new Error("Relay response did not preserve the expected GitHub Pages CORS origin.");
}

const body = await response.json();
if (
  body === null ||
  typeof body !== "object" ||
  typeof body.model !== "string" ||
  body.model.trim() === "" ||
  body.answers === null ||
  typeof body.answers !== "object" ||
  body.usage === null ||
  typeof body.usage !== "object"
) {
  throw new Error("TypeSafe returned an unexpected top-level System One response shape.");
}

const answer = body.answers.answer;
if (
  answer === null ||
  typeof answer !== "object" ||
  answer.type !== "noul" ||
  !Number.isFinite(answer.noul) ||
  answer.noul < 0 ||
  answer.noul > 1
) {
  throw new Error("TypeSafe returned an invalid Noul answer through the relay.");
}

if (
  !Number.isFinite(body.usage.input_tokens) ||
  !Number.isFinite(body.usage.output_tokens) ||
  body.usage.input_tokens < 0 ||
  body.usage.output_tokens < 0
) {
  throw new Error("TypeSafe returned invalid token-usage evidence.");
}

const evidence = {
  schema: "jev-language-playground-relay-live-smoke/v1",
  ok: true,
  relay: RELAY_URL,
  origin: EXPECTED_ORIGIN,
  relay_header_verified: true,
  cors_origin_verified: true,
  model: body.model,
  answer_type: answer.type,
  noul: answer.noul,
  confidence:
    Number.isFinite(answer.confidence) ? answer.confidence : null,
  usage: {
    input_tokens: body.usage.input_tokens,
    output_tokens: body.usage.output_tokens,
  },
  request_id: response.headers.get("x-typesafe-request-id"),
  requests_used: 1,
  credential_persisted: false,
};

console.log(JSON.stringify(evidence, null, 2));
