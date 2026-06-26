import { describe, expect, it } from "bun:test";
import app from "../index.js";

describe("server", () => {
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
});
