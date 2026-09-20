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

  it("keeps the automatic path narrow to the one-shot trigger file", () => {
    expect(workflow).toContain(".github/playground-relay-smoke.trigger");
    expect(workflow).not.toContain("paths-ignore:");
  });
});
