import { describe, it, expect } from "vitest";

// getBorderReason is defined inside content.js IIFE, so we extract the logic here.
const BORDER_PRIORITY = ["noSponsor", "reposted", "skippedCompany", "skippedTitle", "applied", "unpaid"];

function getBorderReason(reasons) {
  for (const r of BORDER_PRIORITY) {
    if (reasons.includes(r)) return r;
  }
  return reasons[0];
}

describe("getBorderReason", () => {
  it("returns highest priority reason", () => {
    expect(getBorderReason(["applied", "noSponsor"])).toBe("noSponsor");
    expect(getBorderReason(["unpaid", "reposted"])).toBe("reposted");
  });

  it("returns the only reason when single", () => {
    expect(getBorderReason(["applied"])).toBe("applied");
    expect(getBorderReason(["unpaid"])).toBe("unpaid");
  });

  it("follows full priority order", () => {
    const allReasons = ["unpaid", "applied", "skippedTitle", "skippedCompany", "reposted", "noSponsor"];
    expect(getBorderReason(allReasons)).toBe("noSponsor");
  });

  it("falls back to first element for unknown reasons", () => {
    expect(getBorderReason(["unknown"])).toBe("unknown");
  });
});
