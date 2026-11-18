import type { FastifyPluginAsync } from "fastify";
import { requireCaller, type VerifyToken } from "../auth.js";
import { dueReviews } from "../cards.js";
import type { Db } from "../db.js";
import { getProgress } from "../progress.js";
import { WRITE_LIMIT } from "../security.js";
import { ensureProfile, ProfileUpdate, updateProfile } from "../users.js";
import { parse } from "../validation.js";

// The caller's own profile. The user id always comes from the verified token, never from the
// request, so there is no way to read or change someone else's.
export const meRoutes: FastifyPluginAsync<{ verifyToken: VerifyToken; db: Db }> = async (app, opts) => {
  const auth = requireCaller(opts.verifyToken);

  app.get("/me", { preHandler: auth }, async (request) => {
    const caller = request.caller!;
    return { ...(await ensureProfile(opts.db, caller.userId)), isAnonymous: caller.isAnonymous };
  });

  // XP and streaks, computed by the server from stored events.
  app.get("/me/progress", { preHandler: auth }, async (request) => getProgress(opts.db, request.caller!.userId));

  // Cards due for review in the learner's current language. Empty until they pick one.
  app.get("/me/reviews", { preHandler: auth }, async (request) => {
    const profile = await ensureProfile(opts.db, request.caller!.userId);
    if (!profile.learningLang) return { due: [], dueCount: 0, deckSize: 0 };
    return dueReviews(opts.db, profile.id, profile.learningLang);
  });

  app.patch("/me", { preHandler: auth, config: WRITE_LIMIT }, async (request) => {
    const caller = request.caller!;
    const update = parse(ProfileUpdate, request.body);
    return { ...(await updateProfile(opts.db, caller.userId, update)), isAnonymous: caller.isAnonymous };
  });
};
