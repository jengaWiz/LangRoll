import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireCaller, type VerifyToken } from "../auth.js";
import type { Db } from "../db.js";
import { ensureProfile } from "../users.js";
import { parse } from "../validation.js";

const Feedback = z
  .object({
    message: z.string().trim().min(1, "can't be empty").max(2000, "is limited to 2000 characters"),
    appVersion: z.string().max(40).optional(),
    platform: z.string().max(80).optional(),
  })
  .strict();

// Generous for a person, tight for a script: nobody writes 10 notes an hour.
const FEEDBACK_LIMIT = { rateLimit: { max: 10, timeWindow: "1 hour" } };

export const feedbackRoutes: FastifyPluginAsync<{ verifyToken: VerifyToken; db: Db }> = async (app, opts) => {
  const auth = requireCaller(opts.verifyToken);

  app.post("/feedback", { preHandler: auth, config: FEEDBACK_LIMIT }, async (request, reply) => {
    const { message, appVersion, platform } = parse(Feedback, request.body);
    const userId = request.caller!.userId;
    await ensureProfile(opts.db, userId);
    const { rows } = await opts.db.query<{ id: string }>(
      "insert into app.feedback (user_id, message, app_version, platform) values ($1, $2, $3, $4) returning id",
      [userId, message, appVersion ?? null, platform ?? null],
    );
    return reply.status(201).send({ id: rows[0]!.id });
  });
};
