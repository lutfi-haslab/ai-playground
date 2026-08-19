import { test, expect, describe } from "bun:test";
import { validateEmail, formatUser } from "../src/userService";

describe("userService", () => {
  test("validates standard emails", () => {
    expect(validateEmail("user@example.com")).toBe(true);
    expect(validateEmail("invalid-email")).toBe(false);
  });

  test("validates complex emails with subdomains and plus tags", () => {
    expect(validateEmail("alice.smith+bench@mail.example.co.uk")).toBe(true);
    expect(validateEmail("dev+test@sub.domain.org")).toBe(true);
    expect(validateEmail("@missinguser.com")).toBe(false);
  });

  test("formats active users correctly", () => {
    const user = {
      id: "u-1",
      name: "Alice",
      email: "alice@example.com",
      isActive: true,
    };
    expect(formatUser(user)).toBe("Alice <alice@example.com>");
  });

  test("formats inactive users correctly", () => {
    const user = {
      id: "u-2",
      name: "Bob",
      email: "bob@example.com",
      isActive: false,
    };
    expect(formatUser(user)).toBe("[INACTIVE] Bob <bob@example.com>");
  });
});
