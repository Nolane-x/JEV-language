import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync("playground/m19-evaluator.html", "utf8");
const js = readFileSync("playground/m19-evaluator.js", "utf8");
const css = readFileSync("playground/m19-evaluator.css", "utf8");
const playground = readFileSync("playground/index.html", "utf8");

describe("M19 browser evaluator boundary", () => {
  it("is offline by construction under a page-specific CSP", () => {
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain("frame-ancestors 'none'");
    expect(js).not.toMatch(/\bfetch\s*\(/);
    expect(js).not.toMatch(/\bXMLHttpRequest\b/);
    expect(js).not.toMatch(/\bWebSocket\b/);
    expect(js).not.toMatch(/\bEventSource\b/);
    expect(js).not.toMatch(/\bnavigator\.sendBeacon\b/);
  });

  it("does not persist ratings or inject worksheet text as HTML", () => {
    expect(js).not.toMatch(/\blocalStorage\b/);
    expect(js).not.toMatch(/\bsessionStorage\b/);
    expect(js).not.toMatch(/document\.cookie\s*=/);
    expect(js).not.toMatch(/\.innerHTML\s*=/);
    expect(js).not.toMatch(/insertAdjacentHTML/);
    expect(js).toContain("stimulusContext.textContent = row.context");
    expect(js).toContain("stimulusOutput.textContent = row.output");
  });

  it("requires contextual worksheet rows and rejects evaluator-bias metadata", () => {
    expect(js).toContain('input.schemaVersion !== WORKSHEET_SCHEMA');
    expect(js).toContain('typeof row.context !== "string"');
    expect(js).toContain('"latencyMs" in row');
    expect(js).toContain('"costUnits" in row');
    expect(js).toContain('"semanticEvidenceRefs" in row');
    expect(html).toContain("Conversation context");
    expect(html).toContain("Blinded response");
  });

  it("exposes every preregistered human rating dimension", () => {
    expect(html).toContain('data-metric="naturalness"');
    expect(html).toContain('data-metric="semanticAccuracy"');
    expect(html).toContain('data-metric="multiTurnCoherence"');
    expect(html).toContain('data-metric="templateJudgment"');
    expect(html).toContain('data-judgment="template"');
    expect(html).toContain('data-judgment="not-template"');
    expect(html).toContain('data-judgment="unsure"');
  });

  it("uses a pseudonymous evaluator id for deterministic presentation order and exports only on completion", () => {
    expect(html).toContain("Pseudonymous evaluator ID");
    expect(js).toContain("shuffledIndices");
    expect(js).toContain("state.worksheet.studyId");
    expect(js).toContain("evaluatorId");
    expect(js).toContain(
      "completedCount() !== state.worksheet.rows.length",
    );
    expect(js).toContain("URL.createObjectURL(blob)");
  });

  it("is reachable from the main Playground without changing the chat transport", () => {
    expect(playground).toContain(
      '<a class="research-link" href="./m19-evaluator.html">M19 evaluator</a>',
    );
    expect(css).toContain(".stimulus-card");
    expect(css).toContain(".rubric-grid");
  });
});
