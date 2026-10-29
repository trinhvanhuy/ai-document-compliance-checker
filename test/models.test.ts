import { describe, expect, it } from "vitest";
import { todayInParis } from "../src/engine.js";
import { isIsoDate, worst } from "../src/models.js";

describe("worst", () => {
  it("picks the worst verdict", () => {
    expect(worst(["compliant", "needs_human_review"])).toBe("needs_human_review");
    expect(worst(["needs_human_review", "non_compliant"])).toBe("non_compliant");
    expect(worst([])).toBe("compliant");
  });
});

describe("dates", () => {
  it("isIsoDate", () => {
    expect(isIsoDate("2026-10-29")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("29/10/2026")).toBe(false);
    expect(isIsoDate("2026-1-5")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it("today is the Paris date", () => {
    // 23:30 UTC on Dec 31 is already Jan 1 in Paris
    expect(todayInParis(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
});
