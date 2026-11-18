import type { FastifyPluginAsync } from "fastify";
import { requireCaller, type VerifyToken } from "../auth.js";
import type { Db } from "../db.js";
import { WRITE_LIMIT } from "../security.js";
import { EventBatch, refusal, storeEvents } from "../events.js";
import { parse } from "../validation.js";

export const eventRoutes: FastifyPluginAsync<{ verifyToken: VerifyToken; db: Db }> = async (app, opts) => {
  const auth = requireCaller(opts.verifyToken);

  // The app uploads its queue of events here and retries the whole batch if the connection
  // drops. It can remove every event listed in the response from its queue:
  //   accepted    stored now
  //   duplicates  already stored by an earlier upload
  //   rejected    will never be stored (with the reason), so retrying is pointless
  app.post("/events", { preHandler: auth, config: WRITE_LIMIT }, async (request) => {
    const { events } = parse(EventBatch, request.body);
    const now = Date.now();
    const rejected: { id: string; reason: string }[] = [];
    const storable = events.filter((e) => {
      const reason = refusal(e, now);
      if (reason && !rejected.some((r) => r.id === e.id)) rejected.push({ id: e.id, reason });
      return !reason;
    });
    const stored = new Set(await storeEvents(opts.db, request.caller!.userId, storable));
    const ids = [...new Set(storable.map((e) => e.id))];
    return {
      accepted: ids.filter((id) => stored.has(id)),
      duplicates: ids.filter((id) => !stored.has(id)),
      rejected,
    };
  });
};
