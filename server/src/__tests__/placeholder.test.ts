import { describe, expect, it } from "bun:test";
import app from "../index.js";

describe("server", () => {
  // --- Health check (Issue #2) ---

  it("returns 200 on health check", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("status", "ok");
    expect(body).toHaveProperty("timestamp");
  });

  it("returns 404 on unknown routes", async () => {
    const res = await app.request("/nonexistent");
    expect(res.status).toBe(404);
  });

  // --- S1: Safe departure time ---

  describe("POST /api/plan/safe-departure", () => {
    it("returns safe departure time with valid input and defaults", async () => {
      const res = await app.request("/api/plan/safe-departure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clockOutTime: "18:00",
          companyToStationMinutes: 30,
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      // 18:00 + 30 + default 30 + default 15 = 19:15
      expect(body).toEqual({ safeDepartureTime: "19:15" });
    });

    it("returns safe departure time with explicit buffers", async () => {
      const res = await app.request("/api/plan/safe-departure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clockOutTime: "17:00",
          companyToStationMinutes: 20,
          stationEntryBufferMinutes: 10,
          riskBufferMinutes: 5,
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      // 17:00 + 20 + 10 + 5 = 17:35
      expect(body).toEqual({ safeDepartureTime: "17:35" });
    });

    it("handles midnight crossing", async () => {
      const res = await app.request("/api/plan/safe-departure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clockOutTime: "23:00",
          companyToStationMinutes: 60,
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      // 23:00 + 60 + 30 + 15 = 00:45 next day
      expect(body.safeDepartureTime).toBe("00:45");
    });

    it("returns 400 when clockOutTime is missing", async () => {
      const res = await app.request("/api/plan/safe-departure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyToStationMinutes: 30,
        }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    it("returns 400 when companyToStationMinutes is missing", async () => {
      const res = await app.request("/api/plan/safe-departure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clockOutTime: "18:00",
        }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    it("returns 400 for invalid time format", async () => {
      const res = await app.request("/api/plan/safe-departure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clockOutTime: "25:00",
          companyToStationMinutes: 30,
        }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await app.request("/api/plan/safe-departure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    it("returns 400 for null body", async () => {
      const res = await app.request("/api/plan/safe-departure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null",
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("object");
    });

    it("returns 400 for primitive body (string)", async () => {
      const res = await app.request("/api/plan/safe-departure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '"hello"',
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("object");
    });

    it("returns 400 for negative companyToStationMinutes", async () => {
      const res = await app.request("/api/plan/safe-departure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clockOutTime: "18:00",
          companyToStationMinutes: -30,
        }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("companyToStationMinutes");
    });

    it("returns 400 for decimal companyToStationMinutes", async () => {
      const res = await app.request("/api/plan/safe-departure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clockOutTime: "18:00",
          companyToStationMinutes: 1.5,
        }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("companyToStationMinutes");
    });

    it("returns 400 for negative stationEntryBufferMinutes", async () => {
      const res = await app.request("/api/plan/safe-departure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clockOutTime: "18:00",
          companyToStationMinutes: 30,
          stationEntryBufferMinutes: -5,
        }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("stationEntryBufferMinutes");
    });
  });
});
