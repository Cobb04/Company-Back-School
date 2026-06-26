import { Hono } from "hono";

const app = new Hono();

// Health check endpoint — for Issue #2 acceptance criteria.
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default app;
