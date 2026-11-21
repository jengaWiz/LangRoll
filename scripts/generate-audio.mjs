// Records everything the app reads aloud with Azure's neural voices, so learners hear a natural
// native speaker instead of the phone's built-in voice. Run it after changing lesson content:
//
//   npm run audio
//
// It reads AZURE_SPEECH_KEY and AZURE_SPEECH_REGION from the environment or from .env (which git
// ignores), records only text that's new or changed, deletes recordings nothing uses any more, and
// writes apps/web/audio/manifest.json, which the app uses to find each recording.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spokenTexts } from "./speech-texts.mjs";

// One voice per language, from Azure's neural voices for that locale.
// https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts
export const VOICES = {
  es: { locale: "es-MX", voice: "es-MX-DaliaNeural" },
  fr: { locale: "fr-FR", voice: "fr-FR-DeniseNeural" },
  ja: { locale: "ja-JP", voice: "ja-JP-NanamiNeural" },
};
// A touch slower than conversation, for learners. Changing it re-records everything.
export const RATE = "-8%";
const FORMAT = "audio-24khz-48kbitrate-mono-mp3";

const escapeXml = (s) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));

export function ssml(text, { locale, voice }) {
  return `<speak version="1.0" xml:lang="${locale}"><voice name="${voice}"><prosody rate="${RATE}">${escapeXml(text)}</prosody></voice></speak>`;
}

// A recording's file name comes from everything that shapes how it sounds, so a change to the
// text, voice or speed gets a new recording and the old one is cleaned up.
export function fileFor(lang, text) {
  const { voice } = VOICES[lang];
  const hash = createHash("sha256").update(`${voice}|${RATE}|${text}`).digest("hex").slice(0, 16);
  return `${lang}/${hash}.mp3`;
}

async function synthesize(text, lang, { endpoint, key }) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": FORMAT,
        "User-Agent": "langroll-audio",
      },
      body: ssml(text, VOICES[lang]),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    // throttled or a passing server error: wait and try again, a few times
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    throw new Error(`Azure said ${res.status} for "${text}" (${lang}): ${(await res.text()).slice(0, 200)}`);
  }
}

export async function generate({ dir = "apps/web/audio", key, region, endpoint, texts = spokenTexts(), log = console.log } = {}) {
  endpoint ??= `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const manifest = {};
  const jobs = [];
  for (const [lang, list] of Object.entries(texts)) {
    if (!VOICES[lang]) throw new Error(`no voice set for language "${lang}" in scripts/generate-audio.mjs`);
    mkdirSync(join(dir, lang), { recursive: true });
    manifest[lang] = {};
    for (const text of list) {
      const file = fileFor(lang, text);
      manifest[lang][text] = file;
      if (!existsSync(join(dir, file))) jobs.push({ lang, text, file });
    }
  }
  if (jobs.length && !key) throw new Error("AZURE_SPEECH_KEY isn't set: put it in .env (see README → Audio)");

  // a few at a time, well within Azure's limits
  let done = 0;
  const queue = [...jobs];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let job; (job = queue.shift());) {
      writeFileSync(join(dir, job.file), await synthesize(job.text, job.lang, { endpoint, key }));
      done++;
    }
  }));

  // remove recordings of text that's no longer in the app
  const keep = new Set(Object.values(manifest).flatMap((m) => Object.values(m)));
  let removed = 0;
  for (const lang of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    for (const f of readdirSync(join(dir, lang))) {
      if (!keep.has(`${lang}/${f}`)) { rmSync(join(dir, lang, f)); removed++; }
    }
  }
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`audio: ${done} recorded, ${keep.size - done} already up to date, ${removed} removed`);
  return { recorded: done, removed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await generate({ key: process.env.AZURE_SPEECH_KEY, region: process.env.AZURE_SPEECH_REGION || "eastus" });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
