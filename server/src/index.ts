import { Hono } from "hono";
import {
  calculateSafeDepartureTime,
  calculateSafeDepartureDatetime,
  scoreTrainCandidate,
  generateLeaveMessage,
} from "@return-school/planning-core";
import type {
  SafeDepartureInput,
  TrainSearchRequest,
  TrainSearchResponse,
  ScoredTrain,
  PlanEvaluateRequest,
  GenerateLeaveMessageInput,
  LeaveReason,
} from "@return-school/shared";
import { getStationsForCity } from "@return-school/shared";
import { mockTicketSource } from "./adapters/mockTicketSource";
import { evaluateReturnPlan } from "./services/planEvaluator";

const app = new Hono();

// Health check endpoint — for Issue #2 acceptance criteria.
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// S1: Safe departure time calculator.
// DEPRECATED since S3 — use POST /api/plan/evaluate instead.
// Thin route — validates input, delegates to planning-core, returns JSON.
app.post("/api/plan/safe-departure", async (c) => {
  c.header("Deprecation", "true");
  c.header("Sunset", "Sat, 01 Aug 2026 00:00:00 GMT");
  c.header("Link", '</api/plan/evaluate>; rel="successor-version"');
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

/** Returns true if the ISO datetime has a real calendar date portion. */
function isRealISODate(iso: string): boolean {
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match || !match[1]) return false;
  return isRealDate(match[1]);
}

// S2: Train search with scoring.
// DEPRECATED since S3 — use POST /api/plan/evaluate instead.
// Thin route — validates input, delegates to mockTicketSource + planning-core.
app.post("/api/train/search", async (c) => {
  c.header("Deprecation", "true");
  c.header("Sunset", "Sat, 01 Aug 2026 00:00:00 GMT");
  c.header("Link", '</api/plan/evaluate>; rel="successor-version"');
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

  // Validate firstExamAt is a valid ISO 8601 datetime with a real calendar date
  const firstExamAt = input.firstExamAt as string;
  if (isNaN(new Date(firstExamAt).getTime()) || !isRealISODate(firstExamAt)) {
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

// S3: Plan evaluator — unified deep module endpoint.
// Thin route: validates input, delegates to evaluateReturnPlan, returns JSON.
app.post("/api/plan/evaluate", async (c) => {
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
  const requiredStrings = [
    "departureCity",
    "destinationCity",
    "departDate",
    "preference",
    "clockOutTime",
    "firstExamAt",
  ] as const;
  for (const field of requiredStrings) {
    if (typeof input[field] !== "string" || (input[field] as string).trim() === "") {
      return c.json({ error: `${field} is required and must be a non-empty string` }, 400);
    }
  }

  // Validate departDate format ("YYYY-MM-DD") and real calendar date
  const departDate = input.departDate as string;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departDate) || !isRealDate(departDate)) {
    return c.json({ error: `departDate must be a valid date in YYYY-MM-DD format, got "${departDate}"` }, 400);
  }

  // Validate clockOutTime format ("HH:mm")
  const clockOutTime = input.clockOutTime as string;
  if (!/^\d{2}:\d{2}$/.test(clockOutTime)) {
    return c.json({ error: `clockOutTime must be in HH:mm format, got "${clockOutTime}"` }, 400);
  }

  // Validate firstExamAt is a valid ISO 8601 datetime with a real calendar date
  const firstExamAt = input.firstExamAt as string;
  if (isNaN(new Date(firstExamAt).getTime()) || !isRealISODate(firstExamAt)) {
    return c.json({ error: `firstExamAt must be a valid ISO 8601 datetime, got "${firstExamAt}"` }, 400);
  }

  // Validate preference enum (plan evaluate)
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

  // Call the deep module
  try {
    const result = await evaluateReturnPlan(
      {
        departureCity: input.departureCity as string,
        destinationCity: input.destinationCity as string,
        departDate,
        clockOutTime,
        companyToStationMinutes: input.companyToStationMinutes as number,
        stationEntryBufferMinutes,
        riskBufferMinutes,
        firstExamAt,
        stationToSchoolMinutes: stationToSchool,
        preference: preference as PlanEvaluateRequest["preference"],
        extremeSpeedMode: input.extremeSpeedMode === true,
      },
      { ticketSource: mockTicketSource },
    );

    return c.json(result);
  } catch (err) {
    if (err instanceof Error) {
      // Distinguish between input errors and internal failures
      const isInputError =
        err.message.includes("Unknown departure city") ||
        err.message.includes("Unknown destination city") ||
        err.message.includes("Invalid time") ||
        err.message.includes("Invalid date") ||
        err.message.includes("Invalid ISO");
      return c.json({ error: err.message }, isInputError ? 400 : 500);
    }
    return c.json({ error: "Failed to evaluate return plan" }, 500);
  }
});

// S6: Leave message generator — deterministic template.
// Thin route: validates input, delegates to planning-core, returns JSON.
app.post("/api/plan/leave-message", async (c) => {
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

  // Validate recipientName (required, non-empty string)
  if (typeof input.recipientName !== "string" || input.recipientName.trim() === "") {
    return c.json({ error: "recipientName is required and must be a non-empty string" }, 400);
  }

  // Validate reason (required, must be one of the 4 supported reasons)
  const SUPPORTED_REASONS: LeaveReason[] = ["生病", "考试", "组会", "家庭原因"];
  if (typeof input.reason !== "string" || !(SUPPORTED_REASONS as string[]).includes(input.reason)) {
    return c.json(
      { error: `reason must be one of: ${SUPPORTED_REASONS.join(", ")}` },
      400,
    );
  }

  // Validate trainNumber (required, non-empty string)
  if (typeof input.trainNumber !== "string" || input.trainNumber.trim() === "") {
    return c.json({ error: "trainNumber is required and must be a non-empty string" }, 400);
  }

  // Validate departureStation (required, non-empty string)
  if (typeof input.departureStation !== "string" || input.departureStation.trim() === "") {
    return c.json({ error: "departureStation is required and must be a non-empty string" }, 400);
  }

  // Validate departureTime (required, "HH:mm" format, valid range)
  if (typeof input.departureTime !== "string" || !/^\d{2}:\d{2}$/.test(input.departureTime)) {
    return c.json(
      { error: `departureTime must be in HH:mm format, got "${input.departureTime}"` },
      400,
    );
  }
  {
    const [h, m] = (input.departureTime as string).split(":").map(Number) as [number, number];
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      return c.json(
        { error: `departureTime must have hours 0-23 and minutes 0-59, got "${input.departureTime}"` },
        400,
      );
    }
  }

  // Validate arrivalStation (required, non-empty string)
  if (typeof input.arrivalStation !== "string" || input.arrivalStation.trim() === "") {
    return c.json({ error: "arrivalStation is required and must be a non-empty string" }, 400);
  }

  // Validate departDate (required, "YYYY-MM-DD" format and real calendar date)
  if (typeof input.departDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.departDate)) {
    return c.json(
      { error: `departDate must be in YYYY-MM-DD format, got "${input.departDate}"` },
      400,
    );
  }
  if (!isRealDate(input.departDate)) {
    return c.json(
      { error: `departDate must be a valid calendar date, got "${input.departDate}"` },
      400,
    );
  }

  // Call the deterministic template engine
  try {
    const req: GenerateLeaveMessageInput = {
      recipientName: input.recipientName as string,
      reason: input.reason as LeaveReason,
      trainNumber: input.trainNumber as string,
      departureStation: input.departureStation as string,
      departureTime: input.departureTime as string,
      arrivalStation: input.arrivalStation as string,
      departDate: input.departDate as string,
    };

    const result = generateLeaveMessage(req);
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Failed to generate leave message" },
      400,
    );
  }
});

export default app;
