import { boolean, object, type ObjectSchema, string } from "yup";

/**
 * How the focus timer runs, saved per browser. Lengths are whole minutes from fixed choices,
 * all within what the API accepts for a focus session (one minute to four hours).
 */
export type FocusSettings = {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** Focus sessions before a long break. */
  sessionsPerLongBreak: number;
  /** A soft chime when a phase ends. */
  sound: boolean;
  /** A browser notification when a phase ends while the page is in the background. */
  notify: boolean;
};

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsPerLongBreak: 4,
  sound: true,
  notify: false,
};

export const FOCUS_CHOICES = {
  focusMinutes: [10, 15, 20, 25, 30, 40, 45, 50, 60, 90],
  shortBreakMinutes: [1, 3, 5, 10, 15],
  longBreakMinutes: [10, 15, 20, 25, 30],
  sessionsPerLongBreak: [2, 3, 4, 5, 6],
} as const satisfies Record<string, readonly number[]>;

type LengthKey = keyof typeof FOCUS_CHOICES;
const LENGTH_KEYS = Object.keys(FOCUS_CHOICES) as LengthKey[];

function isChoice(key: LengthKey, value: unknown): value is number {
  return FOCUS_CHOICES[key].some((choice) => choice === value);
}

/** Reads saved settings back; anything missing or not one of the choices is the default. */
export function parseFocusSettings(raw: string | null): FocusSettings {
  if (raw === null) return { ...DEFAULT_FOCUS_SETTINGS };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_FOCUS_SETTINGS };
  }
  if (typeof value !== "object" || value === null) return { ...DEFAULT_FOCUS_SETTINGS };
  const data: Record<string, unknown> = { ...value };
  const settings = { ...DEFAULT_FOCUS_SETTINGS };
  for (const key of LENGTH_KEYS) {
    const stored = data[key];
    if (isChoice(key, stored)) settings[key] = stored;
  }
  if (typeof data.sound === "boolean") settings.sound = data.sound;
  if (typeof data.notify === "boolean") settings.notify = data.notify;
  return settings;
}

// The form

export type FocusSettingsValues = {
  focusMinutes: string;
  shortBreakMinutes: string;
  longBreakMinutes: string;
  sessionsPerLongBreak: string;
  sound: boolean;
  notify: boolean;
};

function choiceField(key: LengthKey) {
  return string().required().oneOf(FOCUS_CHOICES[key].map(String), "Choose one of the options.");
}

export const focusSettingsSchema: ObjectSchema<FocusSettingsValues> = object({
  focusMinutes: choiceField("focusMinutes"),
  shortBreakMinutes: choiceField("shortBreakMinutes"),
  longBreakMinutes: choiceField("longBreakMinutes"),
  sessionsPerLongBreak: choiceField("sessionsPerLongBreak"),
  sound: boolean().required(),
  notify: boolean().required(),
});

export function settingsToValues(settings: FocusSettings): FocusSettingsValues {
  return {
    focusMinutes: String(settings.focusMinutes),
    shortBreakMinutes: String(settings.shortBreakMinutes),
    longBreakMinutes: String(settings.longBreakMinutes),
    sessionsPerLongBreak: String(settings.sessionsPerLongBreak),
    sound: settings.sound,
    notify: settings.notify,
  };
}

export function valuesToSettings(values: FocusSettingsValues): FocusSettings {
  return {
    focusMinutes: Number(values.focusMinutes),
    shortBreakMinutes: Number(values.shortBreakMinutes),
    longBreakMinutes: Number(values.longBreakMinutes),
    sessionsPerLongBreak: Number(values.sessionsPerLongBreak),
    sound: values.sound,
    notify: values.notify,
  };
}
