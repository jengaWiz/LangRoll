import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import type { Db } from "../../src/db.js";
import type { SpeechAssessor } from "../../src/speech.js";
import { wav } from "./wav.js";

describe("POST /speech/assess", () => {
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgres://unused/db", SUPABASE_URL: "http://127.0.0.1:54321" });
  const learner = "11111111-1111-4111-8111-111111111111";
  // A learner who exists and has checks left today; the daily cap has its own integration tests.
  const row = { id: learner, learning_lang: "ja", daily_goal_xp: 30, timezone: "UTC", created_at: new Date(0) };
  const db: Db = { query: async () => ({ rows: [row] as never[], rowCount: 1, command: "SELECT", oid: 0, fields: [] }), transaction: (fn) => fn(db) };
  const verifyToken = async (token: string) => {
    if (token !== "good") throw Object.assign(new Error("bad token"), { statusCode: 401 });
    return { userId: learner, isAnonymous: true };
  };
  let app: FastifyInstance;
  afterEach(async () => { await app.close(); });

  const calls: { locale: string; referenceText: string; bytes: number }[] = [];
  const fake: SpeechAssessor = async (audio, opts) => {
    calls.push({ ...opts, bytes: audio.length });
    return { status: "ok", heard: opts.referenceText, score: 88, accuracy: 90, fluency: 85, completeness: 100, words: [] };
  };
  const post = (body: unknown, token = "good") =>
    app.inject({ method: "POST", url: "/speech/assess", headers: { authorization: `Bearer ${token}` }, payload: body as object });
  const attempt = (over: Record<string, unknown> = {}) => ({ lang: "ja", text: "こんにちは", audio: wav(1.2).toString("base64"), ...over });

  it("grades the attempt in the language's accent", async () => {
    app = buildApp(config, { db, verifyToken, assessSpeech: fake });
    const res = await post(attempt());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", score: 88 });
    expect(calls.at(-1)).toMatchObject({ locale: "ja-JP", referenceText: "こんにちは", bytes: wav(1.2).length });
  });

  it("needs a signed-in learner, since each attempt costs money", async () => {
    app = buildApp(config, { db, verifyToken, assessSpeech: fake });
    expect((await app.inject({ method: "POST", url: "/speech/assess", payload: attempt() })).statusCode).toBe(401);
  });

  it.each([
    ["an unknown language", { lang: "de" }],
    ["an empty line", { text: "  " }],
    ["a line that's too long", { text: "a".repeat(201) }],
    ["audio that isn't base64", { audio: "not base64!" }],
  ])("refuses %s", async (_, over) => {
    app = buildApp(config, { db, verifyToken, assessSpeech: fake });
    expect((await post(attempt(over))).statusCode).toBe(400);
  });

  it("refuses audio in the wrong format", async () => {
    app = buildApp(config, { db, verifyToken, assessSpeech: fake });
    const res = await post(attempt({ audio: wav(1, { rate: 48000 }).toString("base64") }));
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe("unsupported_audio");
  });

  it("answers 503 when no speech service is configured, so the app can fall back", async () => {
    app = buildApp(config, { db, verifyToken });
    expect((await post(attempt())).statusCode).toBe(503);
  });
});
