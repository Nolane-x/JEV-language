import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  ".github/workflows/deploy-relay.yml",
  "utf8",
);
const relayReadme = readFileSync("relay/README.md", "utf8");
const deploymentStatus = JSON.parse(
  readFileSync("relay/deployment-status.json", "utf8"),
);

describe("Cloudflare relay deployment workflow", () => {
  it("is manual-only and uses GitHub repository secrets", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\bpush:\s*$/mu);
    expect(workflow).not.toContain(".github/relay-deploy.trigger");
    expect(workflow).toContain(
      "${{ secrets.CLOUDFLARE_API_TOKEN }}",
    );
    expect(workflow).toContain(
      "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    );
  });

  it("preserves independently recorded verified deployment evidence", () => {
    expect(deploymentStatus.schema).toBe(
      "jev-language-relay-deployment/v2",
    );
    expect(deploymentStatus.verified).toBe(true);
    expect(deploymentStatus.relay_url).toBe(
      "https://jev-language-typesafe-relay.nolane-file.workers.dev",
    );
    expect(deploymentStatus.deploy_outcome).toBe("success");
    expect(deploymentStatus.verify_outcome).toBe("success");
    expect(deploymentStatus.failure_reason).toBeNull();
  });

  it("bootstraps workers.dev and deploys only the checked-in relay", () => {
    expect(workflow).toContain("/workers/subdomain");
    expect(workflow).toContain("Ensure workers.dev subdomain");
    expect(workflow).toContain("cd relay");
    expect(workflow).toContain("npx --yes wrangler@4 deploy");
    expect(workflow).not.toContain("cloudflare/wrangler-action@v4");
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
