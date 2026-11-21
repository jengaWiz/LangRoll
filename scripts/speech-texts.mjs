// Everything the app reads aloud, per language, taken from apps/web/content.js. Shared by the
// audio generator and the tests, so the two can't disagree about what needs recording.
import { readFileSync } from "node:fs";
import vm from "node:vm";

export function loadContent(file = "apps/web/content.js") {
  const ctx = {};
  vm.runInNewContext(`${readFileSync(file, "utf8")}\nthis.LANGS = LANGS;`, ctx);
  return ctx.LANGS;
}

// The text app.js speaks for a clip: the word, line or sentence it shows in the learner's
// language (see speak() calls and reviewFace() in app.js).
export function clipText(clip) {
  switch (clip.kind) {
    case "vocab": return clip.term;
    case "quiz": return clip.q.replace("___", clip.answer);
    case "speak": return clip.line;
    case "flip": return clip.front;
    case "watch": return clip.line;
  }
  return null;
}

// { es: ["hola", ...], fr: [...], ... }, each list without repeats.
export function spokenTexts(langs = loadContent()) {
  const out = {};
  for (const [code, L] of Object.entries(langs)) {
    const texts = [...L.clips.map(clipText), ...L.duel.map(([word]) => word)];
    out[code] = [...new Set(texts.filter(Boolean).map((t) => t.trim()))];
  }
  return out;
}
