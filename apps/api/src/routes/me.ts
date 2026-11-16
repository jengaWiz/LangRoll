import type { FastifyPluginAsync } from "fastify";
import { requireCaller, type VerifyToken } from "../auth.js";
import type { Db } from "../db.js";
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

  app.patch("/me", { preHandler: auth }, async (request) => {
    const caller = request.caller!;
    const update = parse(ProfileUpdate, request.body);
    return { ...(await updateProfile(opts.db, caller.userId, update)), isAnonymous: caller.isAnonymous };
  });
};
