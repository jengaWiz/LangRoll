document.documentElement.classList.add("js");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Phone feed ----------
const feed = document.getElementById("feed");
const clips = Array.from(feed.querySelectorAll(".clip"));
const progress = document.getElementById("progress");
const streak = document.getElementById("streak");

function currentIndex() {
  return Math.round(feed.scrollTop / feed.clientHeight);
}

function updateProgress() {
  progress.style.width = ((currentIndex() + 1) / clips.length) * 100 + "%";
}
feed.addEventListener("scroll", updateProgress, { passive: true });
updateProgress();

// Auto-advance the feed like a reel until the visitor takes over.
let autoplay = !reduceMotion;
let feedVisible = false;

["pointerdown", "wheel", "touchstart", "keydown"].forEach((evt) =>
  feed.addEventListener(evt, () => { autoplay = false; }, { passive: true })
);

new IntersectionObserver(([entry]) => { feedVisible = entry.isIntersecting; }, { threshold: 0.6 })
  .observe(feed);

setInterval(() => {
  if (!autoplay || !feedVisible || document.hidden) return;
  const next = (currentIndex() + 1) % clips.length;
  feed.scrollTo({ top: next * feed.clientHeight, behavior: "smooth" });
}, 3800);

// Like and save buttons.
function formatCount(n) {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n);
}

function parseCount(text) {
  return text.endsWith("k") ? Math.round(parseFloat(text) * 1000) : parseInt(text, 10);
}

feed.querySelectorAll(".act.like, .act.save").forEach((btn) => {
  btn.setAttribute("aria-pressed", "false");
  btn.addEventListener("click", () => {
    const on = btn.classList.toggle("on");
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.remove("pop");
    void btn.offsetWidth; // restart animation
    btn.classList.add("pop");

    const label = btn.querySelector("small");
    if (btn.classList.contains("like")) {
      const count = parseCount(btn.dataset.base ?? (btn.dataset.base = label.textContent));
      label.textContent = formatCount(count + (on ? 1 : 0));
    } else {
      label.textContent = on ? "Saved" : "Save";
    }
  });
});

// Quiz clip.
let streakBumped = false;
function bumpStreak() {
  if (streakBumped) return;
  streakBumped = true;
  streak.textContent = Number(streak.textContent) + 1;
}

feed.querySelectorAll(".quiz").forEach((quiz) => {
  const result = quiz.querySelector(".quiz-result");
  quiz.querySelectorAll(".opt").forEach((opt) => {
    opt.addEventListener("click", () => {
      if (opt.dataset.v === quiz.dataset.answer) {
        quiz.querySelectorAll(".opt").forEach((o) => {
          o.disabled = true;
          o.classList.toggle("right", o === opt);
          o.classList.toggle("wrong", o !== opt);
        });
        result.textContent = "Correct! +10 XP 🔥";
        bumpStreak();
      } else {
        opt.classList.remove("shake");
        void opt.offsetWidth;
        opt.classList.add("shake");
        result.textContent = "Not quite. Try again!";
      }
    });
  });
});

// Spaced-repetition review clip.
document.querySelectorAll(".opt.review").forEach((opt) => {
  opt.addEventListener("click", () => {
    const card = opt.closest(".clip");
    card.querySelectorAll(".opt").forEach((o) => {
      o.disabled = true;
      o.classList.toggle("right", o === opt);
    });
    card.querySelector(".quiz-result").textContent =
      opt.dataset.v === "yes"
        ? "Nice! See you again in 6 days."
        : "No worries. It'll pop up again tomorrow.";
  });
});

// ---------- Scroll reveal ----------
const revealer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("in");
      revealer.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

document.querySelectorAll(".reveal").forEach((el, i) => {
  el.style.transitionDelay = (i % 3) * 80 + "ms";
  revealer.observe(el);
});
