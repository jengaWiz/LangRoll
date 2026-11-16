import { z } from "zod";

// Every setting the API reads from the environment, validated once at startup so a
// missing or malformed value fails the deploy instead of a request at 3am.
const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Postgres connection string. On Supabase use the pooler URL with ?sslmode=require.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgres:// connection string" }),
  // Reported by /health so we can tell which build is running. CI sets it to the commit SHA.
  APP_VERSION: z.string().min(1).default("dev"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
