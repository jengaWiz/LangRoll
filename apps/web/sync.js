// Talks to the LangRoll API.
//
// Optional by design: with no API configured, no network, or a failed sign-in, the app keeps
// working from localStorage exactly as before, and the next call simply tries again.
const Sync = (() => {
  const enabled = Boolean(CONFIG.apiUrl && window.supabase);
  let client = null;
  let pending = null;

  function auth() {
    if (!client) {
      client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
        auth: { storageKey: "langroll:auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
    }
    return client.auth;
  }

  // Everyone starts as a guest: a real (anonymous) Supabase account, created silently on first
  // launch, so progress has an owner from the first tap and survives an upgrade to a full account.
  async function session() {
    const { data, error } = await auth().getSession();
    if (error) throw error; // a stored session we can't read: don't replace it with a new guest
    if (data.session) return data.session;
    const created = await auth().signInAnonymously();
    if (created.error) throw created.error;
    return created.data.session;
  }

  // One sign-in at a time; a failure is forgotten so the next call retries.
  function signIn() {
    if (!enabled) return Promise.resolve(null);
    if (!pending) pending = session().finally(() => { pending = null; });
    return pending;
  }

  async function api(method, path, body) {
    const s = await signIn();
    if (!s) return null;
    const res = await fetch(CONFIG.apiUrl + path, {
      method,
      headers: { authorization: `Bearer ${s.access_token}`, ...(body && { "content-type": "application/json" }) },
      body: body && JSON.stringify(body),
    });
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} failed with ${res.status}`), { status: res.status });
    return res.json();
  }

  // The learner's settings, so the server scores their days in their own timezone.
  function saveProfile({ lang, goal }) {
    return api("PATCH", "/me", {
      ...(lang && { learningLang: lang }),
      dailyGoalXp: goal,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }

  // ---- Outbox: what the learner did, kept on the phone until the server has it ----
  //
  // Every action is stored first, with an id made here, then uploaded in batches. An event
  // leaves the outbox only once the server answers for it (accepted, a duplicate of an earlier
  // upload, or permanently rejected), so nothing is lost offline and retries never double-count.
  const OUTBOX = "langroll:outbox";
  const MAX_QUEUED = 1000; // about a month of heavy use; the server refuses anything older anyway
  const BATCH = 100; // the API's limit per request
  const RETRY_MAX_MS = 5 * 60 * 1000;

  function readOutbox() {
    try { return JSON.parse(localStorage.getItem(OUTBOX)) || []; } catch (e) { return []; }
  }
  function writeOutbox(events) {
    try { localStorage.setItem(OUTBOX, JSON.stringify(events)); } catch (e) { /* storage full or blocked */ }
  }

  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    // Safari before 15.4
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function record(kind, clipId, payload = {}) {
    if (!enabled) return;
    const events = readOutbox();
    events.push({ id: newId(), kind, clipId, occurredAt: new Date().toISOString(), payload });
    writeOutbox(events.slice(-MAX_QUEUED));
    scheduleFlush(2000);
  }

  let timer = null;
  let flushing = null;
  let retryMs = 5000;

  function scheduleFlush(delay) {
    clearTimeout(timer);
    timer = setTimeout(() => { flush().catch(() => {}); }, delay);
  }

  // Uploads the outbox, oldest first. Safe to call any time; concurrent calls share one run.
  function flush() {
    if (!enabled) return Promise.resolve();
    if (!flushing) flushing = upload().finally(() => { flushing = null; });
    return flushing;
  }

  async function upload() {
    for (;;) {
      const batch = readOutbox().slice(0, BATCH);
      if (!batch.length) return;
      let settled;
      try {
        const res = await api("POST", "/events", { events: batch });
        settled = new Set([...res.accepted, ...res.duplicates, ...res.rejected.map((r) => r.id)]);
        retryMs = 5000;
      } catch (err) {
        if (err.status === 400) {
          // A malformed batch is a bug in this app; retrying would block the outbox forever.
          console.warn("sync: dropping events the server can't read:", err.message);
          settled = new Set(batch.map((e) => e.id));
        } else {
          // Offline, signed out, rate limited or a server error: keep everything and back off.
          scheduleFlush(retryMs);
          retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
          throw err;
        }
      }
      // Re-read, so events recorded during the upload aren't lost.
      writeOutbox(readOutbox().filter((e) => !settled.has(e.id)));
    }
  }

  if (enabled) {
    addEventListener("online", () => flush().catch(() => {}));
    document.addEventListener("visibilitychange", () => { if (document.hidden) flush().catch(() => {}); });
    setInterval(() => flush().catch(() => {}), 60 * 1000);
    scheduleFlush(1000);
  }

  // The server's view of this learner, or null when it can't be trusted yet: until everything
  // recorded here is uploaded, the server is missing some of it and would roll the screen back.
  async function pull() {
    if (!enabled) return null;
    await flush();
    if (readOutbox().length) return null;
    const [progress, deck] = await Promise.all([api("GET", "/me/progress"), api("GET", "/me/cards")]);
    if (readOutbox().length) return null; // the learner did something meanwhile; next time
    return { progress, cards: deck.cards };
  }

  return { enabled, signIn, api, saveProfile, record, flush, pull, pending: () => readOutbox().length };
})();
