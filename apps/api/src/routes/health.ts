import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db.js";
import { NO_LIMIT } from "../security.js";

// /health is liveness: the process is up. /ready is readiness: it can reach the database,
// so a load balancer stops sending traffic while the database is down.
export const healthRoutes: FastifyPluginAsync<{ version: string; db: Db }> = async (app, opts) => {
  app.get("/health", { config: NO_LIMIT }, async () => ({
    status: "ok",
    version: opts.version,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get("/ready", { config: NO_LIMIT }, async (request, reply) => {
    try {
      await opts.db.query("select 1");
      return { status: "ready" };
    } catch (err) {
      request.log.error({ err }, "database check failed");
      return reply.status(503).send({ status: "unavailable" });
    }
  });
};
