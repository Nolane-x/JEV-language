import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  ".github/workflows/playground-relay-live-smoke.yml",
  "utf8",
);
const script = readFileSync(
  "scripts/playground-relay-live-smoke.ts",
  "utf8",
);
const evidence = JSON.parse(
  readFileSync(
    "docs/evidence/PLAYGROUND-RELAY-LIVE-SMOKE.json",
    "utf8",
  ),
);

describe("authenticated Playground relay smoke contract", () => {
  it("uses only the existing TypeSafe secret and a one-request budget", () => {
    expect(workflow).toContain(
      "TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}",
    );
    expect(workflow).toContain('JEV_LIVE_MAX_REQUESTS: "1"');
    expect(script).toContain("maxRequests !== 1");
    expect(script).toContain("requests_used: 1");
  });

  it("proves traffic traversed the verified relay and browser origin", () => {
    expect(script).toContain(
      "https://jev-language-typesafe-relay.nolane-file.workers.dev",
    );
    expect(script).toContain('"https://nolane-x.github.io"');
    expect(script).toContain('response.headers.get("x-jev-relay") !== "1"');
    expect(script).toContain(
      'response.headers.get("access-control-allow-origin") !== EXPECTED_ORIGIN',
    );
  });

  it("suppresses error bodies and never persists the credential", () => {
    expect(script).toContain("response body intentionally suppressed");
    expect(script).toContain("credential_persisted: false");
    expect(script).not.toMatch(/console\.log\([^)]*apiKey/u);
    expect(script).not.toMatch(/writeFileSync|appendFileSync|localStorage|sessionStorage/u);
  });

  it("is manual-only after the one-shot verified run", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s*push:/mu);
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("git push");
    expect(workflow).not.toContain(".github/playground-relay-smoke.trigger");
  });

  it("locks the sanitized authenticated relay evidence", () => {
    expect(evidence.schema).toBe(
      "jev-language-playground-relay-live-smoke/v1",
    );
    expect(evidence.ok).toBe(true);
    expect(evidence.source_sha).toBe(
      "efc94c3d28af2dcfe1be67f25101118e10e63cbd",
    );
    expect(evidence.relay).toBe(
      "https://jev-language-typesafe-relay.nolane-file.workers.dev",
    );
    expect(evidence.origin).toBe("https://nolane-x.github.io");
    expect(evidence.relay_header_verified).toBe(true);
    expect(evidence.cors_origin_verified).toBe(true);
    expect(evidence.model).toBe("jev-1.13.0");
    expect(evidence.answer_type).toBe("noul");
    expect(evidence.requests_used).toBe(1);
    expect(evidence.credential_persisted).toBe(false);
    expect(evidence.usage.input_tokens).toBe(372);
    expect(evidence.usage.output_tokens).toBe(20);
  });
});
