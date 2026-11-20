import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { Config } from "./config.js";

/**
 * Browser and abuse protections, registered before any route.
 *
 * Wrapped in fastify-plugin so these hooks apply to the whole app. A plain plugin would be
 * encapsulated, and its headers and limits would silently skip every route outside it.
 *
 * Rate limits are per client IP and held in memory, which is right for a single instance.
 * Running several instances needs a shared store (Redis) so limits apply across them.
 */
export const security = fp(async (app: FastifyInstance, config: Config) => {
  // Standard hardening headers (nosniff, no framing, HSTS, ...).
  await app.register(helmet);

  // Only our own pages may call the API from a browser. Auth is a bearer token, never a
  // cookie, so credentials stay off.
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["authorization", "content-type"],
    credentials: false,
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    // Thrown, so the app's error handler sends it in the usual error shape.
    errorResponseBuilder: (_request, ctx) => ({
      statusCode: 429,
      code: "rate_limited",
      message: `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)}s.`,
    }),
  });
});

// Tighter limit for routes that write, on top of the global one.
export const WRITE_LIMIT = { rateLimit: { max: 60, timeWindow: "1 minute" } };
// Health checks come from the host's probes and must never be throttled.
export const NO_LIMIT = { rateLimit: false } as const;
