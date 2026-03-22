import { describe, it, expect } from "vitest";

// Poll detection regex — same pattern used in src/feed.js detectContentTypes()
const POLL_VOTE_RE = /^\d+ votes?$/;

describe("Poll detection regex", () => {
  it("matches '0 votes'", () => {
    expect(POLL_VOTE_RE.test("0 votes")).toBe(true);
  });

  it("matches '1 vote' (singular)", () => {
    expect(POLL_VOTE_RE.test("1 vote")).toBe(true);
  });

  it("matches '42 votes'", () => {
    expect(POLL_VOTE_RE.test("42 votes")).toBe(true);
  });

  it("matches '1000 votes'", () => {
    expect(POLL_VOTE_RE.test("1000 votes")).toBe(true);
  });

  it("does not match text with extra content", () => {
    expect(POLL_VOTE_RE.test("42 votes and counting")).toBe(false);
    expect(POLL_VOTE_RE.test("See 42 votes")).toBe(false);
  });

  it("does not match non-vote text", () => {
    expect(POLL_VOTE_RE.test("votes")).toBe(false);
    expect(POLL_VOTE_RE.test("no votes here")).toBe(false);
    expect(POLL_VOTE_RE.test("")).toBe(false);
  });

  it("does not match partial patterns", () => {
    expect(POLL_VOTE_RE.test("42 voted")).toBe(false);
    expect(POLL_VOTE_RE.test("42 voters")).toBe(false);
  });
});
