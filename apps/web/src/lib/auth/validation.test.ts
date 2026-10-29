import { describe, expect, it } from "vitest";

import {
  hasErrors,
  validateName,
  validatePasswordReset,
  validateSignIn,
  validateSignUp,
} from "./validation";

describe("validateSignUp", () => {
  it("accepts valid input", () => {
    const errors = validateSignUp({
      displayName: " Ada ",
      email: "ada@example.com",
      password: "long enough",
    });
    expect(hasErrors(errors)).toBe(false);
  });

  it("explains each invalid field", () => {
    expect(validateSignUp({ displayName: " ", email: "ada@", password: "short" })).toEqual({
      displayName: "Enter your name.",
      email: "Enter a valid email address.",
      password: "Use at least 8 characters.",
    });
  });

  it("limits password length to what the API accepts", () => {
    expect(
      validateSignUp({ displayName: "A", email: "a@b.co", password: "x".repeat(129) }).password,
    ).toBe("Use 128 characters or fewer.");
  });
});

describe("validateSignIn", () => {
  it("requires both fields without applying the password policy", () => {
    expect(validateSignIn({ email: "", password: "" })).toEqual({
      email: "Enter your email address.",
      password: "Enter your password.",
    });
    expect(hasErrors(validateSignIn({ email: "ada@example.com", password: "x" }))).toBe(false);
  });
});

describe("validateName", () => {
  it("rejects names the API would reject", () => {
    expect(validateName("x".repeat(101))).toBe("Use 100 characters or fewer.");
    expect(validateName("Tab\there")).toBe("Remove unsupported characters.");
    expect(validateName("Side project")).toBeUndefined();
  });
});

describe("validatePasswordReset", () => {
  it("applies the password policy and requires a matching confirmation", () => {
    expect(validatePasswordReset({ password: "short", confirmPassword: "" })).toEqual({
      password: "Use at least 8 characters.",
      confirmPassword: "Enter the new password again.",
    });
    expect(
      validatePasswordReset({ password: "long enough", confirmPassword: "long enougj" })
        .confirmPassword,
    ).toBe("The passwords don’t match.");
    expect(
      hasErrors(validatePasswordReset({ password: "long enough", confirmPassword: "long enough" })),
    ).toBe(false);
  });
});
