import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  "scripts/conversation-ranker-boundary-v4.ts",
  "utf8",
);
const workflow = readFileSync(
  ".github/workflows/conversation-ranker-boundary-v4.yml",
  "utf8",
);
const prereg = readFileSync(
  "docs/research/CONVERSATION-RANKER-BOUNDARY-v4-PREREG.md",
  "utf8",
);

describe("conversation ranker boundary calibration v4", () => {
  it("hard-limits the live budget to 20 mirrored Jev requests", () => {
    expect(script).toContain("const MAX_REQUESTS = 20");
    expect(script).toContain("baseCases.length * 2");
    expect(script).toContain("mirrored: false");
    expect(script).toContain("mirrored: true");
    expect(workflow).toContain('JEV_LIVE_MAX_REQUESTS: "20"');
    expect(workflow).toContain(
      ".github/conversation-ranker-boundary-v4.trigger",
    );
  });

  it("pre-registers clear preferences separately from intentional near ties", () => {
    expect(script).toContain('"clear-preference"');
    expect(script).toContain('"near-tie"');
    expect(script).toContain("near_tie_gate_abstention_rate");
    expect(script).toContain("near_tie_false_certainty_rate");
    expect(script).toContain("clear_preference_agreement_rate");
    expect(prereg).toContain("Near-tie pairs have **no gold winner**");
  });

  it("uses the current production confidence and margin gate without tuning after observation", () => {
    expect(script).toContain("const DEFAULT_MIN_CONFIDENCE = 0.62");
    expect(script).toContain("const DEFAULT_MIN_MARGIN = 0.08");
    expect(script).toContain("gateAccepts");
    expect(prereg).toContain("minimum confidence: 0.62");
    expect(prereg).toContain("minimum probability margin: 0.08");
  });

  it("checks mirrored order invariance and option-position balance", () => {
    expect(script).toContain("order_invariant");
    expect(script).toContain("order_invariance_rate");
    expect(script).toContain("option_a_selection_rate");
    expect(script).toContain("selected_candidate");
  });

  it("uses only the verified relay and typed System One choice endpoint", () => {
    expect(script).toContain("/v1/systemone");
    expect(script).toContain('type: "choice"');
    expect(script).toContain('x-jev-relay');
    expect(script).toContain('access-control-allow-origin');
    expect(script).not.toContain("/v1/chat/completions");
    expect(script).not.toContain("generateText(");
  });

  it("freezes sanitized evidence and keeps claim boundaries explicit", () => {
    expect(workflow).toContain(
      "docs/evidence/CONVERSATION-RANKER-BOUNDARY-v4.json",
    );
    expect(script).toContain("credential_persisted: false");
    expect(script).toContain("error_bodies_persisted: false");
    expect(script).toContain(
      "It does not substitute for blinded human naturalness ratings.",
    );
    expect(prereg).toContain("Human M19 remains the authoritative end-to-end gate.");
  });
});
