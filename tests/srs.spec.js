import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, test } from "@playwright/test";
import * as server from "../apps/api/src/srs.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const T0 = Date.UTC(2026, 10, 1, 9);

// The app's scheduler, run the way the browser runs it: as a plain script.
const app = vm.runInNewContext(`${readFileSync("apps/web/srs.js", "utf8")}\n;({ newCard, dueSoon, schedule })`, {});

// The fields both sides keep, in the app's shape.
const fromServer = (c) => ({ due: c.dueAt.getTime(), interval: c.intervalDays, ease: c.ease, reps: c.reps, lapses: c.lapses });
const fromApp = ({ due, interval, ease, reps, lapses }) => ({ due, interval, ease, reps, lapses });

// mulberry32: a small seeded generator, so a failure replays the same way every time.
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test.describe("review scheduling", () => {
  // What the app tells the learner ("back in 3 days") must be what the server schedules.
  test("the app schedules every review exactly as the server does", () => {
    const rand = random(474);
    for (let run = 0; run < 300; run++) {
      let now = T0;
      let a = app.newCard("es-x", now);
      let s = server.newCard(new Date(now));
      for (let step = 0; step < 25; step++) {
        now += Math.floor(rand() * 8 * DAY);
        const r = rand();
        const action = r < 0.15 ? "dueSoon" : r < 0.45 ? "again" : r < 0.8 ? "good" : "easy";
        if (action === "dueSoon") {
          a = app.dueSoon(a, now);
          s = server.dueSoon(s, new Date(now));
        } else {
          a = app.schedule(a, action, now);
          s = server.schedule(s, action, new Date(now));
        }
        expect(fromApp(a), `run ${run}, step ${step}: ${action}`).toEqual(fromServer(s));
      }
    }
  });

  test("good reviews space a word out, and a miss brings it back in 10 minutes", () => {
    let card = app.newCard("es-x", T0);
    let now = card.due;
    const gaps = [];
    for (let i = 0; i < 4; i++) {
      card = app.schedule(card, "good", now);
      gaps.push(card.interval);
      now = card.due;
    }
    expect(gaps).toEqual([1, 3, 8, 20]);
    const missed = app.schedule(card, "again", now);
    expect(missed.due - now).toBe(10 * MINUTE);
    expect(missed.ease).toBe(2.3);
    expect(missed.id).toBe("es-x");
  });

  test("grading early, or saving a word that's already due, doesn't push it later", () => {
    const card = app.newCard("es-x", T0); // due tomorrow
    expect(app.schedule(card, "easy", T0 + MINUTE)).toEqual(card);
    const due = { ...card, due: T0 };
    expect(app.dueSoon(due, T0 + DAY)).toEqual(due);
  });
});
