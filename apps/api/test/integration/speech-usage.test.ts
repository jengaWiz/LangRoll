import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { SpeechAssessor } from "../../src/speech.js";
import { wav } from "../unit/wav.js";
import { startTestApi } from "./helpers.js";

let scored = 0;
const assessSpeech: SpeechAssessor = async (_audio, { referenceText }) => {
  scored++;
  return { status: "ok", heard: referenceText, score: 90, accuracy: 90, fluency: 90, completeness: 100, words: [] };
};
// A small cap keeps the tests short; production defaults to 15.
const { app, pool, as, stop } = await startTestApi({ env: { SPEECH_DAILY_LIMIT: "3" }, assessSpeech });
afterAll(stop);

const attempt = (user: string, audio = wav(1).toString("base64")) =>
  app.inject({ method: "POST", url: "/speech/assess", headers: as(user), payload: { lang: "es", text: "hola", audio } });
const used = async (user: string) =>
  (await pool.query("select attempts from app.speech_usage where user_id = $1", [user])).rows.map((r) => r.attempts);

describe("daily pronunciation checks", () => {
  it("scores up to the daily cap, then answers 429 daily_limit without paying for more", async () => {
    const user = randomUUID();
    for (let i = 0; i < 3; i++) expect((await attempt(user)).statusCode).toBe(200);
    const before = scored;
    const res = await attempt(user);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("daily_limit");
    expect(scored).toBe(before);
    expect(await used(user)).toEqual([3]);
  });

  it("gives each learner their own allowance", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    for (let i = 0; i < 3; i++) await attempt(a);
    expect((await attempt(a)).statusCode).toBe(429);
    expect((await attempt(b)).statusCode).toBe(200);
  });

  it("starts again the next day", async () => {
    const user = randomUUID();
    for (let i = 0; i < 3; i++) await attempt(user);
    await pool.query("update app.speech_usage set day = day - 1 where user_id = $1", [user]);
    expect((await attempt(user)).statusCode).toBe(200);
  });

  it("doesn't count audio it refuses", async () => {
    const user = randomUUID();
    expect((await attempt(user, wav(1, { rate: 48000 }).toString("base64"))).statusCode).toBe(415);
    expect(await used(user)).toEqual([]);
  });

  it("can't be beaten by sending many checks at once", async () => {
    const user = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => attempt(user)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(3);
    expect(await used(user)).toEqual([3]);
  });

  it("is deleted along with the rest of the learner's data", async () => {
    const user = randomUUID();
    await attempt(user);
    await app.inject({ method: "DELETE", url: "/me", headers: as(user) });
    expect(await used(user)).toEqual([]);
  });
});
