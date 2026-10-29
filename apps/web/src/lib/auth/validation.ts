/** Form schemas that mirror the API's validation, for immediate, field-level feedback. */

import { object, ref, string } from "yup";

import { singleLineText } from "@/lib/validation";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const NAME_MAX_LENGTH = 100;

const EMAIL_MAX_LENGTH = 320;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const INVALID_EMAIL = "Enter a valid email address.";

export const emailField = string()
  .trim()
  .required("Enter your email address.")
  .max(EMAIL_MAX_LENGTH, INVALID_EMAIL)
  .matches(EMAIL_PATTERN, { message: INVALID_EMAIL, excludeEmptyString: true });

/** A person's or workspace's name. `label` completes "Enter …" when the name is missing. */
export function nameField(label = "a name") {
  return singleLineText(NAME_MAX_LENGTH, "Remove unsupported characters.").required(
    `Enter ${label}.`,
  );
}

/** A password being chosen. Not trimmed: spaces are part of a password. */
export const newPasswordField = string()
  .defined()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`);

/** Signing in checks only that a password was entered, not the policy for new ones. */
export const signInSchema = object({
  email: emailField,
  password: string().required("Enter your password."),
});

export const signUpSchema = object({
  displayName: nameField("your name"),
  email: emailField,
  password: newPasswordField,
});

export const forgotPasswordSchema = object({ email: emailField });

export const passwordResetSchema = object({
  password: newPasswordField,
  confirmPassword: string()
    .required("Enter the new password again.")
    // A test rather than `oneOf`, which Yup would check before `required`.
    .test(
      "matches-password",
      "The passwords don’t match.",
      (value, context) => !value || value === context.resolve(ref<string>("password")),
    ),
});

export const displayNameSchema = object({ displayName: nameField("your name") });

export const workspaceNameSchema = object({ name: nameField("a workspace name") });
