import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { VOICES, fileFor, generate } from "../scripts/generate-audio.mjs";
import { spokenTexts } from "../scripts/speech-texts.mjs";

// The audio generator, run against a stand-in for Azure's text-to-speech endpoint.
async function fakeAzure({ failFirst = 0 } = {}) {
  const calls = [];
  let failures = failFirst;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      calls.push({ headers: req.headers, body });
      if (failures > 0) { failures--; res.writeHead(429).end("slow down"); return; }
      res.writeHead(200, { "content-type": "audio/mpeg" }).end(`mp3 of ${body.length} bytes`);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { calls, endpoint: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

const quiet = () => {};

test.describe("audio generator", () => {
  test("records each text once with the language's voice, then only what changed", async () => {
    const azure = await fakeAzure();
    const dir = mkdtempSync(join(tmpdir(), "audio-"));
    try {
      const texts = { es: ["hola", "¿Qué onda? <tú> & yo"], ja: ["こんにちは"] };
      await generate({ dir, key: "test-key", endpoint: azure.endpoint, texts, log: quiet });
      expect(azure.calls).toHaveLength(3);
      const call = azure.calls.find((c) => c.body.includes("onda"));
      expect(call.headers["ocp-apim-subscription-key"]).toBe("test-key");
      expect(call.headers["x-microsoft-outputformat"]).toMatch(/mp3/);
      expect(call.body).toContain(`voice name="${VOICES.es.voice}"`);
      expect(call.body).toContain("¿Qué onda? &lt;tú&gt; &amp; yo"); // escaped, so it can't break the SSML
      expect(azure.calls.find((c) => c.body.includes("こんにちは")).body).toContain(VOICES.ja.voice);

      const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      expect(manifest.es.hola).toBe(fileFor("es", "hola"));
      for (const file of [...Object.values(manifest.es), ...Object.values(manifest.ja)]) expect(existsSync(join(dir, file))).toBe(true);

      // a second run records nothing; a changed list records the new text and drops the old
      await generate({ dir, key: "test-key", endpoint: azure.endpoint, texts, log: quiet });
      expect(azure.calls).toHaveLength(3);
      await generate({ dir, key: "test-key", endpoint: azure.endpoint, texts: { es: ["hola", "adiós"] }, log: quiet });
      expect(azure.calls).toHaveLength(4);
      expect(readdirSync(join(dir, "es")).sort()).toEqual([fileFor("es", "adiós"), fileFor("es", "hola")].map((f) => f.slice(3)).sort());
      expect(readdirSync(join(dir, "ja"))).toEqual([]);
    } finally {
      azure.close();
    }
  });

  test("waits and retries when Azure is busy", async () => {
    const azure = await fakeAzure({ failFirst: 1 });
    const dir = mkdtempSync(join(tmpdir(), "audio-"));
    try {
      await generate({ dir, key: "k", endpoint: azure.endpoint, texts: { fr: ["bonjour"] }, log: quiet });
      expect(azure.calls).toHaveLength(2);
      expect(existsSync(join(dir, fileFor("fr", "bonjour")))).toBe(true);
    } finally {
      azure.close();
    }
  });

  test("says how to set the key when one is needed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audio-"));
    await expect(generate({ dir, key: undefined, endpoint: "http://127.0.0.1:9/", texts: { es: ["hola"] }, log: quiet })).rejects.toThrow(/AZURE_SPEECH_KEY/);
  });
});

// Once a language has recordings, every word and line it speaks must have one: a content PR that
// adds text without re-running `npm run audio` fails here.
test("every language with recordings has one for everything it says", () => {
  const manifest = JSON.parse(readFileSync("apps/web/audio/manifest.json", "utf8"));
  const texts = spokenTexts();
  for (const [lang, recorded] of Object.entries(manifest)) {
    const missing = texts[lang].filter((t) => !recorded[t]);
    expect(missing, `${lang} text without a recording: run npm run audio`).toEqual([]);
    for (const file of Object.values(recorded)) expect(existsSync(join("apps/web/audio", file)), file).toBe(true);
  }
});
