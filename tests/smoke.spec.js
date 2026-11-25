/* global Sync, clipById, LANGS, state, renderContent, setActive, observer, nextItem, Watch, Recorder, dealScenes, dealCourse, shuffle -- the app's globals, used only inside page.evaluate callbacks */
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
  // Spanish has real scenes, so any test can scroll into one: YouTube is stood in for throughout.
  test.beforeEach(async ({ page }) => { await fakeYouTubeNetwork(page); });

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
    // flips are in a later unit than a new learner's feed starts with, so lay one out directly
    await layFeed(page, [await page.evaluate(() => LANGS.es.clips.find((c) => c.kind === "flip").id)]);
    const card = page.locator('#feed .clip.active[data-kind="flip"]');
    const visible = (face) => card.locator(face).evaluate((el) => getComputedStyle(el).visibility);
    expect(await visible(".front")).toBe("visible");
    expect(await visible(".back")).toBe("hidden");
    await card.locator(".flip-card").click();
    await expect.poll(() => visible(".back")).toBe("visible");
    await expect.poll(() => visible(".front")).toBe("hidden");
  });

  // An iPhone's Home Screen app keeps its own storage, so the card comes early in a visit, and
  // "Not now" keeps it away for a few days.
  test("shows iPhone users how to add the app to the Home Screen, until they say not now", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "iphone", "the iPhone steps; Chrome's own install prompt can't be faked here");
    const problems = watchForErrors(page);
    await page.goto("/app/");
    await onboard(page);
    const card = await scrollToKind(page, "install");
    await expect(card.locator(".install-steps li")).toHaveCount(3);
    await expect(card.locator(".install-steps")).toContainText("Add to Home Screen");
    await card.locator('[data-install="later"]').click();
    await expect(card.locator(".quiz-result")).toContainText("No problem");

    // The next visit, within the 3 days: the feed goes well past where the card was, without it.
    await page.reload();
    const feed = page.locator("#feed");
    await expect.poll(async () => {
      await feed.evaluate((f) => { const clips = f.querySelectorAll(".clip"); f.scrollTo({ top: clips[clips.length - 1].offsetTop, behavior: "instant" }); });
      return feed.locator(".clip").count();
    }).toBeGreaterThan(12);
    await expect(feed.locator('.clip[data-kind="install"]')).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  // iPads identify as Macs ("MacIntel"); only the touch screen gives them away.
  test("gives iPads the Add to Home Screen tip", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "fakes an iPad in desktop Chrome");
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
      Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => 5 });
      // keep Chrome's own install prompt out of it
      window.addEventListener("beforeinstallprompt", (e) => e.stopImmediatePropagation(), true);
    });
    await page.goto("/app/");
    await onboard(page);
    await page.locator('#tabbar [data-screen="me"]').click();
    await expect(page.locator("#install-hint")).toHaveText("Tap Share, then Add to Home Screen");
  });

  test.describe("speech", () => {
    // Headless browsers have no voices or mic, so swap in fakes that record calls and fail on demand.
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        // micError: fail with this error. promptMs: delay before the mic opens (a permission prompt).
        // say: transcript to "hear" once the mic is open.
        const calls = (window.__speech = { spoken: [], idleCancels: 0, micError: null, promptMs: 0, say: null, voices: [] });
        let speaking = false;
        const fake = (name, value) => Object.defineProperty(window, name, { value, configurable: true, writable: true });
        fake("speechSynthesis", {
          get speaking() { return speaking; },
          pending: false,
          getVoices: () => calls.voices,
          addEventListener() {},
          speak(u) {
            calls.spoken.push({ text: u.text, lang: u.lang, ...(u.voice && { voice: u.voice.name }) });
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

    // Phones list many voices per language; the first match is often the most robotic one.
    test("Hear it picks the phone's best voice in the course's accent", async ({ page }) => {
      const voice = (name, lang, localService = true) => ({ name, lang, localService });
      const lists = {
        // Safari on an iPhone with a Premium voice downloaded
        "Paulina (Premium)": [voice("Grandma (Spanish (Mexico))", "es-MX"), voice("Mónica", "es-ES"), voice("Paulina", "es-MX"), voice("Paulina (Premium)", "es-MX")],
        // Edge, whose online voices are neural
        "Microsoft Dalia Online (Natural) - Spanish (Mexico)": [voice("Microsoft Sabina - Spanish (Mexico)", "es-MX"), voice("Microsoft Dalia Online (Natural) - Spanish (Mexico)", "es-MX", false)],
        // only Spain's voices installed: still Spanish rather than no voice
        "Mónica": [voice("Samantha", "en-US"), voice("Mónica", "es_ES")],
      };
      for (const [best, list] of Object.entries(lists)) {
        // runs after the fake on every load, so the app starts up with this phone's voices
        await page.addInitScript((l) => { window.__speech.voices = l; }, list);
        await page.reload();
        const clip = await scrollToKind(page, "vocab");
        await clip.locator(".play").click();
        await expect.poll(() => page.evaluate(() => window.__speech.spoken.at(-1)?.voice)).toBe(best);
      }
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

    async function fakeBackend(page, { signupFails = false, events, progress = noProgress, cards = () => [], deleteStatus = 204, assess } = {}) {
      const calls = { signups: 0, profiles: [], uploads: [], pulls: 0, feedback: [], deletes: [], speech: [] };
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
        if (req.method() === "POST" && req.url().endsWith("/speech/assess")) {
          const body = req.postDataJSON();
          calls.speech.push(body);
          // without an `assess` stand-in, answer as the API does with no Azure key
          if (!assess) return route.fulfill({ status: 503, headers: cors, json: {} });
          return route.fulfill({ headers: cors, json: assess(body) });
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

    // A stand-in microphone: a steady tone, so recording works the same in every test browser.
    const fakeMic = (page) => page.addInitScript(() => {
      // on the prototype: WebKit ignores assigning it on navigator.mediaDevices itself
      Object.defineProperty(MediaDevices.prototype, "getUserMedia", {
        configurable: true,
        value: async () => {
          const ctx = new AudioContext();
          const tone = ctx.createOscillator();
          const out = ctx.createMediaStreamDestination();
          tone.connect(out);
          tone.start();
          return out.stream;
        },
      });
    });

    // a two-word-or-longer Spanish speaking clip, alone in the feed
    async function speakingClip(page) {
      const clip = await page.evaluate(() => LANGS.es.clips.find((c) => c.kind === "speak" && c.line.split(/\s+/).length >= 2));
      await layFeed(page, [clip.id]);
      return clip;
    }

    test("scores speaking on the server and marks how each word came out", async ({ page }) => {
      const problems = watchForErrors(page);
      await fakeMic(page);
      const calls = await fakeBackend(page, {
        assess: ({ text }) => ({
          status: "ok", heard: text, score: 72, accuracy: 70, fluency: 80, completeness: 100,
          words: text.split(/\s+/).map((w, i) => ({ word: w.toLowerCase(), accuracy: i === 1 ? 40 : 95, error: i === 1 ? "Mispronunciation" : "None" })),
        }),
      });
      await page.goto("/app/");
      await onboard(page);
      const clip = await speakingClip(page);
      const words = clip.line.split(/\s+/);

      const mic = page.locator(".clip.active .mic");
      await mic.click();
      await expect(page.locator(".clip.active .mic-hint")).toContainText("say it, then tap the mic");
      await page.waitForTimeout(600);
      await mic.click(); // done
      await expect.poll(() => calls.speech.length).toBe(1);

      // the attempt: the line, its language, and a 16 kHz mono 16-bit WAV
      const sent = calls.speech[0];
      expect(sent).toMatchObject({ lang: "es", text: clip.line });
      const wav = Buffer.from(sent.audio, "base64");
      expect(wav.toString("ascii", 0, 4) + wav.toString("ascii", 8, 12)).toBe("RIFFWAVE");
      expect([wav.readUInt16LE(22), wav.readUInt32LE(24), wav.readUInt16LE(34)]).toEqual([1, 16000, 16]);
      expect(wav.length).toBeGreaterThan(44 + 16000 * 2 * 0.3);

      await expect(page.locator(".clip.active .score-ring b")).toHaveText("72");
      await expect(page.locator(".clip.active .speak-line .w.work")).toHaveText(words[1]);
      await expect(page.locator(".clip.active .speak-line .w.good").first()).toHaveText(words[0]);
      await expect.poll(() => calls.uploads.flat().find((e) => e.kind === "speech_scored")?.payload.score).toBe(72);

      // trying again puts the line back as it was
      await page.locator(".clip.active .again").click();
      await expect(page.locator(".clip.active .speak-line")).toHaveText(clip.line);
      await expect(page.locator(".clip.active .speak-line .w")).toHaveCount(0);
      expect(problems).toEqual([]);
    });

    test("doesn't send a recording too short to hold any speech", async ({ page }) => {
      await fakeMic(page);
      const calls = await fakeBackend(page, { assess: () => ({ status: "ok", heard: "", score: 0, words: [] }) });
      await page.goto("/app/");
      await onboard(page);
      await speakingClip(page);
      const mic = page.locator(".clip.active .mic");
      await mic.click();
      await expect(page.locator(".clip.active .mic-hint")).toContainText("say it, then tap the mic");
      await page.evaluate(() => Recorder.stop()); // stopped the instant it opened
      await expect(page.locator(".clip.active .mic-hint")).toContainText("didn't catch that");
      expect(calls.speech).toHaveLength(0);
    });

    test("lets the learner rate themselves when the server can't score, then stops asking it", async ({ page }) => {
      await fakeMic(page);
      const calls = await fakeBackend(page); // /speech/assess answers 503, as with no Azure key
      await page.goto("/app/");
      await onboard(page);
      await speakingClip(page);

      const mic = page.locator(".clip.active .mic");
      await mic.click();
      await expect(page.locator(".clip.active .mic-hint")).toContainText("say it, then tap the mic");
      await page.waitForTimeout(600);
      await mic.click();
      await expect(page.locator(".clip.active .mic-hint")).toContainText("couldn't check that one");
      await page.locator('.clip.active .self-rate [data-rate="good"]').click();
      await expect(page.locator(".clip.active .score-ring b")).toHaveText("90");

      await page.locator(".clip.active .again").click();
      await mic.click(); // now the phone's own recognition, not the server
      await page.waitForTimeout(500);
      expect(calls.speech).toHaveLength(1);
    });

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

  test.describe("voice", () => {
    test.use({ serviceWorkers: "block" });

    test("plays the natural recording, and the phone's voice for anything not recorded", async ({ page }) => {
      const problems = watchForErrors(page);
      await page.addInitScript(() => {
        // record what would be heard instead of playing it; "broken.mp3" acts like a file that won't load
        window.played = [];
        window.spoken = [];
        HTMLMediaElement.prototype.play = function () {
          window.played.push(new URL(this.src).pathname);
          return this.src.endsWith("broken.mp3") ? Promise.reject(new DOMException("no", "NotSupportedError")) : Promise.resolve();
        };
        if (window.SpeechSynthesis) SpeechSynthesis.prototype.speak = (u) => window.spoken.push(u.text);
      });
      await page.goto("/app/");
      const [a, b, c] = await page.evaluate(() => LANGS.es.clips.filter((x) => x.kind === "vocab").slice(0, 3));
      await page.route("**/audio/manifest.json", (route) => route.fulfill({ json: { es: { [a.term]: "es/a.mp3", [c.term]: "es/broken.mp3" } } }));
      await page.route("**/audio/es/*.mp3", (route) => route.fulfill({ contentType: "audio/mpeg", body: "stand-in" }));
      await page.reload();
      await onboard(page);
      await layFeed(page, [a.id, b.id, c.id]);

      await page.locator(".clip.active .play").click();
      await expect.poll(() => page.evaluate(() => window.played.at(-1))).toMatch(/\/audio\/es\/a\.mp3$/);

      await scrollToClip(page, 1); // not recorded
      await page.locator(".clip.active .play").click();
      await expect.poll(() => page.evaluate(() => window.spoken.at(-1))).toBe(b.term);

      await scrollToClip(page, 2); // recorded, but the file won't load
      await page.locator(".clip.active .play").click();
      await expect.poll(() => page.evaluate(() => window.spoken.at(-1))).toBe(c.term);
      expect(await page.evaluate((a) => window.spoken.includes(a), a.term)).toBe(false);
      expect(problems).toEqual([]);
    });
  });

  test.describe("course", () => {
    const UNIT_OF = (page) => page.evaluate(() => Object.fromEntries(LANGS.es.clips.map((c) => [c.id, c.unit])));
    // Marks every lesson clip in these units as seen, then reloads so the feed deals afresh.
    const finish = async (page, units) => {
      await page.evaluate((units) => {
        const s = JSON.parse(localStorage.getItem("langroll:v1"));
        s.seen = LANGS.es.clips.filter((c) => units.includes(c.unit)).map((c) => c.id);
        localStorage.setItem("langroll:v1", JSON.stringify(s));
      }, units);
      await page.reload();
      await expect(page.locator("#feed .clip.active")).toHaveCount(1);
    };

    test("a new learner starts with the first unit", async ({ page }) => {
      await page.goto("/app/");
      await onboard(page);
      const unitOf = await UNIT_OF(page);
      const ids = await page.locator("#feed .clip[data-id]").evaluateAll((els) => els.filter((e) => e.dataset.kind !== "watch").map((e) => e.dataset.id));
      expect(ids.length).toBeGreaterThan(2);
      expect(ids.map((id) => unitOf[id])).toEqual(ids.map(() => "hello"));
    });

    test("moves on once a unit is mostly seen, and mixes finished units back in", async ({ page }) => {
      await page.goto("/app/");
      await onboard(page);
      await finish(page, ["hello"]);
      const units = await page.evaluate(() => dealCourse(LANGS.es.clips).filter((c) => c.kind !== "watch").map((c) => c.unit));
      expect(units.slice(0, 4)).toEqual(["getting-by", "getting-by", "getting-by", "getting-by"]);
      expect(units).toContain("hello");
      expect(units.filter((u) => u === "hello").length).toBeLessThan(units.filter((u) => u === "getting-by").length);
      expect(new Set(units)).toEqual(new Set(["getting-by", "hello"]));
    });

    test("shows the learner's unit on their profile", async ({ page }) => {
      await page.goto("/app/");
      await onboard(page);
      await page.locator('#tabbar [data-screen="me"]').click();
      await expect(page.locator("#me-unit")).toHaveText("Unit 1 of 5 · Hello & introductions");
      await finish(page, ["hello", "getting-by"]);
      await page.locator('#tabbar [data-screen="me"]').click();
      await expect(page.locator("#me-unit")).toHaveText("Unit 3 of 5 · Food & ordering");
      await finish(page, ["hello", "getting-by", "food", "out", "local"]);
      await page.locator('#tabbar [data-screen="me"]').click();
      await expect(page.locator("#me-unit")).toHaveText("Every unit done 🎉");
    });

    test("a short round takes only the scenes that fit", async ({ page }) => {
      await page.goto("/app/");
      await onboard(page);
      const kinds = await page.evaluate(() => {
        const scene = LANGS.es.clips.find((c) => c.kind === "watch");
        const lessons = LANGS.es.clips.filter((c) => c.kind !== "watch").slice(0, 7);
        return dealScenes([...lessons, scene, { ...scene, id: "es-w98" }, { ...scene, id: "es-w99" }]).map((c) => c.kind);
      });
      expect(kinds.filter((k) => k === "watch")).toHaveLength(1);
      expect(kinds[2]).toBe("watch");
    });
  });

  test.describe("watch clips", () => {
    test.use({ serviceWorkers: "block" });

    test("show the scene with its own like, save and share row", async ({ page }) => {
      const problems = watchForErrors(page);
      await withWatchClips(page);
      await page.goto("/app/");
      await onboard(page);
      const clip = await scrollToKind(page, "watch");
      const id = await clip.getAttribute("data-id");
      // the feed is shuffled, so this can be a real scene or one of the test ones
      const scene = await page.evaluate((id) => clipById(id), id);

      // the floating rail would sit over the video, so it steps aside for the clip's own row
      await expect(page.locator("#rail")).toHaveClass(/\bhidden\b/);
      await expect(clip.locator(".watch-poster")).toHaveAttribute("src", `https://i.ytimg.com/vi/${scene.video}/hqdefault.jpg`);
      await expect(clip.locator(".watch-source")).toHaveAttribute("href", `https://www.youtube.com/watch?v=${scene.video}&t=${Math.floor(scene.start)}s`);
      await expect(clip.locator(".watch-source")).toContainText(scene.channel);
      await expect(clip.locator(".watch-line")).toHaveAttribute("lang", "es-MX");

      const like = clip.locator('[data-act="like"]');
      await like.click();
      await expect(like).toHaveAttribute("aria-pressed", "true");
      const save = clip.locator('[data-act="save"]');
      await save.click();
      await expect(save).toHaveAttribute("aria-pressed", "true");
      expect(await page.evaluate((id) => [state.liked.includes(id), state.saved.includes(id), Boolean(state.cards[id])], id)).toEqual([true, true, true]);

      // and comes back on the next clip that isn't a scene
      await page.locator("#feed").evaluate((f) => {
        const next = [...f.querySelectorAll(".clip.active ~ .clip[data-id]")].find((c) => c.dataset.kind !== "watch");
        f.scrollTo({ top: next.offsetTop, behavior: "instant" });
      });
      await expect(page.locator("#rail")).not.toHaveClass(/\bhidden\b/);
      expect(problems).toEqual([]);
    });

    // Scenes are a few clips out of ~30; a plain shuffle could bury them at the bottom.
    test("come up early in the feed, then spread out", async ({ page }) => {
      await withWatchClips(page);
      await page.goto("/app/");
      await onboard(page);
      const kinds = await page.evaluate(() => dealScenes(shuffle(LANGS.es.clips)).map((c) => c.kind));
      const at = kinds.flatMap((k, i) => (k === "watch" ? [i] : []));
      expect(at[0]).toBe(2);
      for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBe(6);
      // and in the feed itself: a new learner's third clip is a scene
      await expect(page.locator("#feed .clip").nth(2)).toHaveAttribute("data-kind", "watch");
    });

    test.describe("playback", () => {
      // a word clip, two scenes, then another word clip
      let ids;
      test.beforeEach(async ({ page }) => {
        await withWatchClips(page);
        await page.goto("/app/");
        await onboard(page);
        const words = await page.evaluate(() => LANGS.es.clips.filter((c) => c.kind === "vocab").map((c) => c.id));
        ids = [words[0], "es-wtest1", "es-wtest2", words[1]];
        await layFeed(page, ids);
        // wait until the first scene is loaded on a player sitting over its new clip, so tests
        // don't catch a player still holding it from the opening feed
        await page.waitForFunction(() => {
          const slot = document.querySelector('#feed .clip[data-id="es-wtest1"] .watch-slot').getBoundingClientRect();
          return window.yt?.players.some((p) => p.video === "aaaaaaaaaaa" && !p.destroyed && p.state === 5 && Math.abs(p.frame.getBoundingClientRect().top - slot.top) < 1);
        });
      });

      // The open player for this video, if there is one.
      const player = (page, video) => page.evaluate((video) => {
        const p = window.yt.players.filter((q) => q.video === video && !q.destroyed).sort((a, b) => b.cue - a.cue)[0];
        return p ? { index: window.yt.players.indexOf(p), state: p.state, muted: p.muted, loads: p.loads, t: p.t, seeks: p.seeks, shown: p.frame.parentElement.classList.contains("live") } : null;
      }, video);
      const A = "aaaaaaaaaaa";
      const B = "bbbbbbbbbbb";
      const fake = (page, video, fn) => page.evaluate(([video, fn]) => {
        const p = window.yt.players.filter((q) => q.video === video && !q.destroyed).sort((a, b) => b.cue - a.cue)[0];
        new Function("p", "yt", fn)(p, window.yt);
      }, [video, fn]);
      const PLAYING = 1;
      const CUED = 5;

      test("loads the next scene out of sight, plays it on screen, and closes it after", async ({ page }) => {
        const problems = watchForErrors(page);
        // on the word clip, the scene below is loaded and waiting, hidden behind its thumbnail
        // it starts 4.5s before the line (at 12s), so YouTube's opening overlay plays over the run-up
        await expect.poll(() => player(page, A)).toMatchObject({ state: CUED, t: 7, shown: false });
        const ahead = await player(page, A);

        // the same player plays it, without loading again, and comes out once it's playing
        await scrollToClip(page, 1);
        await expect.poll(() => player(page, A)).toMatchObject({ index: ahead.index, loads: 1, state: PLAYING, shown: true });
        await expect.poll(() => player(page, B)).toMatchObject({ state: CUED, shown: false });
        // the player sits exactly over the clip's video slot
        const [slot, frame] = await page.evaluate(() => [
          document.querySelector(".clip.active .watch-slot").getBoundingClientRect().toJSON(),
          window.yt.players.find((p) => p.video === "aaaaaaaaaaa" && !p.destroyed).frame.getBoundingClientRect().toJSON(),
        ]);
        for (const k of ["top", "left", "width", "height"]) expect(Math.abs(frame[k] - slot[k]), k).toBeLessThanOrEqual(1);

        // moving on closes the scene rather than pausing it (a paused YouTube player keeps its
        // controls up when it plays again)
        const next = await player(page, B);
        await scrollToClip(page, 2);
        await expect.poll(() => player(page, B)).toMatchObject({ index: next.index, state: PLAYING });
        expect(await player(page, A)).toBeNull();

        await scrollToClip(page, 3);
        await expect.poll(() => page.locator("#feed iframe").count()).toBe(0);
        expect(await page.evaluate(() => window.yt.players.some((p) => p.state === 2))).toBe(false); // never paused
        expect(problems).toEqual([]);
      });

      test("loops the scene from its run-up and lights the line while it's said", async ({ page }) => {
        await scrollToClip(page, 1);
        await expect.poll(() => player(page, A)).toMatchObject({ state: PLAYING });
        const clip = page.locator(".clip.active");
        await fake(page, A, "p.t = 9"); // the run-up, before the line at 12s
        await expect(clip).toHaveClass(/\bplaying\b/);
        await expect(clip).not.toHaveClass(/\bspeaking\b/);
        await fake(page, A, "p.t = 14.25"); // halfway through the line, 12–16.5
        await expect(clip).toHaveClass(/\bspeaking\b/);
        await expect.poll(() => clip.evaluate((el) => Number(el.style.getPropertyValue("--watch-done")))).toBeCloseTo(0.5, 1);
        await fake(page, A, "p.seeks = []; p.t = 16.5");
        await expect.poll(async () => (await player(page, A)).seeks).toContain(7.5); // back to the run-up
        await expect(clip).not.toHaveClass(/\bspeaking\b/);
      });

      test("stops when you leave the feed and starts afresh when you're back", async ({ page }) => {
        await scrollToClip(page, 1);
        await expect.poll(() => player(page, A)).toMatchObject({ state: PLAYING });
        await page.locator('#tabbar [data-screen="deck"]').click();
        await expect.poll(() => player(page, A)).toBeNull();
        await page.locator('#tabbar [data-screen="feed"]').click();
        await expect.poll(() => player(page, A)).toMatchObject({ state: PLAYING, loads: 1 });
      });

      test("plays muted when the browser blocks sound, then turns it on from the button", async ({ page }) => {
        await page.evaluate(() => { window.yt.blockSound = true; });
        await scrollToClip(page, 1);
        await expect.poll(() => player(page, A), { timeout: 5000 }).toMatchObject({ state: PLAYING, muted: true });
        await expect(page.locator("#toast")).toContainText("Tap 🔇 under the video");
        const sound = page.locator(".clip.active .watch-sound");
        await expect(sound).toHaveAttribute("aria-pressed", "false");

        await page.evaluate(() => { window.yt.blockSound = false; });
        await sound.click();
        await expect.poll(() => player(page, A)).toMatchObject({ state: PLAYING, muted: false });
        await expect(sound).toHaveAttribute("aria-pressed", "true");
        expect(await page.evaluate(() => state.sound)).toBe(true);

        await sound.click(); // off again
        await page.evaluate(() => { window.yt.blockSound = true; });
        await sound.click();
        await expect(page.locator("#toast")).toContainText("YouTube's sound button", { timeout: 5000 });
      });

      test("drops a scene that can't play before you reach it", async ({ page }) => {
        await expect.poll(() => player(page, A)).toMatchObject({ state: CUED }); // loaded, waiting
        await fake(page, A, "p.fail(150)"); // embedding turned off
        await expect(page.locator('#feed .clip[data-id="es-wtest1"]')).toHaveCount(0);
        expect(await page.evaluate(() => Watch.usable(clipById("es-wtest1")))).toBe(false);
      });
    });

    test("the feed carries on without scenes when YouTube can't be reached", async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await withWatchClips(page);
      await page.route("https://www.youtube.com/iframe_api", (route) => route.abort());
      await page.goto("/app/");
      await onboard(page);
      await layFeed(page, ["es-wtest1"]);
      await expect(page.locator(".clip.active")).toHaveClass(/\bunavailable\b/);
      // and no more scenes are dealt into the feed
      const kinds = await page.evaluate(() => Array.from({ length: 60 }, () => nextItem().dataset.kind));
      expect(kinds).not.toContain("watch");
      expect(errors).toEqual([]);
    });
  });

  test.describe("on a 4-inch phone", () => {
    test.use({ viewport: { width: 320, height: 568 } });

    test("every clip kind fits above its caption", async ({ page }) => {
      await page.goto("/app/");
      await onboard(page);
      const seen = new Set();
      for (let i = 0; i < 20 && seen.size < 5; i++) {
        await page.locator("#feed").evaluate((f, i) => f.scrollTo({ top: f.querySelectorAll(".clip")[i].offsetTop, behavior: "instant" }), i);
        const clip = page.locator("#feed .clip").nth(i);
        await expect(clip).toHaveClass(/\bactive\b/);
        const { kind, overlap } = await captionOverlap(clip);
        // the install card isn't a lesson; it gets its own check below
        if (kind !== "install") seen.add(kind);
        expect(overlap, `${kind} clip runs into its caption`).toBeLessThanOrEqual(1);
      }
      expect(seen.size, "saw every clip kind").toBe(5);
    });

    test("the install card fits above its caption", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "iphone", "the iPhone card has the most steps");
      await page.goto("/app/");
      await onboard(page);
      const { overlap } = await captionOverlap(await scrollToKind(page, "install"));
      expect(overlap, "install card runs into its caption").toBeLessThanOrEqual(1);
    });

    // The feed only ever shows a few clips, so check each one directly: a single long phrase in
    // a content PR shouldn't be able to run into its caption or off the side of a small phone.
    test("every clip in every language fits", async ({ page }) => {
      await page.goto("/app/");
      await onboard(page);
      expect(await clipFitProblems(page)).toEqual([]);
    });

    test("watch clips fit, wide or tall", async ({ page }) => {
      // the stand-in clips are added by routing, which a service worker would bypass in WebKit
      await withWatchClips(page);
      await page.goto("/app/");
      await onboard(page);
      expect(await clipFitProblems(page, "watch")).toEqual([]);
    });
  });

  // iPhone SE (2nd and 3rd gen) and similar: too tall for the short-phone styles, so clips get the
  // full layout in less room than most phones give it.
  test.describe("on a 4.7-inch phone", () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test("every clip in every language fits", async ({ page }) => {
      await page.goto("/app/");
      await onboard(page);
      expect(await clipFitProblems(page)).toEqual([]);
    });

    test("wide watch clips fit, up to the longest line", async ({ page }) => {
      await withWatchClips(page);
      await page.goto("/app/");
      await onboard(page);
      expect(await clipFitProblems(page, "watch", "wide")).toEqual([]);
    });

    // Known gap: a tall (Shorts) scene's video is sized as min(56svh, 100svh - 340px), which leaves
    // too little room for the line, buttons and credit on most phones taller than 620px: its
    // caption is pushed 30px off the bottom here, more with a long line. No tall scenes ship yet.
    test.fixme("tall watch clips fit", async ({ page }) => {
      await withWatchClips(page);
      await page.goto("/app/");
      await onboard(page);
      expect(await clipFitProblems(page, "watch", "tall")).toEqual([]);
    });
  });
});

// Renders each clip on its own and reports any that run into the caption or off the side.
async function clipFitProblems(page, kind, shape) {
  const ids = await page.evaluate(([kind, shape]) => Object.entries(LANGS).flatMap(([lang, L]) => L.clips
    .filter((c) => (!kind || c.kind === kind) && (!shape || (c.shape ?? "wide") === shape))
    .map((c) => [lang, c.id])), [kind, shape]);
  expect(ids.length, "found clips to check").toBeGreaterThan(0);
  const problems = [];
  for (const [lang, id] of ids) {
    const result = await page.evaluate(async ([lang, id]) => {
      state.lang = lang;
      const el = renderContent(clipById(id));
      document.querySelector("#feed").replaceChildren(el);
      setActive(el);
      for (let moving; (moving = el.getAnimations({ subtree: true }).filter((a) => a instanceof CSSTransition)).length;) {
        await Promise.all(moving.map((a) => a.finished.catch(() => {})));
      }
      const meta = el.querySelector(".clip-meta").getBoundingClientRect();
      const shown = [...el.querySelectorAll(".clip-body *, .watch-slot")].filter((c) => c.getBoundingClientRect().height && !c.closest(".back, .score, .self-rate"));
      const overlap = Math.max(...shown.map((c) => c.getBoundingClientRect().bottom)) - meta.top;
      // the caption (and a scene's YouTube credit) must stay on screen, not be pushed off the bottom
      const cut = meta.bottom - el.getBoundingClientRect().bottom;
      const tooWide = shown.filter((c) => c.getBoundingClientRect().right > el.getBoundingClientRect().right + 1).map((c) => c.className || c.tagName);
      return { overlap, cut, tooWide };
    }, [lang, id]);
    if (result.overlap > 1) problems.push(`${id} runs ${Math.round(result.overlap)}px into its caption`);
    if (result.cut > 1) problems.push(`${id}'s caption is cut off by ${Math.round(result.cut)}px`);
    if (result.tooWide.length) problems.push(`${id} is too wide: ${result.tooWide.join(", ")}`);
  }
  return problems;
}

// Tests add their own scenes, a long wide one and a tall one, so layout and playback checks don't
// depend on which real scenes ship.
const SCENES = [
  { id: "es-wtest1", kind: "watch", tag: "At the market", caption: "how people really haggle at a market stall in Mexico City", video: "aaaaaaaaaaa", start: 12, end: 16.5, line: "¿Me lo deja en cincuenta pesos, por favor?", meaning: "Will you let me have it for fifty pesos, please?", channel: "Mercados de México TV" },
  { id: "es-wtest2", kind: "watch", tag: "Greetings", caption: "a quick hello", video: "bbbbbbbbbbb", start: 3, end: 6, shape: "tall", line: "¿Qué onda?", meaning: "What's up?", channel: "Short Channel" },
  // the longest line content allows (85 characters)
  { id: "es-wtest3", kind: "watch", tag: "On the bus", caption: "asking the driver before you get on", video: "ccccccccccc", start: 20, end: 26, line: "Oiga, perdone, ¿sabe si este autobús pasa por el centro o hay que cambiar en la otra?", meaning: "Excuse me, does this bus go downtown, or do I need to change at the next stop?", channel: "Long Line Channel" },
];
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

// Replaces the feed with these clips, in order, with the first on screen.
async function layFeed(page, ids) {
  await page.evaluate((ids) => {
    const feed = document.querySelector("#feed");
    for (const c of feed.querySelectorAll(".clip")) c.remove();
    for (const id of ids) {
      const el = renderContent(clipById(id));
      feed.appendChild(el);
      observer.observe(el);
    }
    feed.scrollTop = 0;
    setActive(feed.querySelector(".clip"));
  }, ids);
}

async function scrollToClip(page, i) {
  await page.locator("#feed").evaluate((f, i) => f.scrollTo({ top: f.querySelectorAll(".clip")[i].offsetTop, behavior: "instant" }), i);
  await expect(page.locator("#feed .clip").nth(i)).toHaveClass(/\bactive\b/);
}

async function withWatchClips(page) {
  await page.route("**/content.js*", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: `${await res.text()}\nLANGS.es.clips.push(...${JSON.stringify(SCENES)});` });
  });
  await fakeYouTubeNetwork(page);
}

// YouTube's thumbnails and player are stood in for, so tests never touch the network.
async function fakeYouTubeNetwork(page) {
  await page.route("https://i.ytimg.com/**", (route) => route.fulfill({ contentType: "image/png", body: PIXEL }));
  await page.route("https://www.youtube.com/iframe_api", (route) => route.fulfill({ contentType: "text/javascript", body: `(${fakeYouTube})()` }));
}

// Stands in for YouTube's IFrame Player API (developers.google.com/youtube/iframe_api_reference).
// It records what the app asks of each player in window.yt, and tests move time on by setting t.
// Set yt.blockSound to act like a browser that won't play sound before a tap.
function fakeYouTube() {
  const yt = (window.yt = { players: [], blockSound: false, cues: 0 });
  const S = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  class Player {
    constructor(mount, opts) {
      this.opts = opts;
      this.frame = document.createElement("iframe");
      mount.replaceWith(this.frame);
      Object.assign(this, { video: opts.videoId, t: opts.playerVars.start, cue: ++yt.cues, muted: false, state: S.UNSTARTED, loads: 1, seeks: [], destroyed: false });
      yt.players.push(this);
      setTimeout(() => { this.set(S.CUED); opts.events.onReady({ target: this }); }, 20);
    }
    set(s) {
      this.state = s;
      setTimeout(() => this.opts.events.onStateChange({ target: this, data: s }), 0);
    }
    cueVideoById({ videoId, startSeconds }) { Object.assign(this, { video: videoId, t: startSeconds, cue: ++yt.cues }); this.loads++; this.set(S.CUED); }
    loadVideoById(video) { this.cueVideoById(video); this.playVideo(); }
    playVideo() { this.set(yt.blockSound && !this.muted ? S.PAUSED : S.PLAYING); }
    pauseVideo() { this.set(S.PAUSED); }
    stopVideo() { this.set(S.CUED); }
    seekTo(t) { this.t = t; this.seeks.push(t); }
    mute() { this.muted = true; }
    unMute() { this.muted = false; }
    isMuted() { return this.muted; }
    getCurrentTime() { return this.t; }
    getPlayerState() { return this.state; }
    fail(code = 150) { this.opts.events.onError({ target: this, data: code }); }
    destroy() { this.destroyed = true; this.frame.remove(); }
  }
  window.YT = { Player, PlayerState: S };
  setTimeout(() => window.onYouTubeIframeAPIReady?.(), 0);
}

// How far a clip's content runs past the top of its caption, once it has settled.
function captionOverlap(clip) {
  return clip.evaluate(async (el) => {
    // content slides up as a clip becomes active; measure where it settles
    for (let moving; (moving = el.getAnimations({ subtree: true }).filter((a) => a instanceof CSSTransition)).length;) {
      await Promise.all(moving.map((a) => a.finished.catch(() => {})));
    }
    const meta = el.querySelector(".clip-meta").getBoundingClientRect();
    const bottoms = [...el.querySelectorAll(".clip-body *")].map((c) => c.getBoundingClientRect()).filter((r) => r.height).map((r) => r.bottom);
    return { kind: el.dataset.kind, overlap: Math.max(...bottoms) - meta.top };
  });
}

async function onboard(page) {
  await page.locator("#lang-grid button").first().click();
  await page.locator("#goal-row button").first().click();
  await page.locator("#start").click();
  await expect(page.locator("#feed .clip.active")).toHaveCount(1);
}

// Scroll the feed until a clip of this kind is active (the feed is shuffled, so keep loading).
async function scrollToKind(page, kind) {
  for (let n = 0; n < 12; n++) {
    const i = await page.locator("#feed").evaluate((f, kind) => [...f.querySelectorAll(".clip")].findIndex((c) => c.dataset.kind === kind), kind);
    const target = i >= 0 ? i : await page.locator("#feed").evaluate((f) => f.querySelectorAll(".clip").length - 1);
    await page.locator("#feed").evaluate((f, i) => f.scrollTo({ top: f.querySelectorAll(".clip")[i].offsetTop, behavior: "instant" }), target);
    if (i >= 0) {
      const clip = page.locator(`#feed .clip.active[data-kind="${kind}"]`);
      await expect(clip).toHaveCount(1);
      return clip;
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`no ${kind} clip in the feed`);
}
