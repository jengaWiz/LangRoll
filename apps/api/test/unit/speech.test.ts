import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { azureAssessor, checkWav, SpeechUnavailableError, toAssessment } from "../../src/speech.js";
import { wav } from "./wav.js";

describe("checkWav", () => {
  it("accepts 16 kHz mono 16-bit PCM and measures it", () => {
    expect(checkWav(wav(2.5)).seconds).toBeCloseTo(2.5);
  });

  it.each([
    ["not a WAV", Buffer.from("definitely not audio, just some text padding it out to length")],
    ["stereo", wav(1, { channels: 2 })],
    ["44.1 kHz", wav(1, { rate: 44100 })],
    ["8-bit", wav(1, { bits: 8 })],
    ["too long", wav(16)],
  ])("refuses %s with a 415", (_, audio) => {
    expect(() => checkWav(audio)).toThrow(expect.objectContaining({ statusCode: 415 }));
  });
});

describe("toAssessment", () => {
  it("reads scores at the top of the result", () => {
    const a = toAssessment({
      RecognitionStatus: "Success",
      DisplayText: "Hola, ¿qué tal?",
      NBest: [{ PronScore: 81.6, AccuracyScore: 85, FluencyScore: 90.2, CompletenessScore: 100, Words: [{ Word: "hola", AccuracyScore: 95, ErrorType: "None" }, { Word: "qué", AccuracyScore: 40, ErrorType: "Mispronunciation" }] }],
    });
    expect(a).toEqual({
      status: "ok", heard: "Hola, ¿qué tal?", score: 82, accuracy: 85, fluency: 90, completeness: 100,
      words: [{ word: "hola", accuracy: 95, error: "None" }, { word: "qué", accuracy: 40, error: "Mispronunciation" }],
    });
  });

  it("reads scores nested under PronunciationAssessment", () => {
    const a = toAssessment({
      RecognitionStatus: "Success",
      NBest: [{ Display: "Bonjour.", PronunciationAssessment: { PronScore: 70, AccuracyScore: 72, FluencyScore: 68, CompletenessScore: 100 }, Words: [{ Word: "bonjour", PronunciationAssessment: { AccuracyScore: 72, ErrorType: "None" } }] }],
    });
    expect(a).toMatchObject({ status: "ok", heard: "Bonjour.", score: 70, words: [{ word: "bonjour", accuracy: 72, error: "None" }] });
  });

  it("reports silence as nothing said", () => {
    expect(toAssessment({ RecognitionStatus: "InitialSilenceTimeout" })).toMatchObject({ status: "no_speech", score: 0, words: [] });
  });
});

describe("azureAssessor", () => {
  let server: ReturnType<typeof createServer> | undefined;
  afterEach(() => server?.close());

  async function fakeAzure(reply: (req: IncomingMessage) => [number, unknown]) {
    const seen: { url: string; headers: IncomingMessage["headers"]; bytes: number }[] = [];
    server = createServer((req, res) => {
      let bytes = 0;
      req.on("data", (c: Buffer) => { bytes += c.length; });
      req.on("end", () => {
        seen.push({ url: req.url!, headers: req.headers, bytes });
        const [status, body] = reply(req);
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      });
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return { seen, endpoint: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/stt` };
  }

  it("sends the audio, language and line to grade against", async () => {
    const azure = await fakeAzure(() => [200, { RecognitionStatus: "Success", DisplayText: "Hola", NBest: [{ PronScore: 90, Words: [] }] }]);
    const assess = azureAssessor({ key: "k", region: "eastus", endpoint: azure.endpoint });
    const audio = wav(1);
    const result = await assess(audio, { locale: "es-MX", referenceText: "Hola" });

    expect(result).toMatchObject({ status: "ok", heard: "Hola", score: 90 });
    const req = azure.seen[0]!;
    expect(req.url).toBe("/stt?language=es-MX&format=detailed");
    expect(req.bytes).toBe(audio.length);
    expect(req.headers["ocp-apim-subscription-key"]).toBe("k");
    expect(req.headers["content-type"]).toBe("audio/wav; codecs=audio/pcm; samplerate=16000");
    const settings = JSON.parse(Buffer.from(String(req.headers["pronunciation-assessment"]), "base64").toString());
    expect(settings).toMatchObject({ ReferenceText: "Hola", GradingSystem: "HundredMark", Granularity: "Word", EnableMiscue: true });
  });

  it("turns a refusal or outage into a 503, never a learner-facing 4xx", async () => {
    const azure = await fakeAzure(() => [401, { error: "bad key" }]);
    const assess = azureAssessor({ key: "wrong", region: "eastus", endpoint: azure.endpoint });
    await expect(assess(wav(1), { locale: "fr-FR", referenceText: "Bonjour" })).rejects.toBeInstanceOf(SpeechUnavailableError);

    const unreachable = azureAssessor({ key: "k", region: "eastus", endpoint: "http://127.0.0.1:9/stt" });
    await expect(unreachable(wav(1), { locale: "fr-FR", referenceText: "Bonjour" })).rejects.toBeInstanceOf(SpeechUnavailableError);
  });
});
