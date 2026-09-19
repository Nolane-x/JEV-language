import { describe, expect, it } from "vitest";
import {
  activeUserFilterGoal,
  validatePirProgram,
} from "../packages/program-ir/src/index.ts";
import {
  chooseLowestCostCandidate,
  expandFilterHole,
} from "../packages/synthesis-core/src/index.ts";
import {
  renderTypeScript,
  typecheckTypeScript,
} from "../packages/code-backend-core/src/typescript.ts";

describe("fourth vertical slice: PIR typed-hole synthesis", () => {
  it("generates a type-correct filter program and lowers it deterministically", () => {
    const goal = activeUserFilterGoal();
    expect(validatePirProgram(goal).ok).toBe(true);

    const expanded = expandFilterHole({
      program: goal,
      functionId: "function:filter-active-users",
      holeId: "hole:filter-active-users-body",
      property: "active",
    });
    expect(expanded.ok).toBe(true);
    if (!expanded.ok) return;

    const chosen = chooseLowestCostCandidate(expanded.value);
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;

    expect(validatePirProgram(chosen.value.program).ok).toBe(true);
    const source = renderTypeScript(chosen.value.program);
    expect(source.ok).toBe(true);
    if (!source.ok) return;

    expect(source.value).toContain(".filter((user) => user.active)");
    expect(typecheckTypeScript(source.value)).toEqual([]);
  });

  it("refuses synthesis when the requested predicate is absent", () => {
    const result = expandFilterHole({
      program: activeUserFilterGoal(),
      functionId: "function:filter-active-users",
      holeId: "hole:filter-active-users-body",
      property: "doesNotExist",
    });
    expect(result.ok).toBe(false);
  });
});
