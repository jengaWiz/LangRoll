// Scene picker: a local page for turning candidate videos into watch clips. Play a video, tap when
// a line starts and ends, type the line, and the pick is saved to scripts/scene-picks.json, ready to
// become a clip in apps/web/content.js. Only someone watching can find the line: the videos have no
// captions we're allowed to read.
//
//   npm run scenes        then open http://localhost:8091
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const PAGE = here("scene-picker.html");
const CANDIDATES = here("scene-candidates.json");
const PICKS = here("scene-picks.json");
const PORT = Number(process.env.PORT) || 8091;

async function readPicks() {
  try {
    return JSON.parse(await readFile(PICKS, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

// What a pick needs before it can become a clip; the content tests check the rest.
function problem(p) {
  if (!/^[\w-]{11}$/.test(p?.video ?? "")) return "video id";
  if (!(p.start >= 0 && p.end > p.start)) return "the line must end after it starts";
  if (p.end - p.start > 30) return "a line can be at most 30 seconds";
  if (typeof p.line !== "string" || !p.line.trim() || p.line.length > 85) return "type the line (at most 85 characters)";
  return null;
}

async function body(req) {
  let s = "";
  for await (const chunk of req) {
    s += chunk;
    if (s.length > 10_000) throw new Error("too large");
  }
  return JSON.parse(s);
}

const send = (res, status, data, type = "application/json") =>
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" }).end(type === "application/json" ? JSON.stringify(data) : data);

createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (req.method === "GET" && pathname === "/") return send(res, 200, await readFile(PAGE), "text/html; charset=utf-8");
    if (req.method === "GET" && pathname === "/candidates") return send(res, 200, JSON.parse(await readFile(CANDIDATES, "utf8")));
    if (req.method === "GET" && pathname === "/picks") return send(res, 200, await readPicks());
    if (req.method === "POST" && pathname === "/picks") {
      const p = await body(req);
      const why = problem(p);
      if (why) return send(res, 400, { error: why });
      const picks = await readPicks();
      const pick = {
        video: p.video, start: Math.round(p.start * 10) / 10, end: Math.round(p.end * 10) / 10,
        line: p.line.trim(), meaning: String(p.meaning ?? "").trim(), note: String(p.note ?? "").trim(), at: new Date().toISOString(),
      };
      picks.push(pick);
      await writeFile(PICKS, JSON.stringify(picks, null, 2) + "\n");
      return send(res, 201, pick);
    }
    if (req.method === "DELETE" && pathname.startsWith("/picks/")) {
      const i = Number(pathname.slice(7));
      const picks = await readPicks();
      if (!Number.isInteger(i) || !picks[i]) return send(res, 404, { error: "no such pick" });
      picks.splice(i, 1);
      await writeFile(PICKS, JSON.stringify(picks, null, 2) + "\n");
      return send(res, 200, picks);
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Scene picker: http://localhost:${PORT}`));
