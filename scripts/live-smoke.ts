import {
  DecisionRuntime,
  TypeSafeDecisionAdapter,
} from "../packages/decision-runtime/src/index.ts";

if (process.env.JEV_ALLOW_LIVE !== "1") {
  throw new Error(
    "Live Jev calls are disabled. Set JEV_ALLOW_LIVE=1 only for an intentional smoke run.",
  );
}

const maxRequests = Number(process.env.JEV_LIVE_MAX_REQUESTS ?? "1");
if (!Number.isInteger(maxRequests) || maxRequests !== 1) {
  throw new Error(
    "The bootstrap live smoke is hard-limited to exactly one request.",
  );
}

if (!process.env.TYPESAFE_API_KEY) {
  throw new Error("TYPESAFE_API_KEY is not available in this runtime.");
}

const runtime = new DecisionRuntime({
  adapter: new TypeSafeDecisionAdapter(),
  budget: { maxRequests: 1 },
});

const result = await runtime.execute({
  id: "bootstrap-live-smoke-v1",
  modelProfile: process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest",
  state: {
    source: "The system must not delete more than 3 files.",
    candidate: "The system is not permitted to delete more than 3 files.",
  },
  questions: {
    preserves_restriction: {
      type: "noul",
      instruction:
        "Does the candidate preserve the source requirement's restriction against deleting more than three files?",
      criteria: {
        true: "The same upper-bound restriction is preserved.",
        false: "The restriction is removed, weakened, reversed, or materially changed.",
      },
    },
  },
});

console.log(
  JSON.stringify(
    {
      source: result.source,
      model: result.model,
      answer: result.answers[0],
      usage: result.usage,
      requestsUsed: runtime.requestsUsed,
    },
    null,
    2,
  ),
);
