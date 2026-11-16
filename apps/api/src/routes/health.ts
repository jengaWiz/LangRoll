import type { FastifyPluginAsync } from "fastify";

// Liveness: the process is up and serving. A readiness check that also pings the
// database arrives with the database itself.
export const healthRoutes: FastifyPluginAsync<{ version: string }> = async (app, opts) => {
  app.get("/health", async () => ({
    status: "ok",
    version: opts.version,
    uptimeSeconds: Math.round(process.uptime()),
  }));
};
