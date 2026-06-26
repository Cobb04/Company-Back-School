import { Hono } from "hono";
import {
  calculateSafeDepartureTime,
  calculateSafeDepartureDatetime,
  scoreTrainCandidate,
} from "@return-school/planning-core";
import type {
  SafeDepartureInput,
  TrainSearchRequest,
  TrainSearchResponse,
  ScoredTrain,
} from "@return-school/shared";
import { getStationsForCity } from "@return-school/shared";
import { mockTicketSource } from "./adapters/mockTicketSource";

const app = new Hono();

// Health check endpoint — for Issue #2 acceptance criteria.
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// S1: Safe departure time calculator.
// Thin route — validates input, delegates to planning-core, returns JSON.
app.post("/api/plan/safe-departure", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Body must be a non-null object
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "Request body must be a JSON object" }, 400);
  }

  const input = body as Record<string, unknown>;

  // Validate clockOutTime (required, non-empty string)
  if (typeof input.clockOutTime !== "string" || input.clockOutTime === "") {
    return c.json({ error: "clockOutTime is required and must be a non-empty string" }, 400);
  }

  // Validate companyToStationMinutes (required, non-negative integer)
  if (!isValidMinutes(input.companyToStationMinutes)) {
    return c.json(
      { error: "companyToStationMinutes must be a non-negative integer" },
      400,
    );
  }

  // Validate optional minute fields (non-negative integer if present)
  if (
    input.stationEntryBufferMinutes !== undefined &&
    !isValidMinutes(input.stationEntryBufferMinutes)
  ) {
    return c.json(
      { error: "stationEntryBufferMinutes must be a non-negative integer" },
      400,
    );
  }
  if (
    input.riskBufferMinutes !== undefined &&
    !isValidMinutes(input.riskBufferMinutes)
  ) {
    return c.json(
      { error: "riskBufferMinutes must be a non-negative integer" },
      400,
    );
  }

  // Apply defaults
  const safeDepartureInput: SafeDepartureInput = {
    clockOutTime: input.clockOutTime as string,
    companyToStationMinutes: input.companyToStationMinutes as number,
    stationEntryBufferMinutes:
      typeof input.stationEntryBufferMinutes === "number"
        ? (input.stationEntryBufferMinutes as number)
        : 30,
    riskBufferMinutes:
      typeof input.riskBufferMinutes === "number"
        ? (input.riskBufferMinutes as number)
        : 15,
  };

  try {
    const result = calculateSafeDepartureTime(safeDepartureInput);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Calculation failed" }, 400);
  }
});

/** Returns true if value is a non-negative integer. */
function isValidMinutes(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Returns true if the string is a real calendar date (not just regex-valid). */
function isRealDate(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return false;
  // Round-trip: the parsed date must produce the same YYYY-MM-DD string.
  // This rejects impossible dates like "2026-02-31" (JS rolls to Mar 3).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}` === dateStr;
}

// S2: Train search with scoring.
// Thin route — validates input, delegates to mockTicketSource + planning-core.
app.post("/api/train/search", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "Request body must be a JSON object" }, 400);
  }

  const input = body as Record<string, unknown>;

  // Validate required string fields
  const requiredStrings: Array<keyof TrainSearchRequest> = [
    "departureCity",
    "destinationCity",
    "departDate",
    "preference",
    "clockOutTime",
    "firstExamAt",
  ];
  for (const field of requiredStrings) {
    if (typeof input[field] !== "string" || (input[field] as string).trim() === "") {
      return c.json({ error: `${field} is required and must be a non-empty string` }, 400);
    }
  }

  // Validate departDate format ("YYYY-MM-DD") and that it is a real calendar date
  const departDate = input.departDate as string;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departDate) || !isRealDate(departDate)) {
    return c.json({ error: `departDate must be a valid date in YYYY-MM-DD format, got "${departDate}"` }, 400);
  }

  // Validate clockOutTime format ("HH:mm")
  const clockOutTime = input.clockOutTime as string;
  if (!/^\d{2}:\d{2}$/.test(clockOutTime)) {
    return c.json({ error: `clockOutTime must be in HH:mm format, got "${clockOutTime}"` }, 400);
  }

  // Validate firstExamAt is a valid ISO 8601 datetime (prevent 500 in scoring)
  const firstExamAt = input.firstExamAt as string;
  if (isNaN(new Date(firstExamAt).getTime())) {
    return c.json({ error: `firstExamAt must be a valid ISO 8601 datetime, got "${firstExamAt}"` }, 400);
  }

  // Validate preference enum
  const preference = input.preference as string;
  if (!["price_sensitive", "time_sensitive", "balanced"].includes(preference)) {
    return c.json(
      { error: `preference must be one of: price_sensitive, time_sensitive, balanced` },
      400,
    );
  }

  // Validate departure city
  const depStations = getStationsForCity(input.departureCity as string);
  if (depStations.length === 0) {
    return c.json(
      { error: `Unknown departure city: "${input.departureCity}". Supported: 上海, 烟台` },
      400,
    );
  }

  // Validate destination city
  const arrStations = getStationsForCity(input.destinationCity as string);
  if (arrStations.length === 0) {
    return c.json(
      { error: `Unknown destination city: "${input.destinationCity}". Supported: 上海, 烟台` },
      400,
    );
  }

  // Validate companyToStationMinutes (required, non-negative integer)
  if (!isValidMinutes(input.companyToStationMinutes)) {
    return c.json(
      { error: "companyToStationMinutes must be a non-negative integer" },
      400,
    );
  }

  // Validate stationToSchoolMinutes (required, non-null object)
  if (
    input.stationToSchoolMinutes === null ||
    typeof input.stationToSchoolMinutes !== "object" ||
    Array.isArray(input.stationToSchoolMinutes)
  ) {
    return c.json(
      { error: "stationToSchoolMinutes must be a non-null object mapping station names to minutes" },
      400,
    );
  }

  // Validate optional minute fields
  const stationEntryBufferMinutes =
    typeof input.stationEntryBufferMinutes === "number" ? input.stationEntryBufferMinutes : 30;
  const riskBufferMinutes =
    typeof input.riskBufferMinutes === "number" ? input.riskBufferMinutes : 15;

  if (!isValidMinutes(stationEntryBufferMinutes)) {
    return c.json({ error: "stationEntryBufferMinutes must be a non-negative integer" }, 400);
  }
  if (!isValidMinutes(riskBufferMinutes)) {
    return c.json({ error: "riskBufferMinutes must be a non-negative integer" }, 400);
  }

  const stationToSchool = input.stationToSchoolMinutes as Record<string, number>;
  for (const [station, minutes] of Object.entries(stationToSchool)) {
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 0) {
      return c.json(
        { error: `stationToSchoolMinutes["${station}"] must be a non-negative integer` },
        400,
      );
    }
  }

  // Calculate safe departure time — both HH:mm display and full ISO datetime
  let safeTime: string;
  let safeDepartureDatetime: string;
  try {
    safeTime = calculateSafeDepartureTime({
      clockOutTime,
      companyToStationMinutes: input.companyToStationMinutes as number,
      stationEntryBufferMinutes,
      riskBufferMinutes,
    }).safeDepartureTime;

    // Full datetime for correct cross-midnight comparison
    safeDepartureDatetime = calculateSafeDepartureDatetime({
      departDate,
      clockOutTime,
      companyToStationMinutes: input.companyToStationMinutes as number,
      stationEntryBufferMinutes,
      riskBufferMinutes,
    });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Invalid input for safe departure calculation" },
      400,
    );
  }

  // Search for train candidates
  let candidates;
  try {
    candidates = await mockTicketSource.searchTrainCandidates({
      fromStations: depStations,
      toStations: arrStations,
      departDate,
    });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Failed to search train candidates" },
      500,
    );
  }

  if (candidates.length === 0) {
    const response: TrainSearchResponse = {
      trains: [],
      safeDepartureTime: safeTime,
      total: 0,
    };
    return c.json(response);
  }

  // Score each candidate — use full ISO datetime for safe departure comparison
  let scoredTrains: ScoredTrain[];
  try {
    scoredTrains = candidates.map((train) =>
      scoreTrainCandidate({
        train,
        safeDepartureDatetime,
        firstExamAt,
        stationToSchoolMinutes: stationToSchool,
        preference: input.preference as TrainSearchRequest["preference"],
      }),
    );
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Failed to score train candidates" },
      400,
    );
  }

  // Sort by score descending, then by departure time ascending for ties
  scoredTrains.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.departureTime.localeCompare(b.departureTime);
  });

  const response: TrainSearchResponse = {
    trains: scoredTrains,
    safeDepartureTime: safeTime,
    total: scoredTrains.length,
  };

  return c.json(response);
});

export default app;
