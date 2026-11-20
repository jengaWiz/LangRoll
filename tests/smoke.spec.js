/* global Sync, clipById -- the app's globals, used only inside page.evaluate callbacks */
import { expect, test } from "@playwright/test";

// Fail on any JS error, console error, or broken same-origin request.
// Third-party requests (Google Fonts, jsDelivr) are ignored so CI isn't flaky on the network.
function watchForErrors(page) {
  const problems = [];
  page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/fonts\.(googleapis|gstatic)|jsdelivr/.test(msg.text())) {
      problems.push(`console error: ${msg.text()}`);
    }
  });
  page.on("response", (res) => {
    if (res.url().startsWith("http://127.0.0.1") && res.status() >= 400) {
      problems.push(`HTTP ${res.status()}: ${res.url()}`);
    }
  });
  return problems;
}

async function expectNoSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page should not scroll sideways").toBeLessThanOrEqual(1);
}

test.describe("landing page", () => {
  test("loads without errors and fits the screen", async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("fluent");
    await expect(page.locator("#feed .clip.active")).toHaveCount(1);
    await expectNoSideScroll(page);
    expect(problems).toEqual([]);
  });

  test("phone feed quiz responds to a correct answer", async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto("/");
    const quiz = page.locator("#feed .clip.quiz");
    await quiz.scrollIntoViewIfNeeded();
    await page.locator("#feed").evaluate((feed) => {
      const quizEl = feed.querySelector(".clip.quiz");
      feed.scrollTo({ top: quizEl.offsetTop, behavior: "instant" });
    });
    await quiz.locator('.opt[data-v="sur"]').click();
    await expect(quiz.locator(".quiz-result")).toContainText("Correct");
    expect(problems).toEqual([]);
  });

  test("download buttons point somewhere real", async ({ page }) => {
    await page.goto("/");
    for (const href of await page.locator("a.btn").evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
      expect(href, "button link").toBeTruthy();
    }
  });
});

test.describe("presenter page", () => {
  test("shows the QR code and the typed URL", async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto("/present/");
    const qr = page.locator(".qr img");
    await expect(qr).toBeVisible();
    expect(await qr.evaluate((img) => img.complete && img.naturalWidth > 0), "QR image loaded").toBe(true);
    await expect(page.locator(".url")).toContainText("jengawiz.github.io/LangRoll/app");
    await expectNoSideScroll(page);
    expect(problems).toEqual([]);
  });
});

test.describe("app", () => {

  test("onboarding leads to a working feed", async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto("/app/");
    await page.locator("#lang-grid button").first().click();
    await page.locator("#goal-row button").first().click();
    await page.locator("#start").click();
    await expect(page.locator("#feed-screen")).toBeVisible();
    await expect(page.locator("#feed .clip").first()).toBeVisible();
    await expectNoSideScroll(page);

    await page.locator('#tabbar [data-screen="deck"]').click();
    await expect(page.locator("#deck-screen")).toBeVisible();
    await page.locator('#tabbar [data-screen="me"]').click();
    await expect(page.locator("#me-screen")).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("offers the launch languages, and sends a retired one back to the picker", async ({ page }) => {
    const problems = watchForErrors(page);
    // Someone who picked Italian before it was retired, with progress saved on their phone.
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("langroll:v1", JSON.stringify({ v: 1, lang: "it", goal: 60, xp: 40 }));
        sessionStorage.setItem("seeded", "1");
      }
    });
    await page.goto("/app/");
    await expect(page.locator("#onboard")).toBeVisible();
    await expect(page.locator("#lang-grid button")).toHaveText([/Spanish/, /French/, /Japanese/]);
    await onboard(page);
    expect(problems).toEqual([]);
  });

  test("privacy page loads, fits the screen and links back to the app", async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto("/app/privacy.html");
    await expect(page.locator("h1")).toHaveText("Privacy");
    await expect(page.locator("text=Delete my data").first()).toBeVisible();
    await expectNoSideScroll(page);
    await page.locator("a.back").click();
    await expect(page).toHaveURL(/\/app\/$/);
    expect(problems).toEqual([]);
  });

  test("flip cards show the word before the answer", async ({ page }) => {
    await page.goto("/app/");
    await onboard(page);
    const card = await scrollToKind(page, "flip");
    const visible = (face) => card.locator(face).evaluate((el) => getComputedStyle(el).visibility);
    expect(await visible(".front")).toBe("visible");
    expect(await visible(".back")).toBe("hidden");
    await card.locator(".flip-card").click();
    await expect.poll(() => visible(".back")).toBe("visible");
    await expect.poll(() => visible(".front")).toBe("hidden");
  });

  test.describe("speech", () => {
    // Headless browsers have no voices or mic, so swap in fakes that record calls and fail on demand.
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        // micError: fail with this error. promptMs: delay before the mic opens (a permission prompt).
        // say: transcript to "hear" once the mic is open.
        const calls = (window.__speech = { spoken: [], idleCancels: 0, micError: null, promptMs: 0, say: null });
        let speaking = false;
        const fake = (name, value) => Object.defineProperty(window, name, { value, configurable: true, writable: true });
        fake("speechSynthesis", {
          get speaking() { return speaking; },
          pending: false,
          getVoices: () => [],
          addEventListener() {},
          speak(u) {
            calls.spoken.push({ text: u.text, lang: u.lang });
            speaking = true;
            setTimeout(() => u.onstart?.(), 10);
            setTimeout(() => { speaking = false; }, 300);
          },
          cancel() { if (!speaking) calls.idleCancels++; speaking = false; },
          resume() {},
        });
        fake("SpeechSynthesisUtterance", function (text) { this.text = text; });
        // Like the real API, stop() ends the session, and stopping before the mic opens hears nothing.
        function FakeRecognition() {
          let ended = false;
          const end = () => { if (!ended) { ended = true; this.onend?.(); } };
          this.start = () => setTimeout(() => {
            if (calls.micError) { this.onerror?.({ error: calls.micError }); end(); return; }
            setTimeout(() => {
              if (ended) return;
              this.onaudiostart?.();
              if (!calls.say) return end();
              setTimeout(() => {
                if (ended) return;
                this.onresult?.({ results: [[{ transcript: calls.say }]] });
                end();
              }, 50);
            }, calls.promptMs);
          }, 20);
          this.stop = end;
          this.abort = () => { ended = true; };
        }
        fake("SpeechRecognition", FakeRecognition);
        fake("webkitSpeechRecognition", FakeRecognition);
      });
      await page.goto("/app/");
      await onboard(page);
    });

    test("Hear it plays in the clip's language without cancelling first", async ({ page }) => {
      const clip = await scrollToKind(page, "vocab");
      await clip.locator(".play").click();
      const { spoken, idleCancels } = await page.evaluate(() => window.__speech);
      expect(spoken.at(-1)).toEqual({ text: await clip.locator(".clip-big").textContent(), lang: "es-MX" });
      expect(idleCancels, "cancel() on an idle engine can swallow the next utterance").toBe(0);
    });

    test("a blocked mic explains itself and offers self-rating", async ({ page }) => {
      await page.evaluate(() => { window.__speech.micError = "not-allowed"; });
      const clip = await scrollToKind(page, "speak");
      await clip.locator(".mic").click();
      await expect(clip.locator(".mic-hint")).toContainText("mic blocked");
      await expect(clip.locator(".self-rate")).toBeVisible();
      await clip.locator('.self-rate [data-rate="good"]').click();
      await expect(clip).toHaveClass(/scored/);
    });

    test("a slow permission prompt doesn't use up the listening time", async ({ page }) => {
      const clip = await scrollToKind(page, "speak");
      const line = await clip.locator(".speak-line").textContent();
      // iOS Safari asks for the mic on every visit; answering it takes longer than the 6s recording window
      await page.evaluate((say) => Object.assign(window.__speech, { promptMs: 6500, say }), line);
      await clip.locator(".mic").click();
      // Generous: the fake prompt alone takes 6.5s, and timers drift on a busy CI machine.
      await expect(clip.locator(".mic-hint")).toContainText("heard:", { timeout: 20000 });
      await expect(clip).toHaveClass(/scored/);
    });

    test("silence asks to try again instead of failing", async ({ page }) => {
      await page.evaluate(() => { window.__speech.micError = "no-speech"; });
      const clip = await scrollToKind(page, "speak");
      await clip.locator(".mic").click();
      await expect(clip.locator(".mic-hint")).toContainText("didn't hear anything");
      await expect(clip.locator(".self-rate")).toBeHidden();
    });
  });

  test.describe("sync", () => {
    // Once the service worker controls the page, WebKit sends requests through it where
    // page.route can't intercept them. The worker has its own tests (sw.spec.js).
    test.use({ serviceWorkers: "block" });

    // Fake hosts on purpose: if interception ever failed, requests would go nowhere rather than
    // creating users in the real Supabase project.
    const SUPABASE = "http://supabase.test";
    const API = "http://api.test";
    const USER = "11111111-2222-4333-8444-555555555555";
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const exp = () => Math.floor(Date.now() / 1000) + 3600;
    const jwt = () => `${b64({ alg: "ES256", typ: "JWT" })}.${b64({ sub: USER, aud: "authenticated", exp: exp(), is_anonymous: true })}.sig`;
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type,apikey,x-client-info,x-supabase-api-version", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS" };

    // A stand-in Supabase and API that record what the app sends.
    // `events(batch, n)` decides each POST /events reply; by default everything is accepted.
    const today = () => new Date().toLocaleDateString("en-CA");
    const noProgress = () => ({ totalXp: 0, today: { day: today(), xp: 0, goalXp: 30, goalHit: false }, streak: { current: 0, longest: 0 } });

    async function fakeBackend(page, { signupFails = false, events, progress = noProgress, cards = () => [], deleteStatus = 204 } = {}) {
      const calls = { signups: 0, profiles: [], uploads: [], pulls: 0, feedback: [], deletes: [] };
      await page.route(`${SUPABASE}/auth/v1/**`, async (route) => {
        if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        if (!route.request().url().includes("/signup")) return route.fulfill({ status: 404, headers: cors, json: {} });
        calls.signups++;
        if (signupFails) return route.fulfill({ status: 500, headers: cors, json: { message: "down" } });
        const token = jwt();
        return route.fulfill({
          headers: cors,
          json: {
            access_token: token, token_type: "bearer", expires_in: 3600, expires_at: exp(), refresh_token: "r1",
            user: { id: USER, aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
          },
        });
      });
      await page.route(`${API}/**`, async (route) => {
        const req = route.request();
        if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        if (req.method() === "PATCH" && req.url().endsWith("/me")) {
          calls.profiles.push({ auth: req.headers().authorization, body: req.postDataJSON() });
          return route.fulfill({ headers: cors, json: { id: USER } });
        }
        if (req.method() === "POST" && req.url().endsWith("/feedback")) {
          calls.feedback.push(req.postDataJSON());
          return route.fulfill({ status: 201, headers: cors, json: { id: USER } });
        }
        if (req.method() === "DELETE" && req.url().endsWith("/me")) {
          calls.deletes.push(req.headers().authorization);
          return route.fulfill({ status: deleteStatus, headers: cors, ...(deleteStatus !== 204 && { json: {} }) });
        }
        if (req.method() === "GET" && req.url().endsWith("/me/progress")) {
          calls.pulls++;
          return route.fulfill({ headers: cors, json: progress() });
        }
        if (req.method() === "GET" && req.url().endsWith("/me/cards")) {
          return route.fulfill({ headers: cors, json: { cards: cards() } });
        }
        if (req.method() === "POST" && req.url().endsWith("/events")) {
          const batch = req.postDataJSON().events;
          calls.uploads.push(batch);
          const reply = events?.(batch, calls.uploads.length) ?? { status: 200 };
          const json = reply.json ?? { accepted: batch.map((e) => e.id), duplicates: [], rejected: [] };
          return route.fulfill({ status: reply.status, headers: cors, json });
        }
        return route.fulfill({ status: 404, headers: cors, json: {} });
      });
      await page.addInitScript(([api, supabase]) => {
        localStorage.setItem("langroll:api", api);
        localStorage.setItem("langroll:supabase", supabase);
      }, [API, SUPABASE]);
      return calls;
    }

    test("signs in as a guest once and saves the learner's profile", async ({ page }) => {
      const problems = watchForErrors(page);
      const calls = await fakeBackend(page);
      await page.goto("/app/");
      await onboard(page);
      await expect.poll(() => calls.profiles.length).toBe(1);
      expect(calls.signups).toBe(1);
      expect(calls.profiles[0].auth).toMatch(/^Bearer ey/);
      expect(calls.profiles[0].body).toEqual({ learningLang: "es", dailyGoalXp: 30, timezone: expect.any(String) });

      // Coming back reuses the stored session instead of creating a second guest.
      await page.reload();
      await expect.poll(() => calls.profiles.length).toBe(2);
      expect(calls.signups).toBe(1);
      // WebKit reports an upload cut off by the reload as an access-control error; the app handles it.
      expect(problems.filter((p) => !/api\.test\/events due to access control checks/.test(p))).toEqual([]);
    });

    test("keeps working when sign-in fails", async ({ page }) => {
      const problems = watchForErrors(page);
      const calls = await fakeBackend(page, { signupFails: true });
      await page.goto("/app/");
      await onboard(page);
      await expect.poll(() => calls.signups).toBeGreaterThan(0);
      await expect(page.locator("#feed .clip.active")).toHaveCount(1);
      expect(calls.profiles).toEqual([]);
      // The browser itself logs the forced 500; anything else is a real problem.
      expect(problems.filter((p) => !p.includes("Failed to load resource"))).toEqual([]);
    });

    const answerQuiz = async (page) => {
      const quiz = await scrollToKind(page, "quiz");
      const answer = await quiz.evaluate((el) => clipById(el.dataset.id).answer);
      await quiz.locator(`.opt[data-v="${answer}"]`).click();
      return quiz.getAttribute("data-id");
    };
    const outbox = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("langroll:outbox") || "[]"));

    test("uploads what the learner does and empties the outbox", async ({ page }) => {
      const calls = await fakeBackend(page);
      await page.goto("/app/");
      await onboard(page);
      const clipId = await answerQuiz(page);
      await page.evaluate(() => Sync.flush());
      const sent = calls.uploads.flat();
      expect(sent).toContainEqual(
        expect.objectContaining({ kind: "quiz_answered", clipId, payload: { firstTry: true }, id: expect.stringMatching(/^[0-9a-f-]{36}$/) }),
      );
      expect(Date.parse(sent.find((e) => e.kind === "quiz_answered").occurredAt)).toBeGreaterThan(Date.now() - 60_000);
      expect(await outbox(page)).toEqual([]);
    });

    test("keeps events through failures and a reload, then sends them with the same ids", async ({ page }) => {
      let down = true;
      const calls = await fakeBackend(page, { events: () => (down ? { status: 503, json: {} } : undefined) });
      await page.goto("/app/");
      await onboard(page);
      await answerQuiz(page);
      await page.evaluate(() => Sync.flush().catch(() => {}));
      const queued = await outbox(page);
      expect(queued.some((e) => e.kind === "quiz_answered")).toBe(true);

      await page.reload();
      // Still queued after the reload (the reopened feed may add new events of its own).
      expect(await outbox(page)).toEqual(expect.arrayContaining(queued));
      down = false;
      await page.evaluate(() => Sync.flush());
      const resent = calls.uploads.at(-1).map((e) => e.id);
      expect(resent).toEqual(expect.arrayContaining(queued.map((e) => e.id)));
      expect(await outbox(page)).toEqual([]);
    });

    test("drops a batch the server says is malformed instead of retrying forever", async ({ page }) => {
      await fakeBackend(page, { events: () => ({ status: 400, json: { error: { code: "invalid_request" } } }) });
      await page.goto("/app/");
      await onboard(page);
      await answerQuiz(page);
      await page.evaluate(() => Sync.flush());
      expect(await outbox(page)).toEqual([]);
    });

    // A learner who already used the app, with progress saved on this phone.
    const returning = (page, extra = {}) =>
      page.addInitScript((s) => {
        if (!sessionStorage.getItem("seeded")) {
          localStorage.setItem("langroll:v1", JSON.stringify(s));
          sessionStorage.setItem("seeded", "1");
        }
      }, { v: 1, lang: "es", goal: 30, xp: 99999, today: { day: today(), xp: 999, goalHit: true }, streak: { count: 400, last: today() }, cards: {}, saved: [], ...extra });

    test("shows the server's XP, streak and deck, not what's stored on the phone", async ({ page }) => {
      await returning(page);
      const due = new Date(Date.now() - 60_000).toISOString();
      await fakeBackend(page, {
        progress: () => ({ totalXp: 120, today: { day: today(), xp: 20, goalXp: 30, goalHit: false }, streak: { current: 4, longest: 9 } }),
        cards: () => [{ clipId: "es-v1", dueAt: due, intervalDays: 3, reps: 2, lapses: 0 }],
      });
      await page.goto("/app/");
      await expect(page.locator("#streak")).toHaveText("4");
      await expect(page.locator("#xp-today")).toHaveText("20");
      await expect(page.locator("#review-count")).toHaveText("1");
      await page.locator('#tabbar button[data-screen="me"]').click();
      await expect(page.locator("#me-stats")).toContainText("120");
    });

    test("doesn't take the server's numbers while uploads are still pending", async ({ page }) => {
      const calls = await fakeBackend(page, { events: () => ({ status: 503, json: {} }) });
      await page.goto("/app/");
      await onboard(page);
      const pullsBefore = calls.pulls; // onboarding may pull once, before anything is pending
      await answerQuiz(page);
      await page.evaluate(() => Sync.pull().catch(() => null));
      await expect(page.locator("#xp-today")).toHaveText("10");
      expect(calls.pulls).toBe(pullsBefore);
    });

    test("carries an existing deck over to the account once", async ({ page }) => {
      await returning(page, { cards: { "es-v1": { id: "es-v1", due: 0, interval: 1, ease: 2.5, reps: 1, lapses: 0 }, "it-v1": { id: "it-v1" } }, saved: ["es-q1"] });
      const calls = await fakeBackend(page);
      await page.goto("/app/");
      await expect(page.locator("#toast")).toContainText("syncs to your account");
      await page.evaluate(() => Sync.flush());
      const sent = () => calls.uploads.flat().map((e) => `${e.kind} ${e.clipId}`);
      expect(sent()).toEqual(expect.arrayContaining(["clip_viewed es-v1", "clip_saved es-q1"]));
      expect(sent()).not.toContain("clip_viewed it-v1"); // retired language: nothing to sync
      const before = calls.uploads.flat().filter((e) => e.kind === "clip_saved").length;

      await page.reload();
      await page.evaluate(() => Sync.flush());
      expect(calls.uploads.flat().filter((e) => e.kind === "clip_saved").length).toBe(before);
    });

    const openYou = (page) => page.locator('#tabbar button[data-screen="me"]').click();

    test("sends feedback with the app version and device type", async ({ page }) => {
      const calls = await fakeBackend(page);
      await page.goto("/app/");
      await onboard(page);
      await openYou(page);
      await page.locator("#feedback-open").click();
      await expect(page.locator("#feedback")).toBeVisible();
      await page.locator("#feedback-text").fill("  The Japanese clip played the Spanish voice  ");
      await page.locator("#feedback-send").click();
      await expect(page.locator("#toast")).toContainText("Thanks");
      await expect(page.locator("#feedback")).toBeHidden();
      expect(calls.feedback).toEqual([
        { message: "The Japanese clip played the Spanish voice", appVersion: expect.stringMatching(/^app-v\d+$/), platform: expect.stringMatching(/^\w+ \w+/) },
      ]);
    });

    test("deletes the data on the server first, then forgets the account on this phone", async ({ page }) => {
      const calls = await fakeBackend(page);
      await page.goto("/app/");
      await onboard(page);
      await answerQuiz(page);
      await openYou(page);
      page.once("dialog", (d) => d.accept());
      await page.locator("#reset").click();
      await expect(page.locator("#onboard")).toBeVisible();
      expect(calls.deletes).toEqual([expect.stringMatching(/^Bearer /)]);
      const left = await page.evaluate(() => ["langroll:v1", "langroll:auth", "langroll:outbox"].map((k) => localStorage.getItem(k)));
      // After the reload the app may already have saved a fresh, empty state; the old progress must be gone.
      expect(left[0] === null || JSON.parse(left[0]).xp === 0).toBe(true);
      expect(left[1]).toBeNull();
      expect(left[2] === null || JSON.parse(left[2]).length === 0).toBe(true);
    });

    test("deletes nothing if the server can't be reached", async ({ page }) => {
      const calls = await fakeBackend(page, { deleteStatus: 503 });
      await page.goto("/app/");
      await onboard(page);
      await openYou(page);
      page.once("dialog", (d) => d.accept());
      await page.locator("#reset").click();
      await expect(page.locator("#toast")).toContainText("nothing was deleted");
      expect(calls.deletes).toHaveLength(1);
      const kept = await page.evaluate(() => [JSON.parse(localStorage.getItem("langroll:v1")).lang, localStorage.getItem("langroll:auth") !== null]);
      expect(kept).toEqual(["es", true]);
    });

    test("never contacts the backend from a local preview", async ({ page }) => {
      const external = [];
      page.on("request", (r) => { if (/supabase\.co|fly\.dev/.test(r.url())) external.push(r.url()); });
      await page.goto("/app/");
      await onboard(page);
      await page.waitForTimeout(500);
      expect(external).toEqual([]);
    });
  });

  test.describe("on a 4-inch phone", () => {
    test.use({ viewport: { width: 320, height: 568 } });

    test("every clip kind fits above its caption", async ({ page }) => {
      await page.goto("/app/");
      await onboard(page);
      const seen = new Set();
      for (let i = 0; i < 20 && seen.size < 5; i++) {
        await page.locator("#feed").evaluate((f, i) => f.scrollTo({ top: f.children[i].offsetTop, behavior: "instant" }), i);
        const clip = page.locator(`#feed > :nth-child(${i + 1})`);
        await expect(clip).toHaveClass(/\bactive\b/);
        const { kind, overlap } = await clip.evaluate(async (el) => {
          // content slides up as a clip becomes active; measure where it settles
          for (let moving; (moving = el.getAnimations({ subtree: true }).filter((a) => a instanceof CSSTransition)).length;) {
            await Promise.all(moving.map((a) => a.finished.catch(() => {})));
          }
          const meta = el.querySelector(".clip-meta").getBoundingClientRect();
          const bottoms = [...el.querySelectorAll(".clip-body *")].map((c) => c.getBoundingClientRect()).filter((r) => r.height).map((r) => r.bottom);
          return { kind: el.dataset.kind, overlap: Math.max(...bottoms) - meta.top };
        });
        seen.add(kind);
        expect(overlap, `${kind} clip runs into its caption`).toBeLessThanOrEqual(1);
      }
      expect(seen.size, "saw every clip kind").toBe(5);
    });
  });
});

async function onboard(page) {
  await page.locator("#lang-grid button").first().click();
  await page.locator("#goal-row button").first().click();
  await page.locator("#start").click();
  await expect(page.locator("#feed .clip.active")).toHaveCount(1);
}

// Scroll the feed until a clip of this kind is active (the feed is shuffled, so keep loading).
async function scrollToKind(page, kind) {
  for (let n = 0; n < 12; n++) {
    const i = await page.locator("#feed").evaluate((f, kind) => [...f.children].findIndex((c) => c.dataset.kind === kind), kind);
    const target = i >= 0 ? i : await page.locator("#feed").evaluate((f) => f.children.length - 1);
    await page.locator("#feed").evaluate((f, i) => f.scrollTo({ top: f.children[i].offsetTop, behavior: "instant" }), target);
    if (i >= 0) {
      const clip = page.locator(`#feed .clip.active[data-kind="${kind}"]`);
      await expect(clip).toHaveCount(1);
      return clip;
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`no ${kind} clip in the feed`);
}
