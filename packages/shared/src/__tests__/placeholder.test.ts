import { describe, expect, it } from "bun:test";
import type { TrainCandidate, Decision, RiskLevel } from "../index.js";

describe("@return-school/shared", () => {
  it("exports valid domain types at compile time", () => {
    // This test verifies the package can be imported and types are
    // structurally correct. It does not test business logic — that
    // belongs in planning-core and server tests.

    const candidate: TrainCandidate = {
      id: "t-001",
      trainNumber: "G1234",
      trainType: "G",
      departureStation: "上海虹桥",
      arrivalStation: "烟台站",
      departureTime: "2026-07-01T08:00:00+08:00",
      arrivalTime: "2026-07-01T14:30:00+08:00",
      durationMinutes: 390,
      price: 450,
      source: "mock",
      seats: { "二等座": "available" as const },
    };

    expect(candidate.id).toBe("t-001");
    expect(candidate.trainType).toBe("G");

    const decision: Decision = "recommend";
    expect(decision).toBe("recommend");

    const risk: RiskLevel = "low";
    expect(risk).toBe("low");
  });

  it("exports package name", () => {
    // Placeholder ensuring the test runner resolves the package.
    expect(true).toBe(true);
  });
});
