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
});
