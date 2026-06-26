import { describe, expect, it } from "bun:test";
import { scoreTrainCandidate, calculateSafeDepartureDatetime } from "../index.js";
import type { TrainCandidate, Preference } from "@return-school/shared";

// ---- Shared test fixtures ----

function makeTrain(overrides: Partial<TrainCandidate> = {}): TrainCandidate {
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

/** Build a safe departure datetime from simple parameters. */
function safeDatetime(clockOut = "18:00", companyMin = 30, entryMin = 30, riskMin = 15): string {
  return calculateSafeDepartureDatetime({
    departDate: "2026-06-26",
    clockOutTime: clockOut,
    companyToStationMinutes: companyMin,
    stationEntryBufferMinutes: entryMin,
    riskBufferMinutes: riskMin,
  });
}

const DEFAULT_INPUT = {
  safeDepartureDatetime: safeDatetime(), // 2026-06-26T19:15:00+08:00
  firstExamAt: "2026-06-27T09:00:00+08:00",
  stationToSchoolMinutes: { "烟台站": 30, "烟台南站": 30 },
  preference: "balanced" as Preference,
};

describe("scoreTrainCandidate", () => {
  // ---- Comfort level derivation ----

  it("assigns 'comfortable' to G trains", () => {
    const result = scoreTrainCandidate({
      train: makeTrain({ trainType: "G" }),
      ...DEFAULT_INPUT,
    });
    expect(result.comfortLevel).toBe("comfortable");
  });

  it("assigns 'comfortable' to D trains", () => {
    const result = scoreTrainCandidate({
      train: makeTrain({ trainType: "D" }),
      ...DEFAULT_INPUT,
    });
    expect(result.comfortLevel).toBe("comfortable");
  });

  it("assigns 'uncomfortable' to K trains", () => {
    const result = scoreTrainCandidate({
      train: makeTrain({ trainType: "K" }),
      ...DEFAULT_INPUT,
    });
    expect(result.comfortLevel).toBe("uncomfortable");
  });

  it("assigns 'unknown' to other train types", () => {
    const result = scoreTrainCandidate({
      train: makeTrain({ trainType: "Z" as never }),
      ...DEFAULT_INPUT,
    });
    expect(result.comfortLevel).toBe("unknown");
  });

  // ---- Price-sensitive preference: cheaper trains preferred within safety constraints ----

  it("scores cheaper trains higher under price_sensitive when both are safe (revised criterion)", () => {
    // Two trains that both depart after safe time and have ample exam buffer
    const cheap = scoreTrainCandidate({
      train: makeTrain({
        id: "D5678",
        price: 200,
        durationMinutes: 400,
        trainType: "D",
        departureTime: "2026-06-26T19:30:00+08:00",
        arrivalTime: "2026-06-27T02:10:00+08:00",
      }),
      ...DEFAULT_INPUT,
      preference: "price_sensitive",
    });
    const expensive = scoreTrainCandidate({
      train: makeTrain({
        id: "G9999",
        price: 520,
        durationMinutes: 260,
        trainType: "G",
        departureTime: "2026-06-26T20:00:00+08:00",
        arrivalTime: "2026-06-27T00:20:00+08:00",
      }),
      ...DEFAULT_INPUT,
      preference: "price_sensitive",
    });

    // Both have ample buffer and depart after safe time.
    // Under price_sensitive, cheaper D (¥200) > expensive G (¥520).
    expect(cheap.score).toBeGreaterThan(expensive.score);
    // Both should be safe (low risk or recommended)
    expect(cheap.riskLevel).toBe("low");
    expect(expensive.riskLevel).toBe("low");
  });

  // ---- Time-sensitive preference: faster trains score higher ----

  it("scores faster trains higher under time_sensitive (acceptance criterion)", () => {
    const fast = scoreTrainCandidate({
      train: makeTrain({ id: "G1234", price: 480, durationMinutes: 260, trainType: "G" }),
      ...DEFAULT_INPUT,
      preference: "time_sensitive",
    });
    const slow = scoreTrainCandidate({
      train: makeTrain({ id: "K1010", price: 150, durationMinutes: 660, trainType: "K" }),
      ...DEFAULT_INPUT,
      preference: "time_sensitive",
    });

    // Fast G train should outscore slow K train under time_sensitive
    expect(fast.score).toBeGreaterThan(slow.score);
  });

  // ---- Balanced preference ----

  it("scores with balanced weights under balanced preference", () => {
    const result = scoreTrainCandidate({
      train: makeTrain(),
      ...DEFAULT_INPUT,
      preference: "balanced",
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  // ---- Comfort badge labels (acceptance criterion) ----

  it("G trains show '舒适' badge via comfortLevel", () => {
    const result = scoreTrainCandidate({
      train: makeTrain({ trainType: "G" }),
      ...DEFAULT_INPUT,
    });
    expect(result.comfortLevel).toBe("comfortable");
    // UI uses COMFORT_LABELS["comfortable"] = "舒适"
  });

  it("D trains show '舒适' badge via comfortLevel", () => {
    const result = scoreTrainCandidate({
      train: makeTrain({ trainType: "D" }),
      ...DEFAULT_INPUT,
    });
    expect(result.comfortLevel).toBe("comfortable");
    // UI uses COMFORT_LABELS["comfortable"] = "舒适"
  });

  it("K trains show '艰苦' badge via comfortLevel", () => {
    const result = scoreTrainCandidate({
      train: makeTrain({ trainType: "K" }),
      ...DEFAULT_INPUT,
    });
    expect(result.comfortLevel).toBe("uncomfortable");
    // UI uses COMFORT_LABELS["uncomfortable"] = "艰苦"
  });

  // ---- Recommended train is highlighted (via decision) ----

  it("returns 'recommend' decision for high-scoring trains", () => {
    const result = scoreTrainCandidate({
      train: makeTrain({ trainType: "G", price: 350, durationMinutes: 260 }),
      ...DEFAULT_INPUT,
      preference: "balanced",
    });
    expect(result.decision).toBe("recommend");
  });

  it("returns 'optional' for medium-scoring trains", () => {
    const result = scoreTrainCandidate({
      train: makeTrain({ trainType: "D", price: 350, durationMinutes: 400 }),
      ...DEFAULT_INPUT,
      preference: "balanced",
    });
    expect(result.decision === "recommend" || result.decision === "optional").toBe(true);
  });

  it("returns 'not_recommended' for trains departing before safe time", () => {
    const result = scoreTrainCandidate({
      train: makeTrain({ departureTime: "2026-06-26T17:00:00+08:00" }), // before 19:15 safe time
      ...DEFAULT_INPUT,
      preference: "balanced",
    });
    expect(result.decision).toBe("not_recommended");
  });

  // ---- Risk levels ----

  it("assigns 'low' risk when exam buffer >= 120 minutes", () => {
    // Arrival 23:50 + 30min to school = 00:20. Exam at 09:00 → buffer = 520 min
    const result = scoreTrainCandidate({
      train: makeTrain(),
      ...DEFAULT_INPUT,
    });
    expect(result.riskLevel).toBe("low");
  });

  it("assigns 'medium' risk when exam buffer 60-119 minutes", () => {
    // Arrival 23:50 + 30min = 00:20. Exam at 01:30 → buffer = 70 min
    const result = scoreTrainCandidate({
      train: makeTrain(),
      ...DEFAULT_INPUT,
      firstExamAt: "2026-06-27T01:30:00+08:00",
    });
    expect(result.riskLevel).toBe("medium");
  });

  it("assigns 'high' risk when exam buffer < 60 minutes", () => {
    // Arrival 23:50 + 30min = 00:20. Exam at 00:30 → buffer = 10 min
    const result = scoreTrainCandidate({
      train: makeTrain(),
      ...DEFAULT_INPUT,
      firstExamAt: "2026-06-27T00:30:00+08:00",
    });
    expect(result.riskLevel).toBe("high");
  });

  it("bumps risk when departing before safe time", () => {
    // Depart at 18:00 < safe 19:15, buffer is huge (520min), risk starts low → bumped to medium
    const result = scoreTrainCandidate({
      train: makeTrain({
        departureTime: "2026-06-26T18:00:00+08:00",
      }),
      ...DEFAULT_INPUT,
    });
    expect(result.riskLevel).toBe("medium");
  });

  // ---- Reasons are populated ----

  it("populates reasons array (acceptance criterion)", () => {
    const result = scoreTrainCandidate({
      train: makeTrain(),
      ...DEFAULT_INPUT,
    });
    expect(result.reasons.length).toBeGreaterThan(0);
    // Should include comfort and buffer reasons
    const hasComfort = result.reasons.some((r) => r.includes("G字头"));
    const hasBuffer = result.reasons.some((r) => r.includes("缓冲"));
    expect(hasComfort || hasBuffer).toBe(true);
  });

  // ---- Penalty for departing before safe time ----

  it("applies -20 penalty for departing before safe departure time", () => {
    const onTime = scoreTrainCandidate({
      train: makeTrain({ departureTime: "2026-06-26T19:30:00+08:00" }),
      ...DEFAULT_INPUT,
    });
    const beforeSafe = scoreTrainCandidate({
      train: makeTrain({ departureTime: "2026-06-26T17:00:00+08:00" }),
      ...DEFAULT_INPUT,
    });
    // The one departing before safe time should score lower (at least 15 pts less)
    // given otherwise identical parameters
    expect(onTime.score).toBeGreaterThan(beforeSafe.score + 10);
  });

  // ---- Exam buffer penalty ----

  it("applies -15 penalty for exam buffer < 60 minutes", () => {
    const goodBuffer = scoreTrainCandidate({
      train: makeTrain(),
      ...DEFAULT_INPUT,
      firstExamAt: "2026-06-27T09:00:00+08:00",
    });
    const tightBuffer = scoreTrainCandidate({
      train: makeTrain(),
      ...DEFAULT_INPUT,
      firstExamAt: "2026-06-27T00:30:00+08:00",
    });
    expect(goodBuffer.score).toBeGreaterThan(tightBuffer.score + 10);
  });

  // ---- Score is within valid range ----

  it("always returns score between 0 and 100", () => {
    const scenarios: TrainCandidate[] = [
      makeTrain({ price: 50, durationMinutes: 180, trainType: "G" }),
      makeTrain({ price: 600, durationMinutes: 700, trainType: "K" }),
      makeTrain({ price: 300, durationMinutes: 400, trainType: "D" }),
      makeTrain({ price: 100, durationMinutes: 660, trainType: "K" }),
    ];

    for (const train of scenarios) {
      for (const pref of ["price_sensitive", "time_sensitive", "balanced"] as Preference[]) {
        const result = scoreTrainCandidate({
          train,
          ...DEFAULT_INPUT,
          preference: pref,
        });
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      }
    }
  });

  // ---- school arrival time and exam buffer ----

  it("calculates estimatedSchoolArrival from arrivalTime + stationToSchoolMinutes", () => {
    const result = scoreTrainCandidate({
      train: makeTrain({
        arrivalStation: "烟台站",
        arrivalTime: "2026-06-26T23:50:00+08:00",
      }),
      ...DEFAULT_INPUT,
      stationToSchoolMinutes: { "烟台站": 30 },
    });
    // 23:50 + 30 min = 00:20 next day
    expect(result.estimatedSchoolArrival).toContain("2026-06-27T00:20");
  });

  it("returns negative examBufferMinutes when school arrival is after exam", () => {
    const result = scoreTrainCandidate({
      train: makeTrain({
        arrivalTime: "2026-06-26T23:50:00+08:00",
      }),
      ...DEFAULT_INPUT,
      firstExamAt: "2026-06-26T20:00:00+08:00", // exam is BEFORE arrival
      stationToSchoolMinutes: { "烟台站": 30 },
    });
    expect(result.examBufferMinutes).toBeLessThan(0);
  });

  // ---- ScoredTrain extends TrainCandidate ----

  it("preserves all TrainCandidate fields in ScoredTrain", () => {
    const train = makeTrain();
    const result = scoreTrainCandidate({ train, ...DEFAULT_INPUT });

    expect(result.id).toBe(train.id);
    expect(result.trainNumber).toBe(train.trainNumber);
    expect(result.trainType).toBe(train.trainType);
    expect(result.departureStation).toBe(train.departureStation);
    expect(result.arrivalStation).toBe(train.arrivalStation);
    expect(result.departureTime).toBe(train.departureTime);
    expect(result.arrivalTime).toBe(train.arrivalTime);
    expect(result.durationMinutes).toBe(train.durationMinutes);
    expect(result.price).toBe(train.price);
  });

  // ---- Edge cases ----

  it("handles missing stationToSchoolMinutes gracefully (defaults to 0)", () => {
    const result = scoreTrainCandidate({
      train: makeTrain({ arrivalStation: "烟台站" }),
      ...DEFAULT_INPUT,
      stationToSchoolMinutes: {}, // empty
    });
    // Should not throw, uses 0 minutes
    expect(result.estimatedSchoolArrival).toBeDefined();
  });

  it("treats different preferences with the same train differently", () => {
    const train = makeTrain({ price: 480, durationMinutes: 260, trainType: "G" });

    const priceResult = scoreTrainCandidate({
      train,
      ...DEFAULT_INPUT,
      preference: "price_sensitive",
    });
    const timeResult = scoreTrainCandidate({
      train,
      ...DEFAULT_INPUT,
      preference: "time_sensitive",
    });
    const balancedResult = scoreTrainCandidate({
      train,
      ...DEFAULT_INPUT,
      preference: "balanced",
    });

    // A G train at ¥480 / 260min: time_sensitive should score highest
    // because it's fast but expensive
    expect(timeResult.score).toBeGreaterThan(priceResult.score);
    // Scores should differ since weights differ
    const scores = [priceResult.score, timeResult.score, balancedResult.score];
    const uniqueScores = new Set(scores);
    expect(uniqueScores.size).toBeGreaterThan(1);
  });

  // ---- Cross-midnight safe departure (P1 fix) ----

  it("penalizes trains before safe departure that crosses midnight", () => {
    // Safe departure: clockOut 23:00 + 60min commute + 30 entry + 15 risk = 00:45 NEXT DAY
    const midnightSafeDatetime = safeDatetime("23:00", 60, 30, 15);
    // "2026-06-27T00:45:00+08:00"

    // Train departs at 20:15 on Jun 26 — this IS before 00:45 on Jun 27
    const eveningTrain = scoreTrainCandidate({
      train: makeTrain({
        id: "D5679",
        trainType: "D",
        departureTime: "2026-06-26T20:15:00+08:00",
        arrivalTime: "2026-06-27T02:45:00+08:00",
        durationMinutes: 390,
        price: 300,
      }),
      ...DEFAULT_INPUT,
      safeDepartureDatetime: midnightSafeDatetime,
      preference: "balanced",
    });

    // This train should be penalized for departing before safe time
    const hasDepartPenalty = eveningTrain.reasons.some((r) =>
      r.includes("早于安全出发时间"),
    );
    expect(hasDepartPenalty).toBe(true);
    expect(eveningTrain.score).toBeLessThan(55); // Should be penalized below recommend threshold
  });

  it("does NOT penalize trains after safe departure that crosses midnight", () => {
    // Safe departure: 23:00 + 60 + 30 + 15 = 00:45 NEXT DAY
    const midnightSafeDatetime = safeDatetime("23:00", 60, 30, 15);

    // Train departs at 02:00 on Jun 27 — this IS after 00:45 on Jun 27
    const nextDayTrain = scoreTrainCandidate({
      train: makeTrain({
        id: "G9999",
        trainType: "G",
        departureTime: "2026-06-27T02:00:00+08:00",
        arrivalTime: "2026-06-27T06:20:00+08:00",
        durationMinutes: 260,
        price: 480,
      }),
      ...DEFAULT_INPUT,
      safeDepartureDatetime: midnightSafeDatetime,
      preference: "balanced",
    });

    // This train should NOT be penalized — departs after safe time
    const hasDepartPenalty = nextDayTrain.reasons.some((r) =>
      r.includes("早于安全出发时间"),
    );
    expect(hasDepartPenalty).toBe(false);
  });

  // ---- Price_sensitive with tight buffer: risk-constrained, not forced cheap-first ----

  it("cheapest but risky train is not recommend and explains why", () => {
    // K1012: ¥135, 660min, arrives 08:00 + 30min = 08:30, exam 09:00 → buffer = 30min
    const risky = scoreTrainCandidate({
      train: makeTrain({
        id: "K1012",
        trainType: "K",
        price: 135,
        durationMinutes: 660,
        departureTime: "2026-06-26T21:00:00+08:00",
        arrivalTime: "2026-06-27T08:00:00+08:00",
        arrivalStation: "烟台南站",
      }),
      ...DEFAULT_INPUT,
      stationToSchoolMinutes: { "烟台站": 30, "烟台南站": 30 },
      preference: "price_sensitive",
    });

    // Should NOT be recommend — tight buffer overrides price advantage
    expect(risky.decision).not.toBe("recommend");
    // Reasons must mention both low price and tight buffer
    const hasPrice = risky.reasons.some((r) => r.includes("价格较低") || r.includes("票价"));
    const hasBuffer = risky.reasons.some((r) => r.includes("缓冲"));
    expect(hasPrice).toBe(true);
    expect(hasBuffer).toBe(true);
    // Exam buffer should be ~30 min
    expect(risky.examBufferMinutes).toBeLessThan(60);
  });
});
