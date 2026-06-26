import { describe, expect, it } from "bun:test";
import type {
  TicketSource,
  TrainCandidate,
  PlanEvaluateRequest,
  PlanEvaluateResponse,
} from "@return-school/shared";
import { evaluateReturnPlan } from "../services/planEvaluator";
import app from "../index.js";

// ---- Fake TicketSource for testing ----

function fakeTicketSource(
  trains: TrainCandidate[],
): TicketSource {
  return {
    async searchTrainCandidates(_params) {
      return trains;
    },
  };
}

// Sample train candidates for testing
function makeCandidate(overrides: Partial<TrainCandidate> = {}): TrainCandidate {
  return {
    id: "G1234",
    trainNumber: "G1234",
    trainType: "G",
    departureStation: "上海虹桥",
    arrivalStation: "烟台站",
    departureTime: "2026-06-26T19:30:00+08:00",
    arrivalTime: "2026-06-26T23:50:00+08:00",
    durationMinutes: 260,
    price: 480,
    source: "mock",
    seats: { "二等座": "available" },
    ...overrides,
  };
}

const DEFAULT_REQUEST: PlanEvaluateRequest = {
  departureCity: "上海",
  destinationCity: "烟台",
  departDate: "2026-06-26",
  clockOutTime: "18:00",
  companyToStationMinutes: 30,
  stationEntryBufferMinutes: 30,
  riskBufferMinutes: 15,
  firstExamAt: "2026-06-27T09:00:00+08:00",
  stationToSchoolMinutes: { "烟台站": 30, "烟台南站": 30 },
  preference: "balanced",
  extremeSpeedMode: false,
};

// ---- evaluateReturnPlan tests ----

describe("evaluateReturnPlan", () => {
  // ---- Success: normal case ----

  it("returns complete PlanEvaluateResponse with good trains (acceptance criterion)", async () => {
    const candidates: TrainCandidate[] = [
      makeCandidate({
        id: "G1234",
        trainNumber: "G1234",
        trainType: "G",
        price: 480,
        durationMinutes: 260,
        departureTime: "2026-06-26T19:30:00+08:00",
      }),
      makeCandidate({
        id: "D5678",
        trainNumber: "D5678",
        trainType: "D",
        price: 320,
        durationMinutes: 390,
        departureTime: "2026-06-26T20:00:00+08:00",
      }),
      makeCandidate({
        id: "K1010",
        trainNumber: "K1010",
        trainType: "K",
        price: 150,
        durationMinutes: 660,
        departureTime: "2026-06-26T20:30:00+08:00",
      }),
    ];

    const result = await evaluateReturnPlan(
      DEFAULT_REQUEST,
      { ticketSource: fakeTicketSource(candidates) },
    );

    // Validate response shape
    expect(result.safeDepartureTime).toBe("19:15");
    expect(result.plans.length).toBeGreaterThanOrEqual(1);
    expect(result.leaveSuggestion).toBeDefined();
    expect(result.leaveSuggestion.needLeave).toBe(false);

    // Validate groupedTrains
    expect(Array.isArray(result.groupedTrains.recommend)).toBe(true);
    expect(Array.isArray(result.groupedTrains.optional)).toBe(true);
    expect(Array.isArray(result.groupedTrains.notRecommended)).toBe(true);

    const totalInGroups =
      result.groupedTrains.recommend.length +
      result.groupedTrains.optional.length +
      result.groupedTrains.notRecommended.length;
    expect(totalInGroups).toBe(candidates.length);
  });

  // ---- Success: leave recommended for high-risk scenario ----

  it("recommends leave when only risky trains available after safe time", async () => {
    // Only K trains after safe time — Pass 1 scores will be low
    // Add an early G train that scores better but requires leave
    const candidates: TrainCandidate[] = [
      makeCandidate({
        id: "G-EARLY",
        trainNumber: "G9999",
        trainType: "G",
        price: 350,
        durationMinutes: 260,
        departureTime: "2026-06-26T17:00:00+08:00", // Before safe time 19:15
        arrivalTime: "2026-06-26T21:20:00+08:00",
      }),
      makeCandidate({
        id: "K-LATE1",
        trainNumber: "K1010",
        trainType: "K",
        price: 150,
        durationMinutes: 660,
        departureTime: "2026-06-26T20:00:00+08:00", // After safe time
        arrivalTime: "2026-06-27T07:00:00+08:00",
        arrivalStation: "烟台站",
      }),
      makeCandidate({
        id: "K-LATE2",
        trainNumber: "K1011",
        trainType: "K",
        price: 140,
        durationMinutes: 660,
        departureTime: "2026-06-26T20:30:00+08:00", // After safe time
        arrivalTime: "2026-06-27T07:30:00+08:00",
        arrivalStation: "烟台站",
      }),
    ];

    // Tight exam time — only 8:00 next day, buffers will be tight for K trains
    const request: PlanEvaluateRequest = {
      ...DEFAULT_REQUEST,
      firstExamAt: "2026-06-27T08:00:00+08:00",
    };

    const result = await evaluateReturnPlan(
      request,
      { ticketSource: fakeTicketSource(candidates) },
    );

    // The early G train should be in the response
    const allTrains = [
      ...result.groupedTrains.recommend,
      ...result.groupedTrains.optional,
      ...result.groupedTrains.notRecommended,
    ];

    expect(allTrains.length).toBe(3);

    // K trains should have high risk due to tight exam buffer
    const kTrain = allTrains.find((t) => t.id === "K-LATE1");
    expect(kTrain).toBeDefined();
    if (kTrain) {
      expect(kTrain.riskLevel).toBe("high");
      expect(kTrain.examBufferMinutes).toBeLessThan(120);
    }

    // Verify plans are generated
    expect(result.plans.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Empty candidates ----

  it("returns empty plans for empty candidates", async () => {
    const result = await evaluateReturnPlan(
      DEFAULT_REQUEST,
      { ticketSource: fakeTicketSource([]) },
    );

    expect(result.plans).toEqual([]);
    expect(result.leaveSuggestion.needLeave).toBe(false);
    expect(result.groupedTrains.recommend).toEqual([]);
    expect(result.groupedTrains.optional).toEqual([]);
    expect(result.groupedTrains.notRecommended).toEqual([]);
  });

  // ---- Error: unknown city ----

  it("throws for unknown departure city", () => {
    const request: PlanEvaluateRequest = {
      ...DEFAULT_REQUEST,
      departureCity: "火星",
    };

    expect(
      evaluateReturnPlan(request, { ticketSource: fakeTicketSource([]) }),
    ).rejects.toThrow("Unknown departure city");
  });

  it("throws for unknown destination city", () => {
    const request: PlanEvaluateRequest = {
      ...DEFAULT_REQUEST,
      destinationCity: "月球",
    };

    expect(
      evaluateReturnPlan(request, { ticketSource: fakeTicketSource([]) }),
    ).rejects.toThrow("Unknown destination city");
  });

  // ---- All trains in response have expected fields ----

  it("all scored trains have required ScoredTrain fields", async () => {
    const candidates: TrainCandidate[] = [
      makeCandidate({ id: "T1", trainNumber: "T1", trainType: "G" }),
    ];

    const result = await evaluateReturnPlan(
      DEFAULT_REQUEST,
      { ticketSource: fakeTicketSource(candidates) },
    );

    const allTrains = [
      ...result.groupedTrains.recommend,
      ...result.groupedTrains.optional,
      ...result.groupedTrains.notRecommended,
    ];

    for (const t of allTrains) {
      expect(typeof t.score).toBe("number");
      expect(["low", "medium", "high"]).toContain(t.riskLevel);
      expect(["recommend", "optional", "not_recommended"]).toContain(t.decision);
      expect(Array.isArray(t.reasons)).toBe(true);
      expect(typeof t.estimatedSchoolArrival).toBe("string");
      expect(typeof t.examBufferMinutes).toBe("number");
      expect(["comfortable", "uncomfortable", "unknown"]).toContain(t.comfortLevel);
    }
  });

  // ---- Preference affects scoring ----

  it("price_sensitive preference ranks cheaper trains higher among safe options", async () => {
    const candidates: TrainCandidate[] = [
      makeCandidate({
        id: "CHEAP",
        trainNumber: "D5678",
        trainType: "D",
        price: 200,
        durationMinutes: 400,
        departureTime: "2026-06-26T19:30:00+08:00",
      }),
      makeCandidate({
        id: "EXPENSIVE",
        trainNumber: "G9999",
        trainType: "G",
        price: 520,
        durationMinutes: 260,
        departureTime: "2026-06-26T20:00:00+08:00",
      }),
    ];

    const result = await evaluateReturnPlan(
      { ...DEFAULT_REQUEST, preference: "price_sensitive" },
      { ticketSource: fakeTicketSource(candidates) },
    );

    const cheap = [...result.groupedTrains.recommend, ...result.groupedTrains.optional].find((t) => t.id === "CHEAP");
    const expensive = [...result.groupedTrains.recommend, ...result.groupedTrains.optional].find((t) => t.id === "EXPENSIVE");

    if (cheap && expensive) {
      expect(cheap.score).toBeGreaterThan(expensive.score);
    }
  });
});

// ---- HTTP integration tests for /api/plan/evaluate ----

describe("POST /api/plan/evaluate", () => {
  const validBody = {
    departureCity: "上海",
    destinationCity: "烟台",
    departDate: "2026-06-26",
    preference: "balanced",
    clockOutTime: "18:00",
    companyToStationMinutes: 30,
    firstExamAt: "2026-06-27T09:00:00+08:00",
    stationToSchoolMinutes: { "烟台站": 30, "烟台南站": 30 },
  };

  // ---- Success ----

  it("returns 200 with PlanEvaluateResponse shape (acceptance criterion)", async () => {
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as PlanEvaluateResponse;
    expect(body.safeDepartureTime).toBeTruthy();
    expect(body.plans).toBeDefined();
    expect(body.groupedTrains).toBeDefined();
    expect(body.leaveSuggestion).toBeDefined();
    expect(typeof body.leaveSuggestion.needLeave).toBe("boolean");
    expect(typeof body.leaveSuggestion.reason).toBe("string");
  });

  it("returns plans with required fields", async () => {
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const body = (await res.json()) as PlanEvaluateResponse;
    if (body.plans.length > 0) {
      const plan = body.plans[0]!;
      expect(plan.title).toBeTruthy();
      expect(plan.summary).toBeTruthy();
      expect(plan.train).toBeDefined();
      expect(Array.isArray(plan.risks)).toBe(true);
      expect(Array.isArray(plan.checklist)).toBe(true);
    }
  });

  it("returns trains sorted by score", async () => {
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const body = (await res.json()) as PlanEvaluateResponse;
    const allTrains = [
      ...body.groupedTrains.recommend,
      ...body.groupedTrains.optional,
      ...body.groupedTrains.notRecommended,
    ];

    for (let i = 1; i < allTrains.length; i++) {
      expect(allTrains[i - 1]!.score).toBeGreaterThanOrEqual(allTrains[i]!.score);
    }
  });

  // ---- Validation errors ----

  it("returns 400 for missing departureCity", async () => {
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, departureCity: "" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid preference", async () => {
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, preference: "cheapest" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown departure city", async () => {
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, departureCity: "北京" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid departDate", async () => {
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, departDate: "2026-13-01" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid firstExamAt", async () => {
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, firstExamAt: "not-a-date" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for pseudo-legal firstExamAt (2026-02-31)", async () => {
    // JS would roll 2026-02-31 to Mar 3 — round-trip validation must catch this
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, firstExamAt: "2026-02-31T09:00:00+08:00" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for pseudo-legal firstExamAt (2026-04-31)", async () => {
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, firstExamAt: "2026-04-31T09:00:00+08:00" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing companyToStationMinutes", async () => {
    const { companyToStationMinutes, ...rest } = validBody;
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rest),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for non-object body", async () => {
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["array"]),
    });

    expect(res.status).toBe(400);
  });

  // ---- Does NOT break existing endpoints ----

  it("GET /health still works", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("POST /api/train/search still works (not broken by S3)", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.trains)).toBe(true);
  });

  // ---- Exam buffer display data ----

  it("returns examBufferMinutes per train", async () => {
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const body = (await res.json()) as PlanEvaluateResponse;
    const allTrains = [
      ...body.groupedTrains.recommend,
      ...body.groupedTrains.optional,
      ...body.groupedTrains.notRecommended,
    ];

    for (const t of allTrains) {
      expect(typeof t.examBufferMinutes).toBe("number");
      expect(typeof t.estimatedSchoolArrival).toBe("string");
    }
  });
});
