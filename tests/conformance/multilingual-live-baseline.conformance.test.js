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
const evidence = JSON.parse(
  readFileSync(
    "docs/evidence/MULTILINGUAL-LIVE-BASELINE.json",
    "utf8",
  ),
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

  it("is manual-only after the one-shot evidence run", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toMatch(/^\s*push:/mu);
    expect(workflow).not.toContain("git push");
    expect(workflow).not.toContain(".github/multilingual-live-baseline.trigger");
  });

  it("locks the observed multilingual baseline without upgrading its claim", () => {
    expect(evidence.schema).toBe(
      "jev-language-multilingual-live-baseline/v1",
    );
    expect(evidence.source_sha).toBe(
      "97e150294bc185d60b7939c4c2988cfcdcdc42d4",
    );
    expect(evidence.requests_used).toBe(12);
    expect(evidence.summary.successful_requests).toBe(12);
    expect(evidence.summary.passed_cases).toBe(12);
    expect(evidence.summary.pass_rate).toBe(1);
    expect(evidence.summary.input_tokens).toBe(4662);
    expect(evidence.summary.output_tokens).toBe(324);
    expect(evidence.credential_persisted).toBe(false);
    expect(evidence.error_bodies_persisted).toBe(false);
    expect(evidence.jev_language_surface_packs).toEqual(["en", "vi"]);
    expect(evidence.missing_surface_packs_for_live_languages).toEqual([
      "zh-Hans",
      "es",
      "ja",
    ]);
    expect(evidence.cases).toHaveLength(12);
    expect(
      evidence.cases.every(
        (entry) =>
          entry.ok === true &&
          entry.passed === true &&
          entry.relay_header_verified === true &&
          entry.cors_origin_verified === true,
      ),
    ).toBe(true);
  });
});
