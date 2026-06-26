import { describe, expect, it } from "bun:test";

// This test directly tests the route handler logic by importing the app
// and using Hono's request testing pattern.
// For a real integration test we'd spin up the server, but bun:test
// with Hono's built-in testing works well.

// We'll test the app by importing it and calling .fetch()
import app from "../index.js";

describe("POST /api/train/search", () => {
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

  // --- Success cases ---

  it("returns trains from all Shanghai stations matching Yantai stations", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.trains)).toBe(true);
    expect(typeof body.safeDepartureTime).toBe("string");
    expect(body.safeDepartureTime).toBe("19:15"); // 18:00 + 30 + 30 + 15
  });

  it("returns scored trains with required fields", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const body = await res.json();
    expect(body.total).toBeGreaterThan(0);

    const train = body.trains[0];
    expect(train).toBeDefined();
    expect(typeof train.score).toBe("number");
    expect(["low", "medium", "high"]).toContain(train.riskLevel);
    expect(["recommend", "optional", "not_recommended"]).toContain(train.decision);
    expect(Array.isArray(train.reasons)).toBe(true);
    expect(train.reasons.length).toBeGreaterThan(0);
    expect(typeof train.estimatedSchoolArrival).toBe("string");
    expect(typeof train.examBufferMinutes).toBe("number");
    expect(["comfortable", "uncomfortable", "unknown"]).toContain(train.comfortLevel);
  });

  it("sorts trains by score descending", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const body = await res.json();
    const trains = body.trains as Array<{ score: number }>;
    for (let i = 0; i < trains.length - 1; i++) {
      expect(trains[i]!.score).toBeGreaterThanOrEqual(trains[i + 1]!.score);
    }
  });

  it("price_sensitive: cheaper trains rank higher among safe options (revised acceptance criterion)", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, preference: "price_sensitive" }),
    });

    const body = await res.json();
    const trains = body.trains as Array<{
      trainNumber: string;
      trainType: string;
      price: number;
      score: number;
      riskLevel: string;
      decision: string;
      examBufferMinutes: number;
    }>;

    // Filter to low-risk / recommend + optional trains (safety-constrained set)
    const safeTrains = trains.filter(
      (t) => t.riskLevel === "low" && t.decision !== "not_recommended",
    );

    // Among safe trains, cheaper ones should score higher than expensive ones
    if (safeTrains.length >= 2) {
      const sortedByPrice = [...safeTrains].sort((a, b) => a.price - b.price);
      const cheapest = sortedByPrice[0]!;
      const priciest = sortedByPrice[sortedByPrice.length - 1]!;
      // Cheapest safe train should outscore most expensive safe train
      expect(cheapest.score).toBeGreaterThan(priciest.score);
    }
  });

  it("price_sensitive: cheapest train with tight buffer is NOT recommend", async () => {
    // K1012 arrives 08:00, +30min = 08:30, exam at 09:00 → buffer = 30min (< 60)
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        preference: "price_sensitive",
        firstExamAt: "2026-06-27T09:00:00+08:00",
        stationToSchoolMinutes: { "烟台站": 30, "烟台南站": 30 },
      }),
    });

    const body = await res.json();
    const k1012 = body.trains.find(
      (t: { trainNumber: string }) => t.trainNumber === "K1012",
    );

    expect(k1012).toBeDefined();
    // High risk + tight buffer → should not be recommend
    expect(k1012.decision).not.toBe("recommend");
    // Reasons should mention both low price and tight buffer
    const reasons: string[] = k1012.reasons;
    const hasPriceReason = reasons.some((r) => r.includes("价格较低") || r.includes("票价"));
    const hasBufferReason = reasons.some((r) => r.includes("缓冲"));
    expect(hasPriceReason).toBe(true);
    expect(hasBufferReason).toBe(true);
    // Should NOT outrank low-risk recommended trains
    const recommended = body.trains.filter(
      (t: { decision: string }) => t.decision === "recommend",
    );
    if (recommended.length > 0) {
      const worstRecommended = recommended[recommended.length - 1];
      expect(k1012.score).toBeLessThan(worstRecommended.score);
    }
  });

  it("fastest trains scored highest under time_sensitive (acceptance criterion)", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, preference: "time_sensitive" }),
    });

    const body = await res.json();
    const gTrain = body.trains.find((t: { trainType: string }) => t.trainType === "G");
    const kTrain = body.trains.find((t: { trainType: string }) => t.trainType === "K");

    // Under time_sensitive, G trains should outscore K trains
    if (gTrain && kTrain) {
      expect(gTrain.score).toBeGreaterThan(kTrain.score);
    }
  });

  it("G/D trains show '舒适' badge, K trains show '艰苦' badge (acceptance criterion)", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const body = await res.json();
    for (const t of body.trains) {
      if (t.trainType === "G" || t.trainType === "D") {
        expect(t.comfortLevel).toBe("comfortable");
      } else if (t.trainType === "K") {
        expect(t.comfortLevel).toBe("uncomfortable");
      }
    }
  });

  it("top-scored train has 'recommend' decision", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const body = await res.json();
    if (body.trains.length > 0) {
      const top = body.trains[0];
      expect(top.decision).toBe("recommend");
    }
  });

  // --- Empty result case (acceptance criterion) ---

  it("returns empty result for unknown cities", async () => {
    // For unknown cities, we validate and return error before searching
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        destinationCity: "火星",
      }),
    });

    expect(res.status).toBe(400);
  });

  it("returns empty trains array if no stations match (city known but no trains)", async () => {
    // Shanghai → Shanghai (same city) — no trains in mock data for this route
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        departureCity: "烟台",
        destinationCity: "上海",
      }),
    });

    // Should return empty list, not crash
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.trains).toEqual([]);
  });

  // --- Validation errors (acceptance criterion: no crash on invalid input) ---

  it("returns 400 for missing departureCity", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, departureCity: "" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 for missing preference", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, preference: "" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid preference value", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, preference: "cheapest" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown departure city", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, departureCity: "北京" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing companyToStationMinutes", async () => {
    const { companyToStationMinutes, ...withoutField } = validBody;
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withoutField),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for negative companyToStationMinutes", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, companyToStationMinutes: -5 }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing stationToSchoolMinutes", async () => {
    const { stationToSchoolMinutes, ...withoutField } = validBody;
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withoutField),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for non-object body", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["not", "an", "object"]),
    });

    expect(res.status).toBe(400);
  });

  // --- P1 fix: Invalid firstExamAt returns 400, not 500 ---

  it("returns 400 for invalid firstExamAt (not 500)", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, firstExamAt: "not-a-date" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("firstExamAt");
  });

  it("returns 400 for pseudo-legal firstExamAt (2026-02-31) on train/search", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, firstExamAt: "2026-02-31T09:00:00+08:00" }),
    });

    expect(res.status).toBe(400);
  });

  // --- P2 fix: departDate filtering ---

  it("returns 0 trains for far-future departDate", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, departDate: "2099-01-01" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.trains).toEqual([]);
  });

  it("returns 400 for invalid departDate format", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, departDate: "06-26-2026" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("departDate");
  });

  it("returns 400 for invalid clockOutTime format", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, clockOutTime: "25:00" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    // The error comes from calculateSafeDepartureTime's range check
    // or from the HH:mm format validator — both return 400
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  // --- P1 fix: Cross-midnight safe departure ---

  it("penalizes all evening trains when safe departure crosses midnight", async () => {
    // 23:00 clockOut + 60min commute + 30 entry + 15 risk = 00:45 next day
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        clockOutTime: "23:00",
        companyToStationMinutes: 60,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.safeDepartureTime).toBe("00:45");

    // All trains should be penalized (they all depart on Jun 26, which is before 00:45 Jun 27)
    // So no train should be "recommend"
    const recommended = body.trains.filter(
      (t: { decision: string }) => t.decision === "recommend",
    );
    expect(recommended.length).toBe(0);
  });

  // --- Station expansion ---

  it("expands departure city to all known stations (acceptance criterion)", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const body = await res.json();
    // Trains should come from all three Shanghai stations
    const stations = new Set(
      body.trains.map((t: { departureStation: string }) => t.departureStation),
    );
    // We expect at least 2 different departure stations from the mock data
    expect(stations.size).toBeGreaterThanOrEqual(2);
    expect(stations.has("上海虹桥") || stations.has("上海站") || stations.has("上海南站")).toBe(true);
  });

  it("expands destination city to all known stations", async () => {
    const res = await app.request("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const body = await res.json();
    const stations = new Set(
      body.trains.map((t: { arrivalStation: string }) => t.arrivalStation),
    );
    expect(stations.has("烟台站") || stations.has("烟台南站")).toBe(true);
  });
});

// Also test that the health endpoint still works
describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
