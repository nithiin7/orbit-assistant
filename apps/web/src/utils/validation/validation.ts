/** Yup field builders for the text rules the API applies to most fields. */

import { string } from "yup";

// Control characters, which the API rejects (multi-line text may contain line breaks and tabs).
const CONTROL_CHARACTERS = /\p{Cc}/u;
const CONTROL_CHARACTERS_EXCEPT_WHITESPACE = /(?![\n\r\t])\p{Cc}/u;

export function tooLongMessage(maxLength: number): string {
  return `Use ${maxLength} characters or fewer.`;
}

/**
 * Single-line text, trimmed before it is checked and submitted. Optional unless `.required()`
 * is added; an empty value is then `""`.
 */
export function singleLineText(
  maxLength: number,
  invalidMessage = "Remove line breaks and unsupported characters.",
) {
  return string()
    .trim()
    .defined()
    .max(maxLength, tooLongMessage(maxLength))
    .test("no-control-characters", invalidMessage, (value) => !CONTROL_CHARACTERS.test(value));
}

/** Optional multi-line text, such as a description or notes, trimmed like single-line text. */
export function multiLineText(maxLength: number) {
  return string()
    .trim()
    .defined()
    .max(maxLength, tooLongMessage(maxLength))
    .test(
      "no-control-characters",
      "Remove unsupported characters.",
      (value) => !CONTROL_CHARACTERS_EXCEPT_WHITESPACE.test(value),
    );
}
