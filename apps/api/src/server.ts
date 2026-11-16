import { buildApp } from "./app.js";
import { supabaseVerifier } from "./auth.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const pool = createPool(config.DATABASE_URL);
const app = buildApp(config, { db: pool, verifyToken: supabaseVerifier(config.SUPABASE_URL) });

// An idle connection dropping (e.g. a database restart) must not crash the process.
pool.on("error", (err) => app.log.error({ err }, "idle database connection failed"));
app.addHook("onClose", async () => {
  await pool.end();
});

// Finish in-flight requests before exiting when the host stops or redeploys us.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down");
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, "shutdown failed");
        process.exit(1);
      },
    );
  });
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.error({ err }, "failed to start");
  process.exit(1);
}
