import { describe, expect, it } from "bun:test";
import type { GenerateLeaveMessageOutput } from "@return-school/shared";
import app from "../index.js";

// ---- POST /api/plan/leave-message tests ----

describe("POST /api/plan/leave-message", () => {
  const validBody = {
    recipientName: "王经理",
    reason: "考试",
    trainNumber: "G1234",
    departureStation: "上海虹桥",
    departureTime: "19:30",
    arrivalStation: "烟台站",
    departDate: "2026-06-26",
  };

  // ---- Success: all 4 reasons ----

  it("returns 200 with leave message for 考试 (acceptance criterion)", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as GenerateLeaveMessageOutput;
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
    expect(body.message).toContain("王经理");
    expect(body.message).toContain("考试");
    expect(body.message).toContain("G1234");
    expect(body.message).toContain("上海虹桥");
    expect(body.message).toContain("19:30");
    expect(body.message).toContain("烟台站");
    expect(body.message).toContain("2026-06-26");
  });

  it("returns 200 for 生病 reason", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, reason: "生病" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as GenerateLeaveMessageOutput;
    expect(body.message).toContain("身体不适");
  });

  it("returns 200 for 组会 reason", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, reason: "组会" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as GenerateLeaveMessageOutput;
    expect(body.message).toContain("课题组会");
  });

  it("returns 200 for 家庭原因 reason", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, reason: "家庭原因" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as GenerateLeaveMessageOutput;
    expect(body.message).toContain("家庭原因");
  });

  // ---- Switching reason regenerates ----

  it("different reasons produce different messages", async () => {
    const res1 = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, reason: "考试" }),
    });
    const res2 = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, reason: "生病" }),
    });

    const body1 = (await res1.json()) as GenerateLeaveMessageOutput;
    const body2 = (await res2.json()) as GenerateLeaveMessageOutput;
    expect(body1.message).not.toBe(body2.message);
  });

  // ---- Half-day vs full-day ----

  it("uses 半天 for afternoon departure", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, departureTime: "14:00" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as GenerateLeaveMessageOutput;
    expect(body.message).toContain("半天假");
  });

  it("uses 一天 for morning departure", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, departureTime: "08:30" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as GenerateLeaveMessageOutput;
    expect(body.message).toContain("一天假");
  });

  // ---- Validation: missing fields ----

  it("returns 400 for missing recipientName", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, recipientName: "" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid reason", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, reason: "旅游" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing trainNumber", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, trainNumber: "" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid departureTime", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, departureTime: "25:00" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid departDate", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, departDate: "2026-13-01" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for pseudo-legal departDate (2026-02-31)", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, departDate: "2026-02-31" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing departureStation", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, departureStation: "" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for non-object body", async () => {
    const res = await app.request("/api/plan/leave-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["array"]),
    });

    expect(res.status).toBe(400);
  });

  // ---- Does NOT break existing endpoints ----

  it("does not break /health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("does not break POST /api/plan/evaluate", async () => {
    const res = await app.request("/api/plan/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        departureCity: "上海",
        destinationCity: "烟台",
        departDate: "2026-06-26",
        preference: "balanced",
        clockOutTime: "18:00",
        companyToStationMinutes: 30,
        firstExamAt: "2026-06-27T09:00:00+08:00",
        stationToSchoolMinutes: { "烟台站": 30, "烟台南站": 30 },
      }),
    });

    expect(res.status).toBe(200);
  });
});
