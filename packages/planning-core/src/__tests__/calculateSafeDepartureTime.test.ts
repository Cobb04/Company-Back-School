import { describe, expect, it } from "bun:test";
import { calculateSafeDepartureTime } from "../index.js";

describe("calculateSafeDepartureTime", () => {
  // --- Normal cases ---

  it("computes safe departure with default buffers (acceptance criterion)", () => {
    const result = calculateSafeDepartureTime({
      clockOutTime: "18:00",
      companyToStationMinutes: 30,
      stationEntryBufferMinutes: 30,
      riskBufferMinutes: 15,
    });

    // 18:00 + 30 + 30 + 15 = 19:15
    expect(result.safeDepartureTime).toBe("19:15");
  });

  it("computes safe departure with zero buffers", () => {
    const result = calculateSafeDepartureTime({
      clockOutTime: "18:00",
      companyToStationMinutes: 30,
      stationEntryBufferMinutes: 0,
      riskBufferMinutes: 0,
    });

    expect(result.safeDepartureTime).toBe("18:30");
  });

  it("computes safe departure with custom buffers", () => {
    const result = calculateSafeDepartureTime({
      clockOutTime: "17:30",
      companyToStationMinutes: 20,
      stationEntryBufferMinutes: 45,
      riskBufferMinutes: 10,
    });

    // 17:30 + 20 + 45 + 10 = 18:45
    expect(result.safeDepartureTime).toBe("18:45");
  });

  // --- Midnight crossing ---

  it("handles midnight crossing (acceptance criterion)", () => {
    const result = calculateSafeDepartureTime({
      clockOutTime: "23:00",
      companyToStationMinutes: 20,
      stationEntryBufferMinutes: 25,
      riskBufferMinutes: 15,
    });

    // 23:00 + 20 + 25 + 15 = 24:00 → 00:00
    expect(result.safeDepartureTime).toBe("00:00");
  });

  it("handles midnight crossing that wraps to early morning", () => {
    const result = calculateSafeDepartureTime({
      clockOutTime: "23:30",
      companyToStationMinutes: 30,
      stationEntryBufferMinutes: 30,
      riskBufferMinutes: 15,
    });

    // 23:30 + 75 = 24:45 → 00:45
    expect(result.safeDepartureTime).toBe("00:45");
  });

  it("handles midnight crossing with large buffers", () => {
    const result = calculateSafeDepartureTime({
      clockOutTime: "22:00",
      companyToStationMinutes: 60,
      stationEntryBufferMinutes: 60,
      riskBufferMinutes: 30,
    });

    // 22:00 + 150 = 24:30 → 00:30
    expect(result.safeDepartureTime).toBe("00:30");
  });

  it("wraps multiple days correctly", () => {
    const result = calculateSafeDepartureTime({
      clockOutTime: "12:00",
      companyToStationMinutes: 800,
      stationEntryBufferMinutes: 300,
      riskBufferMinutes: 400,
    });

    // 12:00 + 1500 = 37:00 → 2220 % 1440 = 780 → 13:00
    expect(result.safeDepartureTime).toBe("13:00");
  });

  // --- Edge cases ---

  it("handles 00:00 clock-out", () => {
    const result = calculateSafeDepartureTime({
      clockOutTime: "00:00",
      companyToStationMinutes: 15,
      stationEntryBufferMinutes: 0,
      riskBufferMinutes: 0,
    });

    expect(result.safeDepartureTime).toBe("00:15");
  });

  it("handles 23:59 clock-out", () => {
    const result = calculateSafeDepartureTime({
      clockOutTime: "23:59",
      companyToStationMinutes: 1,
      stationEntryBufferMinutes: 0,
      riskBufferMinutes: 0,
    });

    expect(result.safeDepartureTime).toBe("00:00");
  });

  it("handles zero minutes result", () => {
    const result = calculateSafeDepartureTime({
      clockOutTime: "00:00",
      companyToStationMinutes: 0,
      stationEntryBufferMinutes: 0,
      riskBufferMinutes: 0,
    });

    expect(result.safeDepartureTime).toBe("00:00");
  });

  // --- Validation errors ---

  it("throws on invalid time format (missing colon)", () => {
    expect(() =>
      calculateSafeDepartureTime({
        clockOutTime: "1800",
        companyToStationMinutes: 30,
        stationEntryBufferMinutes: 30,
        riskBufferMinutes: 15,
      }),
    ).toThrow('Invalid time format: "1800". Expected "HH:mm" in 24-hour format.');
  });

  it("throws on invalid time format (single digit hour)", () => {
    expect(() =>
      calculateSafeDepartureTime({
        clockOutTime: "8:00",
        companyToStationMinutes: 30,
        stationEntryBufferMinutes: 30,
        riskBufferMinutes: 15,
      }),
    ).toThrow('Invalid time format: "8:00". Expected "HH:mm" in 24-hour format.');
  });

  it("throws on out-of-range hours", () => {
    expect(() =>
      calculateSafeDepartureTime({
        clockOutTime: "25:00",
        companyToStationMinutes: 30,
        stationEntryBufferMinutes: 30,
        riskBufferMinutes: 15,
      }),
    ).toThrow('Invalid time value: "25:00". Hours must be 0–23, minutes 0–59.');
  });

  it("throws on out-of-range minutes", () => {
    expect(() =>
      calculateSafeDepartureTime({
        clockOutTime: "12:60",
        companyToStationMinutes: 30,
        stationEntryBufferMinutes: 30,
        riskBufferMinutes: 15,
      }),
    ).toThrow('Invalid time value: "12:60". Hours must be 0–23, minutes 0–59.');
  });

  it("throws on negative clock-out notation", () => {
    expect(() =>
      calculateSafeDepartureTime({
        clockOutTime: "-01:00",
        companyToStationMinutes: 30,
        stationEntryBufferMinutes: 30,
        riskBufferMinutes: 15,
      }),
    ).toThrow();
  });

  it("throws on non-numeric input", () => {
    expect(() =>
      calculateSafeDepartureTime({
        clockOutTime: "ab:cd",
        companyToStationMinutes: 30,
        stationEntryBufferMinutes: 30,
        riskBufferMinutes: 15,
      }),
    ).toThrow();
  });

  // --- Minute field validation ---

  it("throws on negative companyToStationMinutes", () => {
    expect(() =>
      calculateSafeDepartureTime({
        clockOutTime: "18:00",
        companyToStationMinutes: -30,
        stationEntryBufferMinutes: 30,
        riskBufferMinutes: 15,
      }),
    ).toThrow("companyToStationMinutes must be a non-negative integer");
  });

  it("throws on decimal companyToStationMinutes", () => {
    expect(() =>
      calculateSafeDepartureTime({
        clockOutTime: "18:00",
        companyToStationMinutes: 1.5,
        stationEntryBufferMinutes: 30,
        riskBufferMinutes: 15,
      }),
    ).toThrow("companyToStationMinutes must be a non-negative integer");
  });

  it("throws on negative stationEntryBufferMinutes", () => {
    expect(() =>
      calculateSafeDepartureTime({
        clockOutTime: "18:00",
        companyToStationMinutes: 30,
        stationEntryBufferMinutes: -5,
        riskBufferMinutes: 15,
      }),
    ).toThrow("stationEntryBufferMinutes must be a non-negative integer");
  });

  it("throws on negative riskBufferMinutes", () => {
    expect(() =>
      calculateSafeDepartureTime({
        clockOutTime: "18:00",
        companyToStationMinutes: 30,
        stationEntryBufferMinutes: 30,
        riskBufferMinutes: -10,
      }),
    ).toThrow("riskBufferMinutes must be a non-negative integer");
  });
});
