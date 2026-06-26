// ============================================================
// Return School Planner — Planning Core
// ============================================================
// Deterministic planning functions.
// All business rules live here — server and web consume these,
// never reimplementing time calculation themselves.
// ============================================================

import type { SafeDepartureInput, SafeDepartureOutput } from "@return-school/shared";

/**
 * Calculate the earliest safe train departure time.
 *
 * Formula:
 *   safeDepartureTime = clockOutTime
 *     + companyToStationMinutes
 *     + stationEntryBufferMinutes
 *     + riskBufferMinutes
 *
 * Accepts clock-out time in "HH:mm" 24-hour format and returns
 * the safe departure time in the same format. Handles midnight
 * crossing by wrapping minutes past 23:59.
 */
export function calculateSafeDepartureTime(
  input: SafeDepartureInput,
): SafeDepartureOutput {
  const { clockOutTime, companyToStationMinutes, stationEntryBufferMinutes, riskBufferMinutes } =
    input;

  // Validate minute fields — must be non-negative integers
  validateMinutes("companyToStationMinutes", companyToStationMinutes);
  validateMinutes("stationEntryBufferMinutes", stationEntryBufferMinutes);
  validateMinutes("riskBufferMinutes", riskBufferMinutes);

  // Parse "HH:mm" → minutes from midnight
  const parsed = parseTime(clockOutTime);

  // Sum all minutes
  const totalMinutes =
    parsed.totalMinutes +
    companyToStationMinutes +
    stationEntryBufferMinutes +
    riskBufferMinutes;

  // Wrap around midnight (1440 minutes = 24 hours)
  const wrappedMinutes = totalMinutes % 1440;

  // Format back to "HH:mm"
  const hours = Math.floor(wrappedMinutes / 60);
  const minutes = wrappedMinutes % 60;

  const safeDepartureTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  return { safeDepartureTime };
}

// ============================================================
// Internal helpers (not exported — tested via public interface)
// ============================================================

interface ParsedTime {
  hours: number;
  minutes: number;
  totalMinutes: number;
}

function validateMinutes(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${field} must be a non-negative integer, got ${JSON.stringify(value)}`,
    );
  }
}

function parseTime(time: string): ParsedTime {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new Error(
      `Invalid time format: "${time}". Expected "HH:mm" in 24-hour format.`,
    );
  }

  const [hoursStr, minutesStr] = time.split(":") as [string, string];
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(
      `Invalid time value: "${time}". Hours must be 0–23, minutes 0–59.`,
    );
  }

  return { hours, minutes, totalMinutes: hours * 60 + minutes };
}
