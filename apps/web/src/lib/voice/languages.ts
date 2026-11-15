/**
 * Languages offered for recognition and speech. Indian English and Hindi first; any BCP 47 tag
 * the engine supports also works. `auto` lets the engine decide (Whisper detects the language;
 * browsers use their own language).
 */
export const AUTO_LANGUAGE = "auto";

export const voiceLanguages: readonly { value: string; label: string }[] = [
  { value: AUTO_LANGUAGE, label: "Detect automatically" },
  { value: "en-IN", label: "English (India)" },
  { value: "hi-IN", label: "Hindi (हिन्दी)" },
  { value: "en-US", label: "English (United States)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "bn-IN", label: "Bengali (India)" },
  { value: "ta-IN", label: "Tamil (India)" },
  { value: "te-IN", label: "Telugu (India)" },
  { value: "mr-IN", label: "Marathi (India)" },
  { value: "kn-IN", label: "Kannada (India)" },
  { value: "ml-IN", label: "Malayalam (India)" },
  { value: "gu-IN", label: "Gujarati (India)" },
  { value: "es-ES", label: "Spanish" },
  { value: "fr-FR", label: "French" },
  { value: "de-DE", label: "German" },
];

/** The tag to hand a browser engine: `auto` becomes the browser's own language. */
export function browserLanguage(language: string | null | undefined, fallback: string): string {
  return !language || language === AUTO_LANGUAGE ? fallback : language;
}
