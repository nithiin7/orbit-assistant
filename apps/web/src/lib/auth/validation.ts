/** Client-side checks that mirror the API's validation, for immediate, field-level feedback. */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const NAME_MAX_LENGTH = 100;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Control characters, which the API rejects in names.
const CONTROL_CHARACTERS = /\p{Cc}/u;

export type FieldErrors<Field extends string> = Partial<Record<Field, string>>;

export function validateEmail(email: string): string | undefined {
  const value = email.trim();
  if (!value) return "Enter your email address.";
  if (value.length > 320 || !EMAIL_PATTERN.test(value)) return "Enter a valid email address.";
  return undefined;
}

export function validateName(name: string, label = "a name"): string | undefined {
  const value = name.trim();
  if (!value) return `Enter ${label}.`;
  if (value.length > NAME_MAX_LENGTH) return `Use ${NAME_MAX_LENGTH} characters or fewer.`;
  if (CONTROL_CHARACTERS.test(value)) return "Remove unsupported characters.";
  return undefined;
}

export function validateNewPassword(password: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  }
  return undefined;
}

export function validateSignIn(values: {
  email: string;
  password: string;
}): FieldErrors<"email" | "password"> {
  return {
    email: validateEmail(values.email),
    password: values.password ? undefined : "Enter your password.",
  };
}

export function validateSignUp(values: {
  displayName: string;
  email: string;
  password: string;
}): FieldErrors<"displayName" | "email" | "password"> {
  return {
    displayName: validateName(values.displayName, "your name"),
    email: validateEmail(values.email),
    password: validateNewPassword(values.password),
  };
}

export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some(Boolean);
}
