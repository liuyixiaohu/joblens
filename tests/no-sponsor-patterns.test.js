import { describe, it, expect } from "vitest";
import { keywordsToRegex } from "../src/shared/matching.js";

const NO_SPONSOR_KEYWORDS = [
  "does not sponsor", "do not sponsor", "not sponsor",
  "no sponsorship", "unable to sponsor", "will not sponsor",
  "cannot sponsor", "won't sponsor", "can't sponsor",
  "doesn't sponsor", "not able to sponsor", "without sponsorship",
  "sponsorship is not available", "not offer sponsorship",
  "not provide sponsorship", "sponsorship not available",
  "not eligible for sponsorship", "no visa sponsorship",
  "not offering sponsorship", "unable to provide sponsorship",
  "we are unable to sponsor", "we do not offer sponsorship",
  "must be authorized to work", "must have authorization to work",
  "without the need for sponsorship", "without requiring sponsorship",
];
const NO_SPONSOR_RE = keywordsToRegex(NO_SPONSOR_KEYWORDS);

const UNPAID_KEYWORDS = [
  "unpaid", "unpaid internship", "unpaid position",
  "no compensation", "without compensation", "uncompensated",
  "volunteer position", "volunteer opportunity", "volunteer role",
  "pro bono", "this is a volunteer",
];
const UNPAID_RE = keywordsToRegex(UNPAID_KEYWORDS);

describe("NO_SPONSOR_RE", () => {
  it("matches common no-sponsor phrases", () => {
    expect(NO_SPONSOR_RE.test("This company does not sponsor work visas.")).toBe(true);
    expect(NO_SPONSOR_RE.test("No visa sponsorship is provided")).toBe(true);
    expect(NO_SPONSOR_RE.test("Must be authorized to work in the US")).toBe(true);
    expect(NO_SPONSOR_RE.test("We are unable to sponsor at this time")).toBe(true);
  });

  it("does not match sponsor-friendly text", () => {
    expect(NO_SPONSOR_RE.test("We offer visa sponsorship")).toBe(false);
    expect(NO_SPONSOR_RE.test("Sponsorship available for qualified candidates")).toBe(false);
    expect(NO_SPONSOR_RE.test("Great benefits package and relocation assistance")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(NO_SPONSOR_RE.test("DOES NOT SPONSOR")).toBe(true);
    expect(NO_SPONSOR_RE.test("Without Sponsorship")).toBe(true);
  });
});

describe("UNPAID_RE", () => {
  it("matches unpaid/volunteer patterns", () => {
    expect(UNPAID_RE.test("This is an unpaid internship")).toBe(true);
    expect(UNPAID_RE.test("Volunteer opportunity in marketing")).toBe(true);
    expect(UNPAID_RE.test("Pro bono legal work")).toBe(true);
  });

  it("does not match paid positions", () => {
    expect(UNPAID_RE.test("Competitive salary and benefits")).toBe(false);
    expect(UNPAID_RE.test("Paid internship with growth opportunities")).toBe(false);
  });
});
