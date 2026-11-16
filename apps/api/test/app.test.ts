import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const config = loadConfig({ NODE_ENV: "test", APP_VERSION: "test-sha" });
let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("reports the running version", async () => {
    app = buildApp(config);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", version: "test-sha" });
  });

  it("returns a server-generated request ID", async () => {
    app = buildApp(config);
    const res = await app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "forged" } });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("errors", () => {
  it("returns a JSON 404 for unknown routes", async () => {
    app = buildApp(config);
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "not_found", message: "Route not found.", requestId: res.headers["x-request-id"] },
    });
  });

  it("hides internal error details from the response", async () => {
    app = buildApp(config);
    app.get("/boom", async () => {
      throw new Error("db password is hunter2");
    });
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("internal_error");
    expect(res.body).not.toContain("hunter2");
  });

  it("passes client errors through with their message", async () => {
    app = buildApp(config);
    app.post("/echo", async (req) => req.body);
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("FST_ERR_CTP_INVALID_JSON_BODY");
  });

  it("rejects oversized bodies", async () => {
    app = buildApp(config);
    app.post("/echo", async () => ({ ok: true }));
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ pad: "x".repeat(70 * 1024) }),
    });
    expect(res.statusCode).toBe(413);
  });
});
