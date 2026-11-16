import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

// Who is calling, taken from a verified Supabase Auth access token.
export interface Caller {
  userId: string;
  // Guests get a real (anonymous) Supabase account, so their progress can be kept on upgrade.
  isAnonymous: boolean;
}

export type VerifyToken = (token: string) => Promise<Caller>;

export class AuthError extends Error {
  readonly statusCode = 401;
  readonly code = "unauthorized";
}

// The signing keys couldn't be fetched. This is our problem, not the caller's, so it must not
// look like a bad token: a 401 would make the app sign people out during a Supabase blip.
export class AuthUnavailableError extends Error {
  readonly statusCode = 503;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifies Supabase access tokens against the project's published public keys (JWKS), so the
 * API holds no signing secret. Keys are cached by jose and refetched when Supabase rotates them.
 */
export function supabaseVerifier(supabaseUrl: string, keys?: JWTVerifyGetKey): VerifyToken {
  const base = supabaseUrl.endsWith("/") ? supabaseUrl : `${supabaseUrl}/`;
  const issuer = new URL("auth/v1", base).href;
  const getKey = keys ?? createRemoteJWKSet(new URL("auth/v1/.well-known/jwks.json", base));

  return async (token) => {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, getKey, {
        issuer,
        audience: "authenticated",
        // Asymmetric only. Never HS256 (shared secret) or "none".
        algorithms: ["ES256", "RS256"],
        requiredClaims: ["sub", "exp"],
        clockTolerance: 5,
      }));
    } catch (err) {
      if (err instanceof errors.JWKSTimeout || err instanceof errors.JWKSInvalid || !(err instanceof errors.JOSEError)) {
        throw new AuthUnavailableError("Could not load token signing keys", { cause: err });
      }
      throw new AuthError(err instanceof errors.JWTExpired ? "Token expired." : "Invalid token.");
    }
    if (typeof payload.sub !== "string" || !UUID.test(payload.sub)) throw new AuthError("Invalid token.");
    return { userId: payload.sub.toLowerCase(), isAnonymous: payload.is_anonymous === true };
  };
}

// preHandler for routes that need a signed-in caller (guests count). Sets request.caller.
export function requireCaller(verify: VerifyToken) {
  return async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    const match = header && /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
    if (!match) throw new AuthError("Missing bearer token.");
    request.caller = await verify(match[1]!);
  };
}

declare module "fastify" {
  interface FastifyRequest {
    caller: Caller | null;
  }
}
