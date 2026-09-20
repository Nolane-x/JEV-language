import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  ".github/workflows/deploy-relay.yml",
  "utf8",
);
const relayReadme = readFileSync("relay/README.md", "utf8");

describe("Cloudflare relay deployment workflow", () => {
  it("uses explicit/manual deployment triggers and GitHub repository secrets", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("- .github/relay-deploy.trigger");
    expect(workflow).not.toContain("- relay/**");
    expect(workflow).toContain(
      "${{ secrets.CLOUDFLARE_API_TOKEN }}",
    );
    expect(workflow).toContain(
      "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    );
  });

  it("records only non-secret deployment evidence", () => {
    expect(workflow).toContain("relay/deployment-status.json");
    expect(workflow).toContain("relay_url:");
    expect(workflow).toContain("source_sha:");
    const statusStep = workflow.split("- name: Record deployment status")[1] ?? "";
    expect(statusStep).not.toContain("secrets.CLOUDFLARE_API_TOKEN");
    expect(statusStep).not.toContain("secrets.CLOUDFLARE_ACCOUNT_ID");
    expect(statusStep).not.toContain("process.env.CLOUDFLARE_API_TOKEN");
    expect(statusStep).not.toContain("process.env.CLOUDFLARE_ACCOUNT_ID");
  });

  it("deploys only the checked-in relay with the official Wrangler action", () => {
    expect(workflow).toContain("cloudflare/wrangler-action@v4");
    expect(workflow).toContain("workingDirectory: relay");
    expect(workflow).toContain("command: deploy");
  });

  it("verifies health and the GitHub Pages CORS origin after deployment", () => {
    expect(workflow).toContain("$RELAY_URL/health");
    expect(workflow).toContain(
      "Origin: https://nolane-x.github.io",
    );
    expect(workflow).toContain(
      "access-control-allow-origin: https://nolane-x.github.io",
    );
  });

  it("documents the secret-safe setup instead of repository plaintext credentials", () => {
    expect(relayReadme).toContain(
      "Settings → Secrets and variables → Actions",
    );
    expect(relayReadme).toContain("CLOUDFLARE_API_TOKEN");
    expect(relayReadme).toContain(
      "Do **not** commit a Cloudflare token or account ID",
    );
  });
});
