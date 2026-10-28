import { existsSync } from "node:fs";
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
  test.skip(!existsSync("app/index.html"), "no app/ in this branch");

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
        const calls = (window.__speech = { spoken: [], idleCancels: 0, micError: null });
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
        function FakeRecognition() {
          this.start = () => setTimeout(() => {
            if (calls.micError) { this.onerror?.({ error: calls.micError }); this.onend?.(); }
            else { this.onaudiostart?.(); this.onend?.(); }
          }, 20);
          this.stop = () => {};
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

    test("silence asks to try again instead of failing", async ({ page }) => {
      await page.evaluate(() => { window.__speech.micError = "no-speech"; });
      const clip = await scrollToKind(page, "speak");
      await clip.locator(".mic").click();
      await expect(clip.locator(".mic-hint")).toContainText("didn't hear anything");
      await expect(clip.locator(".self-rate")).toBeHidden();
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
