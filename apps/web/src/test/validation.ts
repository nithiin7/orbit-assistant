import { type AnyObject, type ObjectSchema, type Schema, ValidationError } from "yup";

/** The first message a schema reports for `value`, or `undefined` when it is valid. */
export function firstError(schema: Schema, value: unknown): string | undefined {
  try {
    schema.validateSync(value);
    return undefined;
  } catch (error) {
    if (error instanceof ValidationError) return error.errors[0];
    throw error;
  }
}

/** Each invalid field's first message, as a form would show it. */
export function fieldErrors(
  schema: ObjectSchema<AnyObject>,
  values: AnyObject,
): Record<string, string> {
  try {
    schema.validateSync(values, { abortEarly: false });
    return {};
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    const errors: Record<string, string> = {};
    for (const issue of error.inner) {
      const [message] = issue.errors;
      if (issue.path && message && !(issue.path in errors)) errors[issue.path] = message;
    }
    return errors;
  }
}
