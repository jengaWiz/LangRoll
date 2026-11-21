// Pronunciation scoring for speaking practice. The app records the learner saying a line, and
// Azure's pronunciation assessment grades it against that line, word by word, so feedback can
// say which word to work on rather than only whether the text matched.
// https://learn.microsoft.com/azure/ai-services/speech-service/how-to-pronunciation-assessment

export interface WordScore {
  word: string;
  accuracy: number; // 0-100
  // None: fine. Mispronunciation: said badly. Omission: left out. Insertion: added.
  error: string;
}

export interface Assessment {
  status: "ok" | "no_speech";
  heard: string;
  score: number; // overall, 0-100
  accuracy: number;
  fluency: number;
  completeness: number;
  words: WordScore[];
}

export type SpeechAssessor = (audio: Buffer, opts: { locale: string; referenceText: string }) => Promise<Assessment>;

// The scoring service couldn't be reached or refused us: our problem, not the learner's.
export class SpeechUnavailableError extends Error {
  readonly statusCode = 503;
}

export class BadAudioError extends Error {
  readonly statusCode = 415;
  readonly code = "unsupported_audio";
}

// What the app sends: 16 kHz, mono, 16-bit PCM WAV, the format Azure's short-audio API takes.
export const SAMPLE_RATE = 16000;
export const MAX_SECONDS = 15;

/** Reads a WAV header and checks it's the format we send to Azure. */
export function checkWav(buf: Buffer): { seconds: number } {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new BadAudioError("Audio must be a WAV file.");
  }
  // walk the chunks for "fmt " and "data"; recorders may put others in between
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let dataBytes = 0;
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "fmt " && at + 24 <= buf.length) {
      fmt = { format: buf.readUInt16LE(at + 8), channels: buf.readUInt16LE(at + 10), rate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22) };
    } else if (id === "data") {
      dataBytes = Math.min(size, buf.length - at - 8);
      break;
    }
    at += 8 + size + (size % 2);
  }
  if (!fmt || fmt.format !== 1 || fmt.channels !== 1 || fmt.rate !== SAMPLE_RATE || fmt.bits !== 16) {
    throw new BadAudioError(`Audio must be ${SAMPLE_RATE / 1000} kHz mono 16-bit PCM.`);
  }
  const seconds = dataBytes / (SAMPLE_RATE * 2);
  if (seconds > MAX_SECONDS) throw new BadAudioError(`Recordings can be at most ${MAX_SECONDS} seconds.`);
  return { seconds };
}

// Azure has returned scores both at the top of each result and nested under
// PronunciationAssessment, depending on API version, so read either.
interface AzureScores {
  AccuracyScore?: number;
  FluencyScore?: number;
  CompletenessScore?: number;
  PronScore?: number;
  ErrorType?: string;
}
interface AzureWord extends AzureScores {
  Word: string;
  PronunciationAssessment?: AzureScores;
}
interface AzureResult extends AzureScores {
  Display?: string;
  Words?: AzureWord[];
  PronunciationAssessment?: AzureScores;
}
interface AzureResponse {
  RecognitionStatus: string;
  DisplayText?: string;
  NBest?: AzureResult[];
}

const round = (n: number | undefined) => Math.round(n ?? 0);

export function toAssessment(res: AzureResponse): Assessment {
  const best = res.NBest?.[0];
  if (res.RecognitionStatus !== "Success" || !best) {
    return { status: "no_speech", heard: "", score: 0, accuracy: 0, fluency: 0, completeness: 0, words: [] };
  }
  const s = best.PronunciationAssessment ?? best;
  return {
    status: "ok",
    heard: res.DisplayText ?? best.Display ?? "",
    score: round(s.PronScore),
    accuracy: round(s.AccuracyScore),
    fluency: round(s.FluencyScore),
    completeness: round(s.CompletenessScore),
    words: (best.Words ?? []).map((w) => {
      const ws = w.PronunciationAssessment ?? w;
      return { word: w.Word, accuracy: round(ws.AccuracyScore), error: ws.ErrorType ?? "None" };
    }),
  };
}

// Statuses that mean nothing usable was said, as opposed to a service failure.
const NOTHING_SAID = new Set(["Success", "NoMatch", "InitialSilenceTimeout", "BabbleTimeout"]);

export function azureAssessor({ key, region, endpoint }: { key: string; region: string; endpoint?: string }): SpeechAssessor {
  const base = endpoint ?? `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`;
  return async (audio, { locale, referenceText }) => {
    const settings = { ReferenceText: referenceText, GradingSystem: "HundredMark", Granularity: "Word", Dimension: "Comprehensive", EnableMiscue: true };
    const url = `${base}?${new URLSearchParams({ language: locale, format: "detailed" })}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": `audio/wav; codecs=audio/pcm; samplerate=${SAMPLE_RATE}`,
          "Pronunciation-Assessment": Buffer.from(JSON.stringify(settings)).toString("base64"),
          Accept: "application/json",
        },
        body: new Uint8Array(audio),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new SpeechUnavailableError("Speech service unreachable", { cause: err });
    }
    if (!res.ok) throw new SpeechUnavailableError(`Speech service answered ${res.status}`);
    const body = (await res.json()) as AzureResponse;
    if (!NOTHING_SAID.has(body.RecognitionStatus)) throw new SpeechUnavailableError(`Speech service status ${body.RecognitionStatus}`);
    return toAssessment(body);
  };
}
