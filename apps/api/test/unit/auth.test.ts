import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, errors, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTVerifyGetKey } from "jose";
import { buildApp } from "../../src/app.js";
import { supabaseVerifier } from "../../src/auth.js";
import { loadConfig } from "../../src/config.js";
import type { Db } from "../../src/db.js";

// A stand-in for a Supabase project: our own signing key, published as a local JWKS.
const SUPABASE_URL = "https://abcd.supabase.co";
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgres://unused/db", SUPABASE_URL });
const db: Db = { query: async () => ({ rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] }) };

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: JWTVerifyGetKey;
let app: FastifyInstance;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair("ES256")).privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "ES256" }] });
});

afterEach(async () => {
  await app?.close();
});

function token(claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; exp?: string | number; issuer?: string } = {}) {
  return new SignJWT({ aud: "authenticated", role: "authenticated", ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(opts.issuer ?? ISSUER)
    .setSubject((claims.sub as string) ?? randomUUID())
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(opts.key ?? signingKey);
}

function me(authorization?: string, keys: JWTVerifyGetKey = jwks) {
  app = buildApp(config, { db, verifyToken: supabaseVerifier(SUPABASE_URL, keys) });
  return app.inject({ method: "GET", url: "/me", headers: authorization ? { authorization } : {} });
}

describe("GET /me", () => {
  it("returns the caller for a valid token", async () => {
    const id = randomUUID();
    const res = await me(`Bearer ${await token({ sub: id })}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id, isAnonymous: false });
  });

  it("marks guest accounts as anonymous", async () => {
    const res = await me(`Bearer ${await token({ is_anonymous: true })}`);
    expect(res.json().isAnonymous).toBe(true);
  });

  it("asks for a token when none is sent", async () => {
    const res = await me();
    expect(res.statusCode).toBe(401);
    expect(res.headers["www-authenticate"]).toBe("Bearer");
    expect(res.json().error).toMatchObject({ code: "unauthorized", message: "Missing bearer token." });
  });

  it("says when a token has expired", async () => {
    const res = await me(`Bearer ${await token({}, { exp: Math.floor(Date.now() / 1000) - 60 })}`);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe("Token expired.");
  });

  it.each([
    ["a token from another project", async () => token({}, { issuer: "https://evil.supabase.co/auth/v1" })],
    ["a token for another audience", async () => token({ aud: "service_role" })],
    ["a token signed with someone else's key", async () => token({}, { key: otherKey })],
    ["a non-UUID subject", async () => token({ sub: "admin" })],
    ["garbage", async () => "not.a.jwt"],
  ])("rejects %s", async (_name, make) => {
    const res = await me(`Bearer ${await make()}`);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe("Invalid token.");
  });

  it("rejects a token signed with a shared secret (HS256)", async () => {
    const hs = await new SignJWT({ aud: "authenticated" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(ISSUER)
      .setSubject(randomUUID())
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-guessable-secret-that-is-long-enough"));
    const res = await me(`Bearer ${hs}`);
    expect(res.statusCode).toBe(401);
  });

  it("returns 503, not 401, when the signing keys can't be fetched", async () => {
    const down: JWTVerifyGetKey = async () => {
      throw new errors.JWKSTimeout();
    };
    const res = await me(`Bearer ${await token()}`, down);
    expect(res.statusCode).toBe(503);
    expect(res.headers["www-authenticate"]).toBeUndefined();
  });
});
