import { describe, it, expect } from "vitest";
import { keywordsToRegex, matchesFeedKeyword } from "../src/shared/matching.js";

describe("keywordsToRegex", () => {
  it("creates a regex matching any keyword", () => {
    const re = keywordsToRegex(["does not sponsor", "no sponsorship"]);
    expect(re.test("We does not sponsor visas")).toBe(true);
    expect(re.test("No sponsorship available")).toBe(true);
    expect(re.test("We offer full benefits")).toBe(false);
  });

  it("is case-insensitive", () => {
    const re = keywordsToRegex(["unpaid"]);
    expect(re.test("UNPAID internship")).toBe(true);
    expect(re.test("Unpaid Position")).toBe(true);
  });

  it("escapes regex special characters", () => {
    const re = keywordsToRegex(["c++ developer", "node.js"]);
    expect(re.test("Looking for c++ developer")).toBe(true);
    expect(re.test("Experience with node.js")).toBe(true);
    // Should not match "nodejs" (dot is literal, not wildcard)
    expect(re.test("Experience with nodexjs")).toBe(false);
  });

  it("handles empty keyword array", () => {
    const re = keywordsToRegex([]);
    // Empty alternation matches empty string
    expect(re.test("anything")).toBe(true);
  });
});

describe("matchesFeedKeyword", () => {
  it("returns matching keyword on substring match", () => {
    expect(matchesFeedKeyword("I am hiring a new intern!", ["hiring"])).toBe("hiring");
  });

  it("is case-insensitive", () => {
    expect(matchesFeedKeyword("Proud to ANNOUNCE my new role", ["announce"])).toBe("announce");
  });

  it("returns first matching keyword", () => {
    const result = matchesFeedKeyword("crypto blockchain web3", ["blockchain", "crypto"]);
    expect(result).toBe("blockchain");
  });

  it("returns null when no keyword matches", () => {
    expect(matchesFeedKeyword("Great article about React", ["vue", "angular"])).toBeNull();
  });

  it("returns null for empty keyword list", () => {
    expect(matchesFeedKeyword("anything", [])).toBeNull();
  });

  it("returns null for null/undefined keyword list", () => {
    expect(matchesFeedKeyword("anything", null)).toBeNull();
    expect(matchesFeedKeyword("anything", undefined)).toBeNull();
  });

  it("skips empty keyword strings", () => {
    expect(matchesFeedKeyword("hello world", ["", "world"])).toBe("world");
  });
});
