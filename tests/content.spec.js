import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, test } from "@playwright/test";

// Checks every clip in apps/web/content.js before it ships, so a content PR can't break the feed.
// The rules mirror how app.js renders each kind and what the API accepts.

const ctx = {};
vm.runInNewContext(`${readFileSync("apps/web/content.js", "utf8")}\nthis.LANGS = LANGS; this.CREATORS = CREATORS;`, ctx);
const { LANGS, CREATORS } = ctx;

// The API's clip id rule (apps/api/src/events.ts): language code, dash, 1-16 lowercase letters/digits.
const CLIP_ID = /^[a-z]{2}-[a-z0-9]{1,16}$/;
const text = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

// Required fields per kind, with the longest each may be before it stops fitting a phone screen.
const FIELDS = {
  vocab: { term: 40, meaning: 60 },
  quiz: { q: 80, sub: 80, explain: 140 },
  speak: { line: 60, meaning: 80 },
  flip: { front: 24, reading: 40, meaning: 60, note: 140 },
  // a scene's line is what was actually said, so it gets a little more room than a lesson's; the
  // fit tests measure every real clip on three phone sizes either way
  watch: { line: 85, meaning: 80, channel: 40 },
};
// Every language needs these. Watch clips are optional: they depend on finding the right scene.
const CORE_KINDS = ["vocab", "quiz", "speak", "flip"];
// A YouTube video id, as in youtube.com/watch?v=dQw4w9WgXcQ.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function problems(lang, clip) {
  const out = [];
  const bad = (msg) => out.push(`${clip.id ?? "(no id)"}: ${msg}`);
  if (!CLIP_ID.test(clip.id ?? "")) bad("id must look like es-v1 (the API rejects anything else)");
  else if (!clip.id.startsWith(`${lang}-`)) bad(`id must start with "${lang}-" (cards are matched to languages by prefix)`);
  if (!FIELDS[clip.kind]) return [...out, `${clip.id}: unknown kind "${clip.kind}"`];
  if (!text(clip.tag, 20)) bad("needs a short tag (≤20 chars)");
  if (!text(clip.caption, 140)) bad("needs a caption (≤140 chars)");
  // a watch clip credits the YouTube channel instead of one of our creators
  if (clip.kind !== "watch" && !CREATORS[clip.creator]) bad(`unknown creator "${clip.creator}"`);
  for (const [field, max] of Object.entries(FIELDS[clip.kind])) {
    if (!text(clip[field], max)) bad(`${field} is missing or longer than ${max} chars`);
  }
  if (clip.kind === "vocab") {
    if (!Array.isArray(clip.phon) || clip.phon.length < 1 || !clip.phon.every((p) => text(p, 12))) bad("phon must be a list of syllables");
    else if (!Number.isInteger(clip.hit) || clip.hit < 0 || clip.hit >= clip.phon.length) bad("hit must point at one of the syllables");
  }
  if (clip.kind === "quiz") {
    if ((clip.q.match(/___/g) || []).length !== 1) bad('q needs exactly one "___" blank');
    if (!Array.isArray(clip.options) || clip.options.length !== 3) bad("quiz needs exactly 3 options");
    else {
      if (new Set(clip.options).size !== 3) bad("options must be different");
      if (!clip.options.includes(clip.answer)) bad(`answer "${clip.answer}" isn't one of the options`);
    }
  }
  if (clip.kind === "watch") {
    if (!VIDEO_ID.test(clip.video ?? "")) bad("video must be the 11-character id from the YouTube link");
    const { start, end } = clip;
    if (!Number.isFinite(start) || start < 0) bad("start must be a time in seconds");
    else if (!Number.isFinite(end) || end <= start) bad("end must be after start");
    // One line, not a whole scene: short enough to loop and replay.
    else if (end - start > 30) bad("a scene can be at most 30 seconds");
    if (clip.shape !== undefined && !["wide", "tall"].includes(clip.shape)) bad('shape is "wide" (normal video) or "tall" (Shorts)');
  }
  if (clip.hint !== undefined && !text(clip.hint, 40)) bad("hint must be short text");
  return out;
}

for (const [lang, L] of Object.entries(LANGS)) {
  test.describe(`content: ${L.name}`, () => {
    test("every clip is well formed", () => {
      expect(L.clips.flatMap((c) => problems(lang, c))).toEqual([]);
    });

    test("clip ids are unique", () => {
      const ids = L.clips.map((c) => c.id);
      expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    });

    test("the same word isn't taught twice", () => {
      const key = (c) => (c.term ?? c.front ?? c.line ?? c.q)?.trim().toLowerCase();
      const keys = L.clips.map(key);
      expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    });

    test("has every kind of clip and a usable duel", () => {
      const kinds = new Set(L.clips.map((c) => c.kind));
      expect(CORE_KINDS.filter((k) => !kinds.has(k))).toEqual([]);
      expect(L.duel.length).toBeGreaterThanOrEqual(8);
      expect(new Set(L.duel.map(([p]) => p)).size).toBe(L.duel.length);
      expect(new Set(L.duel.map(([, a]) => a)).size).toBe(L.duel.length);
    });

    test("names a speech voice", () => {
      expect(L.speech).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    });

    test("has units in teaching order, each with a level, a goal and enough clips", () => {
      const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
      expect(L.units.length).toBeGreaterThan(0);
      expect(new Set(L.units.map((u) => u.id)).size).toBe(L.units.length);
      for (const u of L.units) {
        expect(u.id, "unit id").toMatch(/^[a-z][a-z-]*$/);
        expect(LEVELS, `${u.id} level`).toContain(u.level);
        expect(text(u.title, 40), `${u.id} title`).toBe(true);
        expect(text(u.goal, 80), `${u.id} goal`).toBe(true);
        expect(L.clips.filter((c) => c.unit === u.id).length, `${u.id} clips`).toBeGreaterThanOrEqual(3);
      }
      // easier units first: a level never drops back
      const order = L.units.map((u) => LEVELS.indexOf(u.level));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    test("puts every clip in one of its units", () => {
      const units = new Set(L.units.map((u) => u.id));
      expect(L.clips.filter((c) => !units.has(c.unit)).map((c) => `${c.id} (${c.unit})`)).toEqual([]);
    });
  });
}

test("every creator is used, so none are left behind", () => {
  const used = new Set(Object.values(LANGS).flatMap((L) => L.clips.map((c) => c.creator)));
  used.add("priya"); // the duel rival
  expect(Object.keys(CREATORS).filter((c) => !used.has(c))).toEqual([]);
});

// The rules, and the mistakes they catch, on a sample scene.
test("watch clips are checked too", () => {
  const scene = { id: "es-w1", kind: "watch", tag: "In a café", caption: "ordering like a local", video: "dQw4w9WgXcQ", start: 12, end: 16.5, line: "Un café, por favor.", meaning: "A coffee, please.", channel: "Some Channel" };
  expect(problems("es", scene)).toEqual([]);
  expect(problems("es", { ...scene, shape: "tall" })).toEqual([]);
  expect(problems("es", { ...scene, video: "https://youtu.be/dQw4w9WgXcQ" })).toEqual([expect.stringContaining("video must be")]);
  expect(problems("es", { ...scene, end: 10 })).toEqual([expect.stringContaining("end must be after start")]);
  expect(problems("es", { ...scene, end: 60 })).toEqual([expect.stringContaining("at most 30 seconds")]);
  expect(problems("es", { ...scene, shape: "square" })).toEqual([expect.stringContaining("shape")]);
  expect(problems("es", { ...scene, channel: undefined })).toEqual([expect.stringContaining("channel")]);
});
