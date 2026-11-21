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
};

function problems(lang, clip) {
  const out = [];
  const bad = (msg) => out.push(`${clip.id ?? "(no id)"}: ${msg}`);
  if (!CLIP_ID.test(clip.id ?? "")) bad("id must look like es-v1 (the API rejects anything else)");
  else if (!clip.id.startsWith(`${lang}-`)) bad(`id must start with "${lang}-" (cards are matched to languages by prefix)`);
  if (!FIELDS[clip.kind]) return [...out, `${clip.id}: unknown kind "${clip.kind}"`];
  if (!text(clip.tag, 20)) bad("needs a short tag (≤20 chars)");
  if (!text(clip.caption, 140)) bad("needs a caption (≤140 chars)");
  if (!CREATORS[clip.creator]) bad(`unknown creator "${clip.creator}"`);
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
      expect(new Set(L.clips.map((c) => c.kind))).toEqual(new Set(Object.keys(FIELDS)));
      expect(L.duel.length).toBeGreaterThanOrEqual(8);
      expect(new Set(L.duel.map(([p]) => p)).size).toBe(L.duel.length);
      expect(new Set(L.duel.map(([, a]) => a)).size).toBe(L.duel.length);
    });

    test("names a speech voice", () => {
      expect(L.speech).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    });
  });
}

test("every creator is used, so none are left behind", () => {
  const used = new Set(Object.values(LANGS).flatMap((L) => L.clips.map((c) => c.creator)));
  used.add("priya"); // the duel rival
  expect(Object.keys(CREATORS).filter((c) => !used.has(c))).toEqual([]);
});
