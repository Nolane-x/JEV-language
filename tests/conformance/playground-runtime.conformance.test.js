import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  extractOptions,
  isGreeting,
  renderChoice,
  renderMeta,
  renderYesNo,
  yesNoLike,
} from "../../playground/runtime.js";

const app = readFileSync("playground/app.js", "utf8");
const html = readFileSync("playground/index.html", "utf8");
const css = readFileSync("playground/styles.css", "utf8");
const pages = readFileSync(".github/workflows/pages.yml", "utf8");

describe("JEV Language Playground conformance", () => {
  it("recognizes bounded decision shapes in English and Vietnamese", () => {
    expect(yesNoLike("Should I retry after a timeout?")).toBe(true);
    expect(yesNoLike("Liệu tôi có nên retry không?")).toBe(true);
    expect(isGreeting("Xin chào!")).toBe(true);
    expect(isGreeting("Explain this architecture")).toBe(false);
  });

  it("extracts binary alternatives without leaking instruction prefixes", () => {
    expect(
      extractOptions(
        "For a latency-sensitive path, should I choose retry or fail-fast?",
      ),
    ).toEqual(["retry", "fail-fast"]);
    expect(
      extractOptions("Tôi nên chọn retry hay fail-fast?"),
    ).toEqual(["retry", "fail-fast"]);
  });

  it("renders typed Jev decisions without inventing unknown winners", () => {
    expect(
      renderChoice(
        {
          choice: "option_b",
          confidence: 0.78,
          probabilities: { option_a: 0.22, option_b: 0.78 },
        },
        ["retry", "fail-fast"],
      ),
    ).toContain("fail-fast");
    expect(renderChoice({ choice: "unexpected" }, ["a", "b"])).toContain(
      "won’t invent",
    );
    expect(renderYesNo({ noul: 0.8, confidence: 0.7 }, null)).toContain(
      "leans yes",
    );
  });

  it("keeps unsupported free-form generation explicit", () => {
    expect(
      renderMeta({
        answers: {
          mode: { choice: "factual_open" },
          answerability: { score: 0 },
          needs_clarification: { noul: 0.9 },
        },
      }),
    ).toContain("needs a yes/no proposition or explicit alternatives");
  });

  it("keeps BYOK credentials out of persistent browser storage", () => {
    expect(app).not.toMatch(/localStorage/u);
    expect(app).not.toMatch(/sessionStorage/u);
    expect(app).not.toMatch(/document\.cookie/u);
    expect(app).toContain("https://api.typesafe.ai/v1/models");
    expect(app).toContain("https://api.typesafe.ai/v1/systemone");
    expect(app).toContain('state.apiKey = ""');
  });

  it("ships a self-contained CSP-constrained static shell", () => {
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("connect-src https://api.typesafe.ai");
    expect(html).toContain('<script type="module" src="./app.js"></script>');
    expect(html).not.toMatch(/<script[^>]+src=["']https?:\/\//iu);
    expect(html).not.toMatch(/<link[^>]+href=["']https?:\/\//iu);
    expect(existsSync("playground/.nojekyll")).toBe(true);
  });

  it("preserves pointer effects with accessibility fallbacks", () => {
    expect(css).toContain("--mx: 50vw");
    expect(css).toContain("--my: 48vh");
    expect(css).toContain("radial-gradient(620px circle at var(--mx) var(--my)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (prefers-contrast: more)");
    expect(css).toContain(":focus-visible");
  });

  it("deploys exactly the static playground directory through GitHub Pages", () => {
    expect(pages).toContain("actions/upload-pages-artifact@v3");
    expect(pages).toContain("actions/deploy-pages@v4");
    expect(pages).toContain("path: ./playground");
    expect(pages).toContain("pages: write");
    expect(pages).toContain("id-token: write");
  });
});
