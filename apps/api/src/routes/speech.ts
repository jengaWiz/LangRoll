import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireCaller, type VerifyToken } from "../auth.js";
import { checkWav, SpeechUnavailableError, type SpeechAssessor } from "../speech.js";
import { LANGUAGES } from "../users.js";
import { parse } from "../validation.js";

// The accent each language is taught in, matching the app's voices.
const LOCALES: Record<(typeof LANGUAGES)[number], string> = { es: "es-MX", fr: "fr-FR", ja: "ja-JP" };

const Attempt = z
  .object({
    lang: z.enum(LANGUAGES),
    // the line the learner was asked to say
    text: z.string().trim().min(1).max(200),
    // base64 WAV; 15 s of 16 kHz 16-bit mono is 480 KB, about 640 KB as base64
    audio: z.base64().max(700_000, "is too long"),
  })
  .strict();

// Each attempt costs money, so a script can't run up a bill: a person practising tries a line
// a few times a minute at most.
const SPEECH_LIMIT = { rateLimit: { max: 20, timeWindow: "1 minute" } };

export const speechRoutes: FastifyPluginAsync<{ verifyToken: VerifyToken; assess?: SpeechAssessor | undefined }> = async (app, opts) => {
  const auth = requireCaller(opts.verifyToken);

  app.post("/speech/assess", { preHandler: auth, config: SPEECH_LIMIT, bodyLimit: 1024 * 1024 }, async (request) => {
    const { lang, text, audio } = parse(Attempt, request.body);
    // Not configured (no key): the app falls back to the phone's own recognition.
    if (!opts.assess) throw new SpeechUnavailableError("Speech scoring is not configured");
    const wav = Buffer.from(audio, "base64");
    checkWav(wav);
    return opts.assess(wav, { locale: LOCALES[lang], referenceText: text });
  });
};
