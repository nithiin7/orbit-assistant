/**
 * Converting the API's canonical units to the person's units for display, and their input back.
 *
 * The API stores and sends integers: grams, millimetres, metres, seconds, millilitres,
 * milligrams for nutrients, small calories (1 kcal = 1,000 cal) for energy, and thousandths for
 * quantities. Conversions use exact factors (1 lb = 453.59237 g, 1 in = 25.4 mm,
 * 1 mi = 1,609.344 m, 1 kcal = 4.184 kJ, 1 US fl oz = 29.5735295625 ml) and round only at the
 * edges: input to the nearest canonical unit, display to a sensible number of decimals.
 */

import type { DistanceUnit, EnergyUnit, LengthUnit, WaterUnit, WeightUnit } from "@orbit/contracts";

export const GRAMS_PER_POUND = 453.59237;
export const MM_PER_INCH = 25.4;
export const METRES_PER_MILE = 1609.344;
export const KJ_PER_KCAL = 4.184;
export const ML_PER_FL_OZ = 29.5735295625;

const numberFormats = new Map<number, Intl.NumberFormat>();

/** `value` with at most `decimals` decimals, grouped by the locale. */
export function formatNumber(value: number, decimals = 0): string {
  let format = numberFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals });
    numberFormats.set(decimals, format);
  }
  return format.format(value);
}

/** A typed number, accepting a decimal comma; `null` when blank or not a number. */
export function parseDecimal(input: string): number | null {
  const text = input.trim().replace(",", ".");
  if (text === "" || !/^-?\d*\.?\d+$|^-?\d+\.$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Up to `decimals` decimals, without trailing zeros, for prefilling an input. */
function inputText(value: number, decimals: number): string {
  return String(round(value, decimals));
}

// Weight

export const WEIGHT_LABELS: Record<WeightUnit, string> = { kg: "kg", lb: "lb" };

export function gramsTo(grams: number, unit: WeightUnit): number {
  return unit === "kg" ? grams / 1000 : grams / GRAMS_PER_POUND;
}

export function gramsFrom(value: number, unit: WeightUnit): number {
  return Math.round(unit === "kg" ? value * 1000 : value * GRAMS_PER_POUND);
}

export function formatWeight(grams: number | null | undefined, unit: WeightUnit): string {
  if (grams === null || grams === undefined) return "—";
  return `${formatNumber(gramsTo(grams, unit), unit === "kg" ? 2 : 1)} ${unit}`;
}

export function weightInput(grams: number | null | undefined, unit: WeightUnit): string {
  return grams === null || grams === undefined ? "" : inputText(gramsTo(grams, unit), 2);
}

export function parseWeight(input: string, unit: WeightUnit): number | null {
  const value = parseDecimal(input);
  return value === null ? null : gramsFrom(value, unit);
}

/** Training volume (gram-reps) in the weight unit, without decimals. */
export function formatVolume(gramReps: number, unit: WeightUnit): string {
  return `${formatNumber(gramsTo(gramReps, unit))} ${unit}`;
}

// Length

export function formatLength(mm: number | null | undefined, unit: LengthUnit): string {
  if (mm === null || mm === undefined) return "—";
  return `${formatNumber(unit === "cm" ? mm / 10 : mm / MM_PER_INCH, 1)} ${unit}`;
}

export function lengthInput(mm: number | null | undefined, unit: LengthUnit): string {
  if (mm === null || mm === undefined) return "";
  return inputText(unit === "cm" ? mm / 10 : mm / MM_PER_INCH, 1);
}

export function parseLength(input: string, unit: LengthUnit): number | null {
  const value = parseDecimal(input);
  if (value === null) return null;
  return Math.round(unit === "cm" ? value * 10 : value * MM_PER_INCH);
}

// Distance

export function metresTo(metres: number, unit: DistanceUnit): number {
  return unit === "km" ? metres / 1000 : metres / METRES_PER_MILE;
}

export function formatDistance(metres: number | null | undefined, unit: DistanceUnit): string {
  if (metres === null || metres === undefined) return "—";
  if (unit === "km" && metres < 1000) return `${formatNumber(metres)} m`;
  return `${formatNumber(metresTo(metres, unit), 2)} ${unit}`;
}

export function distanceInput(metres: number | null | undefined, unit: DistanceUnit): string {
  return metres === null || metres === undefined ? "" : inputText(metresTo(metres, unit), 3);
}

export function parseDistance(input: string, unit: DistanceUnit): number | null {
  const value = parseDecimal(input);
  if (value === null) return null;
  return Math.round(unit === "km" ? value * 1000 : value * METRES_PER_MILE);
}

// Energy and nutrients

export function formatEnergy(cal: number | null | undefined, unit: EnergyUnit): string {
  if (cal === null || cal === undefined) return "—";
  const kcal = cal / 1000;
  return unit === "kcal" ? `${formatNumber(kcal)} kcal` : `${formatNumber(kcal * KJ_PER_KCAL)} kJ`;
}

export function energyInput(cal: number | null | undefined, unit: EnergyUnit): string {
  if (cal === null || cal === undefined) return "";
  return inputText(unit === "kcal" ? cal / 1000 : (cal / 1000) * KJ_PER_KCAL, 1);
}

export function parseEnergy(input: string, unit: EnergyUnit): number | null {
  const value = parseDecimal(input);
  if (value === null) return null;
  return Math.round(unit === "kcal" ? value * 1000 : (value / KJ_PER_KCAL) * 1000);
}

/** Milligrams as grams, to one decimal. */
export function formatGrams(mg: number | null | undefined): string {
  if (mg === null || mg === undefined) return "—";
  return `${formatNumber(mg / 1000, 1)} g`;
}

export function gramsInput(mg: number | null | undefined): string {
  return mg === null || mg === undefined ? "" : inputText(mg / 1000, 1);
}

export function parseGrams(input: string): number | null {
  const value = parseDecimal(input);
  return value === null ? null : Math.round(value * 1000);
}

// Water

export const WATER_LABELS: Record<WaterUnit, string> = { ml: "ml", l: "L", fl_oz: "fl oz" };

export function waterTo(ml: number, unit: WaterUnit): number {
  if (unit === "ml") return ml;
  return unit === "l" ? ml / 1000 : ml / ML_PER_FL_OZ;
}

export function formatWater(ml: number | null | undefined, unit: WaterUnit): string {
  if (ml === null || ml === undefined) return "—";
  const decimals = unit === "ml" ? 0 : unit === "l" ? 2 : 1;
  return `${formatNumber(waterTo(ml, unit), decimals)} ${WATER_LABELS[unit]}`;
}

export function waterInput(ml: number | null | undefined, unit: WaterUnit): string {
  return ml === null || ml === undefined ? "" : inputText(waterTo(ml, unit), 2);
}

export function parseWater(input: string, unit: WaterUnit): number | null {
  const value = parseDecimal(input);
  if (value === null) return null;
  if (unit === "ml") return Math.round(value);
  return Math.round(unit === "l" ? value * 1000 : value * ML_PER_FL_OZ);
}

// Quantities

/** Thousandths of a unit as a plain number (1500 is "1.5"). */
export function formatQuantity(milli: number): string {
  return formatNumber(milli / 1000, 3);
}

export function quantityInput(milli: number | null | undefined): string {
  return milli === null || milli === undefined ? "" : inputText(milli / 1000, 3);
}

export function parseQuantity(input: string): number | null {
  const value = parseDecimal(input);
  return value === null ? null : Math.round(value * 1000);
}

// Durations

/** Seconds as `1 h 05 min`, `45 min`, or `40 s`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** Seconds as a clock: `1:05:09` or `4:09`. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function clockInput(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined ? "" : formatClock(seconds);
}

/** `m:ss`, `h:mm:ss`, or a plain number of seconds. */
export function parseClock(input: string): number | null {
  const text = input.trim();
  if (text === "") return null;
  if (/^\d+$/.test(text)) return Number(text);
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const [, h, m, s] = match;
  const seconds = Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s);
  return Number(s) < 60 ? seconds : null;
}

/** Minutes typed for an activity, as seconds. */
export function parseMinutes(input: string): number | null {
  const value = parseDecimal(input);
  return value === null ? null : Math.round(value * 60);
}

export function minutesInput(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined ? "" : inputText(seconds / 60, 1);
}

/** Hours typed for sleep, as seconds. */
export function parseHours(input: string): number | null {
  const value = parseDecimal(input);
  return value === null ? null : Math.round(value * 3600);
}

export function hoursInput(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined ? "" : inputText(seconds / 3600, 2);
}
