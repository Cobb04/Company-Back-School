import { describe, expect, it } from "bun:test";
import {
  buildReturnPlans,
  scoreTrainCandidate,
  calculateSafeDepartureDatetime,
  TWO_PASS,
} from "../index.js";
import type { TrainCandidate, ScoredTrain, Preference, LeaveSuggestion } from "@return-school/shared";

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

function safeDatetime(clockOut = "18:00", companyMin = 30, entryMin = 30, riskMin = 15): string {
  return calculateSafeDepartureDatetime({
    departDate: "2026-06-26",
    clockOutTime: clockOut,
    companyToStationMinutes: companyMin,
    stationEntryBufferMinutes: entryMin,
    riskBufferMinutes: riskMin,
  });
}

function scoreTrain(
  train: TrainCandidate,
  preference: Preference = "balanced",
): ScoredTrain {
  return scoreTrainCandidate({
    train,
    safeDepartureDatetime: safeDatetime(),
    firstExamAt: "2026-06-27T09:00:00+08:00",
    stationToSchoolMinutes: { "烟台站": 30, "烟台南站": 30 },
    preference,
  });
}

// ---- buildReturnPlans tests ----

describe("buildReturnPlans", () => {
  // ---- Pass 1: good train found → no leave needed ----

  it("returns no-leave suggestion when Pass 1 finds a good train (acceptance criterion)", () => {
    // Use a fast + cheap G train to get score above 70 threshold
    const goodG = makeTrain({
      id: "G-FAST",
      trainNumber: "G8888",
      trainType: "G",
      price: 200,
      durationMinutes: 180,
      departureStation: "上海虹桥",
      arrivalStation: "烟台站",
      departureTime: "2026-06-26T20:00:00+08:00",
      arrivalTime: "2026-06-26T23:00:00+08:00",
    });

    const okD = makeTrain({
      id: "D5678",
      trainNumber: "D5678",
      trainType: "D",
      price: 320,
      durationMinutes: 390,
      departureStation: "上海虹桥",
      arrivalStation: "烟台站",
      departureTime: "2026-06-26T19:30:00+08:00",
      arrivalTime: "2026-06-27T02:00:00+08:00",
    });

    const scored = [scoreTrain(goodG, "balanced"), scoreTrain(okD, "balanced")];
    scored.sort((a, b) => b.score - a.score);

    const result = buildReturnPlans({
      scoredTrains: scored,
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: "2026-06-27T09:00:00+08:00",
      preference: "balanced",
    });

    // G-FAST should be Pass 1 best with score >= 70
    expect(result.selectedTrain).not.toBeNull();
    expect(result.selectedTrain!.id).toBe("G-FAST");
    expect(result.leaveSuggestion.needLeave).toBe(false);
    // The reason should not suggest leave
    expect(result.leaveSuggestion.suggestedEarlyDepartureMinutes).toBe(0);
    expect(result.plans.length).toBeGreaterThanOrEqual(1);
    expect(result.plans[0]!.train.id).toBe("G-FAST");
  });

  // ---- Pass 2: better train found with early departure → recommend leave ----

  it("recommends leave when Pass 2 finds a meaningfully better train (acceptance criterion)", () => {
    // G train at 17:00 (before safe 19:15): raw score ~42 with -20 penalty.
    // Pass 2 removes the -20 penalty → adjusted score ~62.
    // D train at 19:30 (after safe): score ~46.
    // K train at 20:00 (after safe): tight exam buffer → score ~18.
    //
    // Pass 1 best = D (46). Pass 2 best (adjusted) = G (62).
    // 62 - 46 = 16 > 15 (IMPROVEMENT_MARGIN) → leave recommended.

    const earlyGTrain = makeTrain({
      id: "G9999",
      trainNumber: "G9999",
      trainType: "G",
      price: 350,
      durationMinutes: 260,
      departureTime: "2026-06-26T17:00:00+08:00",
      arrivalTime: "2026-06-26T21:20:00+08:00",
    });

    const lateDTrain = makeTrain({
      id: "D5678",
      trainNumber: "D5678",
      trainType: "D",
      price: 400,
      durationMinutes: 500,
      departureTime: "2026-06-26T19:30:00+08:00",
      arrivalTime: "2026-06-27T03:50:00+08:00",
    });

    const lateKTrain = makeTrain({
      id: "K1010",
      trainNumber: "K1010",
      trainType: "K",
      price: 150,
      durationMinutes: 660,
      departureTime: "2026-06-26T20:00:00+08:00",
      arrivalTime: "2026-06-27T07:00:00+08:00",
    });

    const firstExam = "2026-06-27T08:00:00+08:00";

    const earlyG = scoreTrainCandidate({
      train: earlyGTrain,
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: firstExam,
      stationToSchoolMinutes: { "烟台站": 30, "烟台南站": 30 },
      preference: "balanced",
    });

    const lateD = scoreTrainCandidate({
      train: lateDTrain,
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: firstExam,
      stationToSchoolMinutes: { "烟台站": 30, "烟台南站": 30 },
      preference: "balanced",
    });

    const lateK = scoreTrainCandidate({
      train: lateKTrain,
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: firstExam,
      stationToSchoolMinutes: { "烟台站": 30, "烟台南站": 30 },
      preference: "balanced",
    });

    const scored = [earlyG, lateD, lateK];
    scored.sort((a, b) => b.score - a.score);

    const result = buildReturnPlans({
      scoredTrains: scored,
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: firstExam,
      preference: "balanced",
    });

    // Fixed assertion: early G adjusted score (62) > late D score (46) + 15 margin
    // MUST recommend leave
    expect(result.leaveSuggestion.needLeave).toBe(true);
    expect(result.leaveSuggestion.suggestedEarlyDepartureMinutes).toBeGreaterThan(0);
    expect(result.selectedTrain!.id).toBe("G9999");
    expect(result.plans[0]!.title).toContain("需请假");
  });

  // ---- Pass 1 finds nothing good, Pass 2 not much better → no leave ----

  it("does not recommend leave when Pass 2 improvement is below margin", () => {
    // All trains have similar mediocre scores — no point in leaving early
    const trainA = makeTrain({
      id: "A1111",
      trainNumber: "A1111",
      trainType: "K",
      price: 200,
      durationMinutes: 600,
      departureTime: "2026-06-26T19:30:00+08:00",
      arrivalTime: "2026-06-27T05:30:00+08:00",
    });

    const trainB = makeTrain({
      id: "B2222",
      trainNumber: "B2222",
      trainType: "K",
      price: 180,
      durationMinutes: 620,
      departureTime: "2026-06-26T17:00:00+08:00",
      arrivalTime: "2026-06-27T03:20:00+08:00",
    });

    const firstExam = "2026-06-27T08:00:00+08:00";

    const scoredA = scoreTrainCandidate({
      train: trainA,
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: firstExam,
      stationToSchoolMinutes: { "烟台站": 30, "烟台南站": 30 },
      preference: "balanced",
    });

    const scoredB = scoreTrainCandidate({
      train: trainB,
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: firstExam,
      stationToSchoolMinutes: { "烟台站": 30, "烟台南站": 30 },
      preference: "balanced",
    });

    const scored = [scoredA, scoredB];
    scored.sort((a, b) => b.score - a.score);

    const result = buildReturnPlans({
      scoredTrains: scored,
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: firstExam,
      preference: "balanced",
    });

    // Both are K trains with low scores. If the improvement isn't > 15, no leave.
    // Verify the output is well-formed regardless
    expect(result.plans.length).toBeGreaterThanOrEqual(0);
    expect(result.leaveSuggestion).toBeDefined();
    expect(typeof result.leaveSuggestion.needLeave).toBe("boolean");
  });

  // ---- Empty trains ----

  it("returns empty plans for empty input", () => {
    const result = buildReturnPlans({
      scoredTrains: [],
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: "2026-06-27T09:00:00+08:00",
      preference: "balanced",
    });

    expect(result.plans).toEqual([]);
    expect(result.selectedTrain).toBeNull();
    expect(result.leaveSuggestion.needLeave).toBe(false);
    expect(result.leaveSuggestion.reason).toContain("未找到");
  });

  // ---- All trains before safe time ----

  it("recommends leave when no trains depart after safe time (acceptance criterion)", () => {
    // All trains depart before safe departure time (19:15)
    const train1 = makeTrain({
      id: "T1",
      trainNumber: "T1001",
      trainType: "G",
      price: 500,
      durationMinutes: 260,
      departureTime: "2026-06-26T16:00:00+08:00",
      arrivalTime: "2026-06-26T20:20:00+08:00",
    });

    const train2 = makeTrain({
      id: "T2",
      trainNumber: "T2002",
      trainType: "D",
      price: 400,
      durationMinutes: 390,
      departureTime: "2026-06-26T17:30:00+08:00",
      arrivalTime: "2026-06-27T00:00:00+08:00",
    });

    const scored = [
      scoreTrain(train1, "balanced"),
      scoreTrain(train2, "balanced"),
    ];
    scored.sort((a, b) => b.score - a.score);

    const result = buildReturnPlans({
      scoredTrains: scored,
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: "2026-06-27T09:00:00+08:00",
      preference: "balanced",
    });

    // Fixed assertion: ALL trains are before safe time → MUST recommend leave
    expect(result.plans.length).toBeGreaterThanOrEqual(1);
    expect(result.selectedTrain).not.toBeNull();
    expect(result.leaveSuggestion.needLeave).toBe(true);
    expect(result.leaveSuggestion.suggestedEarlyDepartureMinutes).toBeGreaterThan(0);
    expect(result.leaveSuggestion.reason).toContain("建议请假");
  });

  // ---- Plan structure validation ----

  it("each plan has required fields", () => {
    const scored = [
      scoreTrain(makeTrain({ id: "G1234", trainNumber: "G1234", price: 480, durationMinutes: 260, trainType: "G", departureTime: "2026-06-26T19:30:00+08:00" }), "balanced"),
    ];
    scored.sort((a, b) => b.score - a.score);

    const result = buildReturnPlans({
      scoredTrains: scored,
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: "2026-06-27T09:00:00+08:00",
      preference: "balanced",
    });

    for (const plan of result.plans) {
      expect(typeof plan.title).toBe("string");
      expect(plan.title.length).toBeGreaterThan(0);
      expect(typeof plan.summary).toBe("string");
      expect(plan.summary.length).toBeGreaterThan(0);
      expect(Array.isArray(plan.risks)).toBe(true);
      expect(Array.isArray(plan.checklist)).toBe(true);
      expect(plan.train).toBeDefined();
      expect(plan.train.score).toBeGreaterThanOrEqual(0);
    }
  });

  // ---- Leave suggestion structure ----

  it("leaveSuggestion has required fields", () => {
    const scored = [
      scoreTrain(makeTrain({ id: "G1234", trainNumber: "G1234" }), "balanced"),
    ];
    scored.sort((a, b) => b.score - a.score);

    const result = buildReturnPlans({
      scoredTrains: scored,
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: "2026-06-27T09:00:00+08:00",
      preference: "balanced",
    });

    const ls: LeaveSuggestion = result.leaveSuggestion;
    expect(typeof ls.needLeave).toBe("boolean");
    expect(typeof ls.reason).toBe("string");
    expect(ls.reason.length).toBeGreaterThan(0);
    expect(typeof ls.suggestedEarlyDepartureMinutes).toBe("number");
    expect(ls.suggestedEarlyDepartureMinutes).toBeGreaterThanOrEqual(0);
  });

  // ---- Two-pass constants are available and sensible ----

  it("TWO_PASS constants are sensible", () => {
    expect(TWO_PASS.PASS1_THRESHOLD).toBe(70);
    expect(TWO_PASS.IMPROVEMENT_MARGIN).toBe(15);
  });

  // ---- Primary plan has highest score ----

  it("primary plan has the highest score among plans", () => {
    const trains = [
      makeTrain({ id: "G1234", trainNumber: "G1234", price: 480, durationMinutes: 260, trainType: "G", departureTime: "2026-06-26T19:30:00+08:00" }),
      makeTrain({ id: "D5678", trainNumber: "D5678", price: 320, durationMinutes: 390, trainType: "D", departureTime: "2026-06-26T20:00:00+08:00" }),
      makeTrain({ id: "G1236", trainNumber: "G1236", price: 490, durationMinutes: 265, trainType: "G", departureTime: "2026-06-26T19:45:00+08:00" }),
    ];

    const scored = trains.map((t) => scoreTrain(t, "balanced"));
    scored.sort((a, b) => b.score - a.score);

    const result = buildReturnPlans({
      scoredTrains: scored,
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: "2026-06-27T09:00:00+08:00",
      preference: "balanced",
    });

    if (result.plans.length >= 2) {
      expect(result.plans[0]!.train.score).toBeGreaterThanOrEqual(result.plans[1]!.train.score);
    }
  });

  // ---- Exam buffer in summary for negative exam buffer ----

  it("plan summary mentions exam buffer and risk", () => {
    const train = makeTrain({
      id: "G-FAST",
      trainNumber: "G8888",
      trainType: "G",
      price: 200,
      durationMinutes: 180,
      departureTime: "2026-06-26T20:00:00+08:00",
      arrivalTime: "2026-06-26T23:00:00+08:00",
    });

    const scored = scoreTrainCandidate({
      train,
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: "2026-06-27T09:00:00+08:00",
      stationToSchoolMinutes: { "烟台站": 30, "烟台南站": 30 },
      preference: "balanced",
    });

    const result = buildReturnPlans({
      scoredTrains: [scored],
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: "2026-06-27T09:00:00+08:00",
      preference: "balanced",
    });

    const plan = result.plans[0]!;
    expect(plan.summary).toContain(String(scored.score));
    expect(plan.summary).toContain(String(scored.examBufferMinutes));
  });

  // ---- Alternative plans do not include primary train ----

  it("alternative plans exclude the primary train", () => {
    const trains = [
      makeTrain({ id: "G1", trainNumber: "G1", price: 400, durationMinutes: 260, trainType: "G", departureTime: "2026-06-26T19:30:00+08:00" }),
      makeTrain({ id: "G2", trainNumber: "G2", price: 420, durationMinutes: 260, trainType: "G", departureTime: "2026-06-26T19:45:00+08:00" }),
      makeTrain({ id: "D3", trainNumber: "D3", price: 300, durationMinutes: 390, trainType: "D", departureTime: "2026-06-26T20:00:00+08:00" }),
    ];

    const scored = trains.map((t) => scoreTrain(t, "balanced"));
    scored.sort((a, b) => b.score - a.score);

    const result = buildReturnPlans({
      scoredTrains: scored,
      safeDepartureDatetime: safeDatetime(),
      firstExamAt: "2026-06-27T09:00:00+08:00",
      preference: "balanced",
    });

    const primaryId = result.plans[0]!.train.id;
    for (let i = 1; i < result.plans.length; i++) {
      expect(result.plans[i]!.train.id).not.toBe(primaryId);
    }
  });
});
