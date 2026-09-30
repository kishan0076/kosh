import { describe, expect, it } from "vitest";
import { isValidEmail, passwordProblem, MIN_PASSWORD_LENGTH } from "./account.js";

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("darshan.k@acentecom.com")).toBe(true);
  });
  it("rejects malformed addresses", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("no@domain")).toBe(false);
    expect(isValidEmail("two@@a.com")).toBe(false);
    expect(isValidEmail("has space@a.com")).toBe(false);
  });
});

describe("passwordProblem", () => {
  it("passes a strong-enough password", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });
  it("rejects a short password", () => {
    expect(passwordProblem("short")).toMatch(/at least/i);
  });
  it("rejects an absurdly long password", () => {
    expect(passwordProblem("x".repeat(201))).toMatch(/too long/i);
  });
});
