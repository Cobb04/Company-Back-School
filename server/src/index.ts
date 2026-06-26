import { Hono } from "hono";
import { calculateSafeDepartureTime } from "@return-school/planning-core";
import type { SafeDepartureInput } from "@return-school/shared";

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

export default app;
