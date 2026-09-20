import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIRECT_MODELS_URL,
  DIRECT_SYSTEM_ONE_URL,
  normalizeRelayBaseUrl,
  resolveApiEndpoint,
} from "../../playground/transport.js";
import relay, { handleRequest } from "../../relay/worker.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
});

const playgroundApp = readFileSync("playground/app.js", "utf8");
const playgroundHtml = readFileSync("playground/index.html", "utf8");

describe("Playground transport boundary", () => {
  it("keeps direct TypeSafe available as a fixed transport", () => {
    expect(
      resolveApiEndpoint({ transport: "direct", path: "/v1/models" }),
    ).toBe(DIRECT_MODELS_URL);
    expect(
      resolveApiEndpoint({ transport: "direct", path: "/v1/systemone" }),
    ).toBe(DIRECT_SYSTEM_ONE_URL);
  });

  it("ships zero-key public Jev as the browser default", () => {
    expect(playgroundApp).toContain(
      'const DEFAULT_RELAY_URL = "https://jev-language-typesafe-relay.nolane-file.workers.dev";',
    );
    expect(playgroundApp).toContain('transport: "public"');
    expect(playgroundApp).toContain("relayBaseUrl: DEFAULT_RELAY_URL");
    expect(playgroundApp).toContain("connected: true");
    expect(playgroundHtml).toContain(
      '<option value="public" selected>Public Jev — no key required</option>',
    );
    expect(playgroundHtml).toContain(
      'value="https://jev-language-typesafe-relay.nolane-file.workers.dev"',
    );
  });

  it("resolves public gateway requests through the verified workers.dev origin", () => {
    expect(
      resolveApiEndpoint({
        transport: "public",
        relayBaseUrl: "https://jev-language-typesafe-relay.nolane-file.workers.dev",
        path: "/v1/systemone",
      }),
    ).toBe(
      "https://jev-language-typesafe-relay.nolane-file.workers.dev/v1/systemone",
    );
  });

  it("accepts only workers.dev or localhost relay origins", () => {
    expect(
      normalizeRelayBaseUrl("https://my-jev-relay.example.workers.dev/"),
    ).toBe("https://my-jev-relay.example.workers.dev");
    expect(normalizeRelayBaseUrl("http://localhost:8787/")).toBe(
      "http://localhost:8787",
    );
    expect(() =>
      normalizeRelayBaseUrl("https://public-proxy.example.com"),
    ).toThrow("limited to HTTPS *.workers.dev or localhost");
    expect(() =>
      normalizeRelayBaseUrl("https://x.workers.dev/extra"),
    ).toThrow("without an extra path");
  });

  it("never turns the relay into an arbitrary URL forwarder", () => {
    expect(() =>
      resolveApiEndpoint({
        transport: "relay",
        relayBaseUrl: "https://x.workers.dev",
        path: "/https://evil.example",
      }),
    ).toThrow("Unsupported TypeSafe API path");
  });
});

describe("self-hosted TypeSafe relay", () => {
  const allowedOrigin = "https://nolane-x.github.io";

  it("answers browser preflight only for an allowed origin", async () => {
    const allowed = await handleRequest(
      new Request("https://relay.example/v1/models", {
        method: "OPTIONS",
        headers: { Origin: allowedOrigin },
      }),
      {},
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      allowedOrigin,
    );

    const denied = await handleRequest(
      new Request("https://relay.example/v1/models", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
      {},
    );
    expect(denied.status).toBe(403);
  });

  it("serves public Jev through the Workers AI binding without a browser API key", async () => {
    const run = vi.fn(async (model, input) => {
      expect(model).toBe("typesafe/jev");
      expect(input.state).toEqual({ message: "hello" });
      expect(input.questions).toEqual({
        greeting: {
          type: "noul",
          instructions: "Is this a greeting?",
        },
      });
      return {
        model: "jev-1.13.0",
        answers: {
          greeting: { type: "noul", noul: 0.99 },
        },
        usage: { input_tokens: 10, output_tokens: 1 },
      };
    });
    const limit = vi.fn(async () => ({ success: true }));

    const response = await handleRequest(
      new Request("https://relay.example/v1/systemone", {
        method: "POST",
        headers: {
          Origin: allowedOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "jev-latest",
          state: { message: "hello" },
          questions: {
            greeting: {
              type: "noul",
              instructions: "Is this a greeting?",
            },
          },
        }),
      }),
      {
        AI: { run },
        PUBLIC_JEV_RATE_LIMITER: { limit },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      allowedOrigin,
    );
    expect(response.headers.get("x-jev-provider")).toBe(
      "cloudflare-workers-ai",
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body.model).toBe("jev-1.13.0");
    expect(body.answers.greeting.noul).toBe(0.99);
  });

  it("serves the public model catalog without authorization", async () => {
    const response = await handleRequest(
      new Request("https://relay.example/v1/models", {
        method: "GET",
        headers: { Origin: allowedOrigin },
      }),
      {},
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.public).toBe(true);
    expect(body.provider).toBe("cloudflare-workers-ai");
    expect(body.models.map((model) => model.name)).toContain("jev-latest");
  });

  it("forwards only the whitelisted TypeSafe route and preserves bearer auth", async () => {
    const upstream = vi.fn(async (url, init) => {
      expect(url).toBe("https://api.typesafe.ai/v1/models");
      expect(init.method).toBe("GET");
      expect(init.headers.get("Authorization")).toBe("Bearer test-key");
      return new Response(
        JSON.stringify({ models: [{ name: "jev-latest" }] }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-typesafe-request-id": "req-test",
          },
        },
      );
    });
    vi.stubGlobal("fetch", upstream);

    const response = await relay.fetch(
      new Request("https://relay.example/v1/models", {
        method: "GET",
        headers: {
          Origin: allowedOrigin,
          Authorization: "Bearer test-key",
          Accept: "application/json",
        },
      }),
      {},
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      allowedOrigin,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-jev-relay")).toBe("1");
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown relay paths before any upstream fetch", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await handleRequest(
      new Request("https://relay.example/v1/anything", {
        method: "GET",
        headers: {
          Origin: allowedOrigin,
          Authorization: "Bearer test-key",
        },
      }),
      {},
    );

    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});
