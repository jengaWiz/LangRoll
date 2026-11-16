document.documentElement.classList.add("js");

const root = document.documentElement;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;
const palette = ["#e8473b", "#f08a6c", "#f9cdbb", "#5470ff", "#8a4dff", "#0d0b0c"];

// ---------- Aura: recolor the background per section ----------
const auraObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) root.dataset.aura = entry.target.dataset.aura;
  });
}, { rootMargin: "-45% 0px -45% 0px" });
document.querySelectorAll("section[data-aura]").forEach((s) => auraObserver.observe(s));

// ---------- Pointer: aura parallax, cursor glow, hero tilt ----------
const stage = document.querySelector(".hero-stage");
document.querySelectorAll(".float").forEach((f) => f.style.setProperty("--d", f.dataset.depth || 2));

if (finePointer && !reduceMotion) {
  let frame = 0;
  let last = null;
  window.addEventListener("pointermove", (e) => {
    last = e;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const { clientX: x, clientY: y } = last;
      root.style.setProperty("--mx", (x / innerWidth - 0.5) * 2);
      root.style.setProperty("--my", (y / innerHeight - 0.5) * 2);
      root.style.setProperty("--cx", x + "px");
      root.style.setProperty("--cy", y + "px");

      const r = stage.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight) {
        const px = Math.max(-1, Math.min(1, (x - (r.left + r.width / 2)) / (r.width / 2)));
        const py = Math.max(-1, Math.min(1, (y - (r.top + r.height / 2)) / (r.height / 2)));
        stage.style.setProperty("--px", px.toFixed(3));
        stage.style.setProperty("--py", py.toFixed(3));
      }
    });
  }, { passive: true });
}

// ---------- "People scrolling right now" ticker ----------
const liveCount = document.getElementById("live-count");
let live = 2418;
setInterval(() => {
  live = Math.max(1900, live + Math.round((Math.random() - 0.45) * 40));
  liveCount.textContent = live.toLocaleString("en-US");
}, 2200);

// =========================================================
// Phone feed
// =========================================================
const phone = document.getElementById("phone");
const feed = document.getElementById("feed");
const clips = Array.from(feed.querySelectorAll(".clip"));
const stories = document.getElementById("stories");
const streak = document.getElementById("streak");
const toastEl = document.getElementById("toast");
const heart = phone.querySelector(".big-heart");
const likeBtn = phone.querySelector(".act.like");
const saveBtn = phone.querySelector(".act.save");
const likeCount = document.getElementById("like-count");

const likeBase = [24100, 9100, 13200, 51000, 3400, 7800];
const liked = clips.map(() => false);
const saved = clips.map(() => false);

let current = -1;
let autoplay = !reduceMotion;
let visible = false;
let advanceTimer = 0;
let resumeTimer = 0;
const clipTimers = [];

// story segments, one per clip
clips.forEach(() => {
  const seg = document.createElement("span");
  seg.className = "seg";
  seg.innerHTML = "<i></i>";
  stories.appendChild(seg);
});
const segs = Array.from(stories.children);

function formatCount(n) {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n);
}

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1600);
}

function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function confetti(x, y, count = 18) {
  if (reduceMotion) return;
  for (let i = 0; i < count; i++) {
    const c = document.createElement("i");
    c.className = "confetti";
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 90;
    c.style.left = x + "px";
    c.style.top = y + "px";
    c.style.background = palette[i % palette.length];
    c.style.setProperty("--dx", Math.cos(angle) * dist + "px");
    c.style.setProperty("--dy", Math.sin(angle) * dist - 40 + "px");
    c.style.setProperty("--rot", Math.random() * 720 - 360 + "deg");
    phone.appendChild(c);
    setTimeout(() => c.remove(), 1000);
  }
}

function confettiFrom(el) {
  const p = phone.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  confetti(r.left - p.left + r.width / 2, r.top - p.top + r.height / 2);
}

let streakBumped = false;
function bumpStreak() {
  if (streakBumped) return;
  streakBumped = true;
  streak.textContent = Number(streak.textContent) + 1;
  restart(streak.parentElement, "bump");
  setTimeout(() => streak.parentElement.classList.remove("bump"), 400);
}

// --- per-clip behaviour that runs while a clip is on screen ---
function stopClipTimers() {
  while (clipTimers.length) clearInterval(clipTimers.pop());
}

const onEnter = {
  vocab(clip) {
    const syl = clip.querySelectorAll(".phonetic span");
    let i = 0;
    clipTimers.push(setInterval(() => {
      syl.forEach((s, j) => s.classList.toggle("on", j === i));
      i = (i + 1) % (syl.length + 2); // short pause after the word
    }, 420));
  },
  duel(clip) {
    const you = clip.querySelector(".racer.you");
    const them = clip.querySelector(".racer.them");
    const result = clip.querySelector(".duel-result");
    let a = 0, b = 0;
    const draw = () => {
      you.querySelector("i").style.width = a * 10 + "%";
      them.querySelector("i").style.width = b * 10 + "%";
      you.querySelector(".pct").textContent = a;
      them.querySelector(".pct").textContent = b;
    };
    result.textContent = "";
    result.classList.remove("win");
    draw();
    const t = setInterval(() => {
      if (Math.random() < 0.62) a = Math.min(10, a + 1);
      if (Math.random() < 0.5) b = Math.min(8, b + 1);
      draw();
      if (a === 10) {
        clearInterval(t);
        result.textContent = "You win! 🏆 +25 XP";
        result.classList.add("win");
        confettiFrom(result);
        bumpStreak();
      }
    }, 380);
    clipTimers.push(t);
  },
};

function updateRail() {
  likeBtn.classList.toggle("on", liked[current]);
  likeBtn.setAttribute("aria-pressed", String(liked[current]));
  likeCount.textContent = formatCount(likeBase[current] + (liked[current] ? 1 : 0));
  saveBtn.classList.toggle("on", saved[current]);
  saveBtn.setAttribute("aria-pressed", String(saved[current]));
  saveBtn.querySelector("small").textContent = saved[current] ? "Saved" : "Save";
}

function startSegment() {
  const seg = segs[current];
  seg.innerHTML = "<i></i>";
  seg.style.setProperty("--dur", (clips[current].dataset.dur || 7000) + "ms");
}

function schedule() {
  clearTimeout(advanceTimer);
  if (!autoplay || !visible) return;
  advanceTimer = setTimeout(() => {
    const next = (current + 1) % clips.length;
    feed.scrollTo({ top: next * feed.clientHeight, behavior: "smooth" });
  }, Number(clips[current].dataset.dur || 7000));
}

function setActive(i) {
  if (i === current) return;
  current = i;
  stopClipTimers();
  clips.forEach((c, j) => c.classList.toggle("active", j === i));
  segs.forEach((s, j) => {
    s.classList.toggle("done", j < i);
    s.classList.toggle("current", j === i);
  });
  startSegment();
  phone.dataset.tone = clips[i].classList.contains("clip-peach") ? "light" : "";
  updateRail();

  const clip = clips[i];
  const run = onEnter[clip.dataset.kind];
  if (run) run(clip);
  schedule();
}

feed.addEventListener("scroll", () => {
  setActive(Math.round(feed.scrollTop / feed.clientHeight));
}, { passive: true });

// The visitor takes over: pause autoplay, resume after a quiet spell.
function pauseAuto() {
  if (reduceMotion) return;
  autoplay = false;
  clearTimeout(advanceTimer);
  stories.classList.add("paused");
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    autoplay = true;
    stories.classList.remove("paused");
    startSegment();
    schedule();
  }, 9000);
}
["wheel", "touchstart", "pointerdown", "keydown"].forEach((evt) =>
  phone.addEventListener(evt, pauseAuto, { passive: true })
);

new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
  stories.classList.toggle("paused", !visible || !autoplay);
  if (visible && autoplay) { startSegment(); schedule(); }
  else clearTimeout(advanceTimer);
}, { threshold: 0.5 }).observe(phone);

if (reduceMotion) stories.classList.add("paused");
setActive(0);

// --- rail ---
function setLike(on) {
  liked[current] = on;
  updateRail();
  restart(likeBtn, "pop");
}
likeBtn.addEventListener("click", () => setLike(!liked[current]));
saveBtn.addEventListener("click", () => {
  saved[current] = !saved[current];
  updateRail();
  restart(saveBtn, "pop");
  toast(saved[current] ? "🔖 Saved to your review deck" : "Removed from review deck");
});
phone.querySelectorAll(".rail .act:not(.like):not(.save)").forEach((b) =>
  b.addEventListener("click", () => toast(b.getAttribute("aria-label") === "Share" ? "↗ Link copied" : "💬 Comments open in the app"))
);

// --- double-tap to like (mouse and touch) ---
let lastTap = 0;
feed.addEventListener("pointerup", (e) => {
  if (e.target.closest("button")) return;
  const now = Date.now();
  if (now - lastTap < 320) {
    const p = phone.getBoundingClientRect();
    heart.style.left = e.clientX - p.left + "px";
    heart.style.top = e.clientY - p.top + "px";
    restart(heart, "go");
    if (!liked[current]) setLike(true);
    lastTap = 0;
  } else {
    lastTap = now;
  }
});

// --- follow buttons ---
feed.querySelectorAll(".follow").forEach((btn) => {
  const label = btn.textContent;
  btn.addEventListener("click", () => {
    const on = btn.classList.toggle("on");
    btn.textContent = on ? (label === "Friend" ? "Challenged" : "Following") : label;
  });
});

// --- quiz ---
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
        confettiFrom(opt);
        bumpStreak();
      } else {
        restart(opt, "shake");
        result.textContent = "Not quite. Try again!";
      }
    });
  });
});

// --- speak-back ---
feed.querySelectorAll(".speak").forEach((clip) => {
  const mic = clip.querySelector(".mic");
  const hint = clip.querySelector(".mic-hint");
  mic.addEventListener("click", () => {
    if (clip.classList.contains("listening")) return;
    clip.classList.add("listening");
    hint.textContent = "listening";
    setTimeout(() => {
      clip.classList.remove("listening");
      clip.classList.add("scored");
      confettiFrom(clip.querySelector(".score-ring"));
      bumpStreak();
    }, 1700);
  });
  clip.querySelector(".again").addEventListener("click", () => {
    clip.classList.remove("scored");
    hint.textContent = "tap the mic and say it";
  });
});

// --- flip card ---
feed.querySelectorAll(".flip").forEach((card) =>
  card.addEventListener("click", () => card.classList.toggle("flipped"))
);

// --- spaced-repetition review ---
feed.querySelectorAll(".review-opt").forEach((opt) => {
  opt.addEventListener("click", () => {
    const clip = opt.closest(".clip");
    clip.querySelectorAll(".opt").forEach((o) => {
      o.disabled = true;
      o.classList.toggle("right", o === opt);
    });
    clip.querySelector(".quiz-result").textContent =
      opt.dataset.v === "yes" ? "Locked in. See you in 6 days 🧠" : "No stress. It'll pop up tomorrow.";
    if (opt.dataset.v === "yes") confettiFrom(opt);
  });
});

// =========================================================
// How it works: the sticky stage follows the active step
// =========================================================
const howStage = document.getElementById("stage");
const steps = Array.from(document.querySelectorAll(".how-steps .step"));
const stepObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    howStage.dataset.panel = entry.target.dataset.panel;
    steps.forEach((s) => s.classList.toggle("current", s === entry.target));
  });
}, { rootMargin: "-40% 0px -40% 0px" });
steps.forEach((s) => stepObserver.observe(s));
steps[0].classList.add("current");

// =========================================================
// Scroll reveal
// =========================================================
const revealer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("in");
      revealer.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

document.querySelectorAll(".reveal").forEach((el, i) => {
  el.style.transitionDelay = (i % 3) * 90 + "ms";
  revealer.observe(el);
});
