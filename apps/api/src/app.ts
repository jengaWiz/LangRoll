import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import type { VerifyToken } from "./auth.js";
import type { Db } from "./db.js";
import { eventRoutes } from "./routes/events.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { speechRoutes } from "./routes/speech.js";
import type { SpeechAssessor } from "./speech.js";
import { security } from "./security.js";

export interface ApiError {
  error: { code: string; message: string; requestId: string };
}

export interface Deps {
  db: Db;
  verifyToken: VerifyToken;
  // Scores spoken attempts. Left out when no speech service is configured.
  assessSpeech?: SpeechAssessor | undefined;
}

// Builds the app without listening, so tests can drive it with app.inject().
// Dependencies are passed in so tests can swap them for fakes.
export function buildApp(config: Config, deps: Deps): FastifyInstance {
  // Behind the host's load balancer the client IP comes from X-Forwarded-For. Trust exactly
  // that many hops, so a client can't spoof its IP by adding its own X-Forwarded-For entries.
  const hops = config.TRUST_PROXY_HOPS;
  const trustProxy = hops > 0 ? (_address: string, hop: number) => hop < hops : false;
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: config.LOG_LEVEL,
            // never write credentials to the logs
            redact: ["req.headers.authorization", "req.headers.cookie"],
            ...(config.NODE_ENV === "development" && { transport: { target: "pino-pretty" } }),
          },
    // Generated server-side so log lines can't be forged by a client-supplied ID.
    genReqId: () => randomUUID(),
    // Bodies are small JSON events. Refuse anything bigger instead of buffering it.
    bodyLimit: 64 * 1024,
    trustProxy,
  });

  app.decorateRequest("caller", null);

  // Echo the request ID so a user's bug report can be matched to our logs.
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  // One error shape for every failure. 5xx details stay in the logs, never in the response.
  app.setErrorHandler((err: { statusCode?: number; code?: string; message: string }, request, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) request.log.error({ err }, "request failed");
    if (status === 401) reply.header("www-authenticate", "Bearer"); // RFC 6750
    const body: ApiError = {
      error: {
        code: status >= 500 ? "internal_error" : (err.code ?? "bad_request"),
        message: status >= 500 ? "Something went wrong on our side." : err.message,
        requestId: request.id,
      },
    };
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiError = { error: { code: "not_found", message: "Route not found.", requestId: request.id } };
    return reply.status(404).send(body);
  });

  app.register(security, config);
  app.register(healthRoutes, { version: config.APP_VERSION, db: deps.db });
  app.register(meRoutes, { verifyToken: deps.verifyToken, db: deps.db });
  app.register(eventRoutes, { verifyToken: deps.verifyToken, db: deps.db });
  app.register(feedbackRoutes, { verifyToken: deps.verifyToken, db: deps.db });
  app.register(speechRoutes, { verifyToken: deps.verifyToken, assess: deps.assessSpeech });

  return app;
}
