// Applies pending migrations to DATABASE_URL: npm run db:migrate
// Run it before starting a new version of the API, so the schema is always ahead of the code.
import { createPool } from "./db.js";
import { loadMigrations, migrate } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

// One level up from both src/ (tsx) and dist/ (built).
const dir = new URL("../migrations/", import.meta.url);
const pool = createPool(url, { caFile: process.env.DATABASE_CA });
try {
  const applied = await migrate(pool, await loadMigrations(dir));
  console.log(applied.length ? `applied ${applied.join(", ")}` : "database is up to date");
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
