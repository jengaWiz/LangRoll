import type { FastifyPluginAsync } from "fastify";
import { requireCaller, type VerifyToken } from "../auth.js";

export const meRoutes: FastifyPluginAsync<{ verifyToken: VerifyToken }> = async (app, opts) => {
  const auth = requireCaller(opts.verifyToken);

  // Who the token belongs to. The profile stored in the database comes in a later PR.
  app.get("/me", { preHandler: auth }, async (request) => ({
    id: request.caller!.userId,
    isAnonymous: request.caller!.isAnonymous,
  }));
};
