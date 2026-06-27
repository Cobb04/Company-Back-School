import { describe, expect, it } from "bun:test";
import { addDays } from "../App.js";

describe("addDays", () => {
  it("2026-06-27 minus 1 day → 2026-06-26 (P1 regression)", () => {
    // In +08:00, toISOString().slice(0,10) would produce 2026-06-25.
    // This test confirms UTC-safe arithmetic.
    expect(addDays("2026-06-27", -1)).toBe("2026-06-26");
  });

  it("2026-06-27 minus 0 → same day", () => {
    expect(addDays("2026-06-27", 0)).toBe("2026-06-27");
  });

  it("2026-06-27 plus 1 → 2026-06-28", () => {
    expect(addDays("2026-06-27", 1)).toBe("2026-06-28");
  });

  it("2026-01-01 minus 1 → 2025-12-31 (year boundary)", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("2025-12-31 plus 1 → 2026-01-01 (year boundary)", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
  });

  it("2026-02-28 plus 1 → 2026-03-01 (month boundary)", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("returns input on invalid format", () => {
    expect(addDays("invalid", -1)).toBe("invalid");
  });

  it("handles large positive offset", () => {
    expect(addDays("2026-06-27", 365)).toBe("2027-06-27");
  });

  it("handles large negative offset", () => {
    expect(addDays("2026-06-27", -365)).toBe("2025-06-27");
  });
});
