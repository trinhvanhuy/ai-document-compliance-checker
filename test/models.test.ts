import { describe, expect, it } from "vitest";
import { worst } from "../src/models.js";

describe("worst", () => {
  it("picks the worst verdict", () => {
    expect(worst(["compliant", "needs_human_review"])).toBe("needs_human_review");
    expect(worst(["needs_human_review", "non_compliant"])).toBe("non_compliant");
    expect(worst([])).toBe("compliant");
  });
});
