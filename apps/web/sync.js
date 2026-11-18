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
    if (!res.ok) throw new Error(`${method} ${path} failed with ${res.status}`);
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

  return { enabled, signIn, api, saveProfile };
})();
