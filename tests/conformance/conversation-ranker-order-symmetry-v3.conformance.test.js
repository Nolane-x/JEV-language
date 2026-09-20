import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  "scripts/conversation-ranker-order-symmetry-v3.ts",
  "utf8",
);
const workflow = readFileSync(
  ".github/workflows/conversation-ranker-order-symmetry-v3.yml",
  "utf8",
);

describe("conversation ranker order-symmetry live evaluation v3", () => {
  it("hard-limits the one-shot live budget to 20 Jev requests", () => {
    expect(script).toContain("const MAX_REQUESTS = 20");
    expect(workflow).toContain('JEV_LIVE_MAX_REQUESTS: "20"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain(
      ".github/conversation-ranker-order-symmetry-v3.trigger",
    );
  });

  it("mirrors every base pair instead of trusting one option order", () => {
    expect(script).toContain("baseCases.flatMap");
    expect(script).toContain('mirrored: false');
    expect(script).toContain('mirrored: true');
    expect(script).toContain("order_invariant");
    expect(script).toContain("option_a_selection_rate");
  });

  it("reports preference agreement separately from order invariance and human evidence", () => {
    expect(script).toContain("preference_agreement_rate");
    expect(script).toContain("order_invariance_rate");
    expect(script).toContain(
      "Preregistered pair preferences are linguistic hypotheses, not a substitute for blinded human ratings.",
    );
  });

  it("uses only the verified relay and typed System One choice request", () => {
    expect(script).toContain('/v1/systemone');
    expect(script).toContain('type: "choice"');
    expect(script).toContain('x-jev-relay');
    expect(script).toContain('access-control-allow-origin');
    expect(script).not.toContain("/v1/chat/completions");
    expect(script).not.toContain("generateText(");
  });

  it("freezes only sanitized benchmark evidence", () => {
    expect(workflow).toContain(
      "docs/evidence/CONVERSATION-RANKER-ORDER-SYMMETRY-v3.json",
    );
    expect(script).toContain("credential_persisted: false");
    expect(script).toContain("error_bodies_persisted: false");
  });
});
