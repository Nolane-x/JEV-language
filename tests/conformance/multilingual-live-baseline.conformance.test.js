import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  ".github/workflows/multilingual-live-baseline.yml",
  "utf8",
);
const script = readFileSync(
  "scripts/multilingual-live-baseline.ts",
  "utf8",
);

describe("multilingual live baseline contract", () => {
  it("hard-limits the authorized benchmark to twelve requests", () => {
    expect(script).toContain("const MAX_REQUESTS = 12");
    expect(script).toContain("cases.length !== MAX_REQUESTS");
    expect(script).toContain("requestsUsed >= MAX_REQUESTS");
    expect(workflow).toContain('JEV_LIVE_MAX_REQUESTS: "12"');
  });

  it("covers English, Vietnamese, Chinese, Spanish, Japanese and VI-EN code-switch", () => {
    for (const language of ["en", "vi", "zh-Hans", "es", "ja", "vi-en"]) {
      expect(script).toContain(`language: "${language}"`);
    }
  });

  it("uses only the existing TypeSafe GitHub secret and verified relay", () => {
    expect(workflow).toContain(
      "TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}",
    );
    expect(script).toContain(
      "https://jev-language-typesafe-relay.nolane-file.workers.dev",
    );
    expect(script).toContain('"https://nolane-x.github.io"');
    expect(script).toContain('response.headers.get("x-jev-relay") !== "1"');
  });

  it("never persists the key or upstream error bodies", () => {
    expect(script).toContain("credential_persisted: false");
    expect(script).toContain("error_bodies_persisted: false");
    expect(script).toContain("error_body_persisted: false");
    expect(script).not.toMatch(/console\.log\([^)]*apiKey/u);
    expect(script).not.toMatch(/writeFileSync|appendFileSync|localStorage|sessionStorage/u);
  });

  it("separates raw JEV multilingual judgment from JEV Language surface-pack coverage", () => {
    expect(script).toContain('jev_language_surface_packs: ["en", "vi"]');
    expect(script).toContain(
      'missing_surface_packs_for_live_languages: ["zh-Hans", "es", "ja"]',
    );
    expect(script).toContain("deterministic_surface_probes");
  });

  it("keeps automatic execution narrowly scoped to a temporary trigger", () => {
    expect(workflow).toContain(".github/multilingual-live-baseline.trigger");
    expect(workflow).not.toContain("paths-ignore:");
  });
});
