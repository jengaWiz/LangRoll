import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "../../src/migrate.js";

async function dirWith(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "langroll-migrations-"));
  for (const [name, sql] of Object.entries(files)) await writeFile(join(dir, name), sql);
  return dir;
}

describe("loadMigrations", () => {
  it("loads .sql files in version order and ignores other files", async () => {
    const dir = await dirWith({ "0002_b.sql": "select 2;", "0001_a.sql": "select 1;", "README.md": "notes" });
    const found = await loadMigrations(dir);
    expect(found.map((m) => [m.version, m.name, m.sql])).toEqual([
      [1, "a", "select 1;"],
      [2, "b", "select 2;"],
    ]);
    expect(found[0]!.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects badly named files", async () => {
    await expect(loadMigrations(await dirWith({ "1_a.sql": "" }))).rejects.toThrow(/NNNN_short_name/);
    await expect(loadMigrations(await dirWith({ "0001_Add-Users.sql": "" }))).rejects.toThrow(/NNNN_short_name/);
  });

  it("rejects two files with the same version", async () => {
    await expect(loadMigrations(await dirWith({ "0001_a.sql": "", "0001_b.sql": "" }))).rejects.toThrow(/share version 0001/);
  });
});
