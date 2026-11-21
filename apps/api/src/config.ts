import { z } from "zod";

// Every setting the API reads from the environment, validated once at startup so a
// missing or malformed value fails the deploy instead of a request at 3am.
// A comma-separated list of exact origins, e.g. "https://jengawiz.github.io,http://localhost:4173".
const origins = z
  .string()
  .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean))
  .pipe(
    z.array(
      z.string().refine((o) => {
        try {
          return new URL(o).origin === o;
        } catch {
          return false;
        }
      }, "each entry must be an origin like https://example.com, with no path or trailing slash"),
    ),
  );

const Env = z
  .object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Postgres connection string. On Supabase use the session pooler URL (port 5432).
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgres:// connection string" }),
  // CA certificate (PEM file) to verify the database's TLS certificate against. In production on
  // Supabase: certs/supabase-prod-ca-2021.crt. Unset means no TLS (local Postgres).
  DATABASE_CA: z.string().min(1).optional(),
  // Reported by /health so we can tell which build is running. CI sets it to the commit SHA.
  APP_VERSION: z.string().min(1).default("dev"),
  // Supabase project URL, e.g. https://abcd.supabase.co. Tokens are checked against its public keys.
  SUPABASE_URL: z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }),
  // Web pages allowed to call the API from a browser. Defaults to the local preview server.
  CORS_ORIGINS: origins.default(["http://127.0.0.1:4173", "http://localhost:4173"]),
  // How many proxies sit in front of the API (the host's load balancer is usually 1), so the
  // client IP for rate limiting comes from X-Forwarded-For. 0 trusts no proxy headers.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // Azure AI Speech, for scoring pronunciation in speaking practice. Without a key, the endpoint
  // answers 503 and the app uses the phone's own speech recognition.
  AZURE_SPEECH_KEY: z.string().min(1).optional(),
  AZURE_SPEECH_REGION: z.string().regex(/^[a-z0-9]+$/, "must be an Azure region like eastus").default("eastus"),
})
  .refine((env) => env.NODE_ENV !== "production" || env.SUPABASE_URL.startsWith("https://"), {
    path: ["SUPABASE_URL"],
    message: "must use https in production",
  })
  .refine((env) => env.NODE_ENV !== "production" || env.CORS_ORIGINS.every((o) => o.startsWith("https://")), {
    path: ["CORS_ORIGINS"],
    message: "must all use https in production",
  });

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
