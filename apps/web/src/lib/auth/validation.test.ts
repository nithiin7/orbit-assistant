import { describe, expect, it } from "vitest";

import { fieldErrors, firstError } from "@/test/validation";

import { nameField, passwordResetSchema, signInSchema, signUpSchema } from "./validation";

describe("signUpSchema", () => {
  it("accepts valid input and trims the name and email", () => {
    const values = { displayName: " Ada ", email: " ada@example.com ", password: "long enough" };
    expect(fieldErrors(signUpSchema, values)).toEqual({});
    expect(signUpSchema.validateSync(values)).toEqual({
      displayName: "Ada",
      email: "ada@example.com",
      password: "long enough",
    });
  });

  it("explains each invalid field", () => {
    expect(
      fieldErrors(signUpSchema, { displayName: " ", email: "ada@", password: "short" }),
    ).toEqual({
      displayName: "Enter your name.",
      email: "Enter a valid email address.",
      password: "Use at least 8 characters.",
    });
  });

  it("limits password length to what the API accepts", () => {
    expect(
      fieldErrors(signUpSchema, { displayName: "A", email: "a@b.co", password: "x".repeat(129) })
        .password,
    ).toBe("Use 128 characters or fewer.");
  });
});

describe("signInSchema", () => {
  it("requires both fields without applying the password policy", () => {
    expect(fieldErrors(signInSchema, { email: "", password: "" })).toEqual({
      email: "Enter your email address.",
      password: "Enter your password.",
    });
    expect(fieldErrors(signInSchema, { email: "ada@example.com", password: "x" })).toEqual({});
  });
});

describe("nameField", () => {
  it("rejects names the API would reject", () => {
    expect(firstError(nameField(), "x".repeat(101))).toBe("Use 100 characters or fewer.");
    expect(firstError(nameField(), "Tab\there")).toBe("Remove unsupported characters.");
    expect(firstError(nameField("a workspace name"), "  ")).toBe("Enter a workspace name.");
    expect(firstError(nameField(), "Side project")).toBeUndefined();
  });
});

describe("passwordResetSchema", () => {
  it("applies the password policy and requires a matching confirmation", () => {
    expect(fieldErrors(passwordResetSchema, { password: "short", confirmPassword: "" })).toEqual({
      password: "Use at least 8 characters.",
      confirmPassword: "Enter the new password again.",
    });
    expect(
      fieldErrors(passwordResetSchema, { password: "long enough", confirmPassword: "long enougj" })
        .confirmPassword,
    ).toBe("The passwords don’t match.");
    expect(
      fieldErrors(passwordResetSchema, { password: "long enough", confirmPassword: "long enough" }),
    ).toEqual({});
  });
});
