import { describe, expect, it } from "bun:test";
import { generateLeaveMessage } from "../index.js";
import type { LeaveReason } from "@return-school/shared";

// ---- Shared test fixtures ----

function makeInput(overrides: Partial<{
  recipientName: string;
  reason: LeaveReason;
  trainNumber: string;
  departureStation: string;
  departureTime: string;
  arrivalStation: string;
  departDate: string;
}> = {}) {
  return {
    recipientName: "王经理",
    reason: "考试" as LeaveReason,
    trainNumber: "G1234",
    departureStation: "上海虹桥",
    departureTime: "19:30",
    arrivalStation: "烟台站",
    departDate: "2026-06-26",
    ...overrides,
  };
}

// ---- generateLeaveMessage tests ----

describe("generateLeaveMessage", () => {
  // ---- Acceptance criterion: all 4 reasons produce correct output ----

  it("generates correct message for 考试 reason (acceptance criterion)", () => {
    const result = generateLeaveMessage(makeInput({ reason: "考试" }));

    expect(result.message).toContain("王经理");
    expect(result.message).toContain("您好");
    expect(result.message).toContain("有一场考试");
    expect(result.message).toContain("2026-06-26");
    expect(result.message).toContain("G1234");
    expect(result.message).toContain("上海虹桥");
    expect(result.message).toContain("19:30");
    expect(result.message).toContain("烟台站");
    expect(result.message).toContain("半天假"); // 19:30 is afternoon
    expect(result.message).toContain("考试结束后将尽快返岗");
  });

  it("generates correct message for 生病 reason", () => {
    const result = generateLeaveMessage(makeInput({ reason: "生病" }));

    expect(result.message).toContain("王经理");
    expect(result.message).toContain("身体不适");
    expect(result.message).toContain("G1234");
    expect(result.message).toContain("半天假"); // 19:30 is afternoon
    expect(result.message).toContain("身体恢复后将尽快返岗");
  });

  it("generates correct message for 组会 reason", () => {
    const result = generateLeaveMessage(makeInput({ reason: "组会" }));

    expect(result.message).toContain("王经理");
    expect(result.message).toContain("课题组会");
    expect(result.message).toContain("无法正常到岗");
    expect(result.message).toContain("G1234");
    expect(result.message).toContain("组会结束后将尽快返岗");
  });

  it("generates correct message for 家庭原因 reason", () => {
    const result = generateLeaveMessage(makeInput({ reason: "家庭原因" }));

    expect(result.message).toContain("王经理");
    expect(result.message).toContain("家庭原因");
    expect(result.message).toContain("G1234");
    expect(result.message).toContain("事情处理完毕后将尽快返岗");
  });

  // ---- Train facts correctly interpolated ----

  it("interpolates train facts correctly", () => {
    const result = generateLeaveMessage(makeInput({
      trainNumber: "D5678",
      departureStation: "上海站",
      departureTime: "20:00",
      arrivalStation: "烟台南站",
      departDate: "2026-07-01",
    }));

    expect(result.message).toContain("D5678");
    expect(result.message).toContain("上海站");
    expect(result.message).toContain("20:00");
    expect(result.message).toContain("烟台南站");
    expect(result.message).toContain("2026-07-01");
    expect(result.message).toContain("半天假"); // 20:00 is afternoon
  });

  // ---- Half-day vs full-day: before 12:00 → 一天 ----

  it("uses 一天 when departure is before 12:00 (morning)", () => {
    const result = generateLeaveMessage(makeInput({
      departureTime: "08:00",
      reason: "考试",
    }));

    expect(result.message).toContain("一天假");
    expect(result.message).not.toContain("半天假");
  });

  // ---- Half-day vs full-day: exactly 12:00 → 半天 ----

  it("uses 半天 when departure is exactly 12:00", () => {
    const result = generateLeaveMessage(makeInput({
      departureTime: "12:00",
      reason: "生病",
    }));

    expect(result.message).toContain("半天假");
  });

  // ---- Half-day vs full-day: after 12:00 → 半天 ----

  it("uses 半天 when departure is after 12:00 (afternoon)", () => {
    const result = generateLeaveMessage(makeInput({
      departureTime: "14:30",
      reason: "组会",
    }));

    expect(result.message).toContain("半天假");
  });

  // ---- Switching reason regenerates message with matching tone ----

  it("switching reason changes the message tone (acceptance criterion)", () => {
    const examResult = generateLeaveMessage(makeInput({ reason: "考试" }));
    const sickResult = generateLeaveMessage(makeInput({ reason: "生病" }));
    const meetingResult = generateLeaveMessage(makeInput({ reason: "组会" }));
    const familyResult = generateLeaveMessage(makeInput({ reason: "家庭原因" }));

    // Each reason produces a different message
    expect(examResult.message).not.toBe(sickResult.message);
    expect(examResult.message).not.toBe(meetingResult.message);
    expect(examResult.message).not.toBe(familyResult.message);
    expect(sickResult.message).not.toBe(meetingResult.message);

    // But all have the same transport details
    for (const r of [examResult, sickResult, meetingResult, familyResult]) {
      expect(r.message).toContain("G1234");
      expect(r.message).toContain("上海虹桥");
      expect(r.message).toContain("烟台站");
    }
  });

  // ---- Different recipient name ----

  it("interpolates different recipient names", () => {
    const result = generateLeaveMessage(makeInput({ recipientName: "张老师" }));

    expect(result.message).toContain("张老师");
    expect(result.message).not.toContain("王经理");
  });

  // ---- Edge cases ----

  it("handles edge case: midnight departure (00:00) → 一天", () => {
    const result = generateLeaveMessage(makeInput({
      departureTime: "00:00",
      reason: "家庭原因",
    }));

    expect(result.message).toContain("一天假");
  });

  it("handles edge case: late night departure (23:59) → 半天", () => {
    const result = generateLeaveMessage(makeInput({
      departureTime: "23:59",
      reason: "考试",
    }));

    expect(result.message).toContain("半天假");
  });

  // ---- Error: empty recipient name ----

  it("throws for empty recipient name", () => {
    expect(() =>
      generateLeaveMessage(makeInput({ recipientName: "" })),
    ).toThrow("recipientName");
  });

  it("throws for whitespace-only recipient name", () => {
    expect(() =>
      generateLeaveMessage(makeInput({ recipientName: "   " })),
    ).toThrow("recipientName");
  });

  // ---- Error: invalid reason ----

  it("throws for unsupported reason", () => {
    expect(() =>
      generateLeaveMessage(makeInput({ reason: "旅游" as LeaveReason })),
    ).toThrow("Unsupported leave reason");
  });

  // ---- Error: invalid time format ----

  it("throws for invalid departure time format", () => {
    expect(() =>
      generateLeaveMessage(makeInput({ departureTime: "25:00" })),
    ).toThrow("Invalid time value");
  });

  // ---- Deterministic: no LLM, no fabrication ----

  it("produces deterministic output — same input → same output", () => {
    const input = makeInput({ reason: "考试" });
    const result1 = generateLeaveMessage(input);
    const result2 = generateLeaveMessage(input);

    expect(result1.message).toBe(result2.message);
  });

  it("does not fabricate train details — only uses provided facts", () => {
    const result = generateLeaveMessage(makeInput({
      trainNumber: "G1234",
      departureStation: "上海虹桥",
      arrivalStation: "烟台站",
    }));

    // Should NOT contain any other train numbers or station names
    expect(result.message).not.toContain("G5678");
    expect(result.message).not.toContain("D1234");
    expect(result.message).not.toContain("北京");
  });

  // ---- Return type shape ----

  it("returns an object with message string", () => {
    const result = generateLeaveMessage(makeInput());

    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
  });
});
