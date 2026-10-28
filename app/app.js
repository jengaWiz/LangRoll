// LangRoll app: an endless feed of language clips with XP, streaks and spaced review.
// Content lives in content.js, review scheduling in srs.js. Everything persists to localStorage.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const palette = ["#e8473b", "#f08a6c", "#f9cdbb", "#5470ff", "#8a4dff", "#0d0b0c"];
const STORE_KEY = "langroll:v1";
const GOALS = [
  { xp: 30, label: "Casual", sub: "5 min a day" },
  { xp: 60, label: "Regular", sub: "10 min a day" },
  { xp: 100, label: "Serious", sub: "15 min a day" },
];

// =========================================================
// State
// =========================================================
function dayKey(d = new Date()) {
  // local date, not toISOString(): a UTC key would roll the day over at 5pm in Seattle
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dayKey(d);
}

function defaults() {
  return {
    v: 1,
    lang: null,
    goal: 60,
    sound: true,
    xp: 0,
    today: { day: dayKey(), xp: 0, goalHit: false },
    streak: { count: 0, last: null },
    cards: {},
    saved: [],
    liked: [],
    following: [],
    duels: { played: 0, won: 0 },
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.v === 1) return { ...defaults(), ...s };
  } catch (e) { /* private mode or corrupt data: start fresh */ }
  return defaults();
}

function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
}

const state = load();

function rollDay() {
  if (state.today.day !== dayKey()) state.today = { day: dayKey(), xp: 0, goalHit: false };
}

function currentStreak() {
  const { count, last } = state.streak;
  return last === dayKey() || last === yesterdayKey() ? count : 0;
}

// =========================================================
// DOM helpers
// =========================================================
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const toastEl = $("#toast");
let toastTimer = 0;
function toast(msg, ms = 1800) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

function confettiFrom(el, count = 18) {
  if (reduceMotion || !el) return;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
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
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1000);
  }
}

function avatar(c, extra = "") {
  return `<span class="avatar ${extra}" style="--a:${c.a};--b:${c.b}">${esc(c.initial)}</span>`;
}

function lang() {
  return LANGS[state.lang];
}

function clipById(id) {
  for (const code in LANGS) {
    const found = LANGS[code].clips.find((c) => c.id === id);
    if (found) return found;
  }
  return null;
}

// =========================================================
// XP, streak, daily goal
// =========================================================
function addXP(n, fromEl) {
  rollDay();
  state.xp += n;
  state.today.xp += n;

  const today = dayKey();
  if (state.streak.last !== today) {
    state.streak.count = state.streak.last === yesterdayKey() ? state.streak.count + 1 : 1;
    state.streak.last = today;
    restart($("#streak-pill"), "bump");
  }
  if (!state.today.goalHit && state.today.xp >= state.goal) {
    state.today.goalHit = true;
    setTimeout(() => toast("🎯 Daily goal hit! Streak safe"), 600);
  }
  persist();
  renderHud();
  if (fromEl) floatXP(fromEl, n);
}

function floatXP(el, n) {
  const r = el.getBoundingClientRect();
  const f = document.createElement("span");
  f.className = "xp-float";
  f.textContent = `+${n} XP`;
  f.style.left = r.left + r.width / 2 + "px";
  f.style.top = r.top + "px";
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1100);
}

function renderHud() {
  rollDay();
  $("#streak").textContent = currentStreak();
  $("#xp-today").textContent = state.today.xp;
  const pct = Math.min(100, Math.round((state.today.xp / state.goal) * 100));
  $("#goal-bar").style.width = pct + "%";
  $("#review-count").textContent = dueCards().length || "";
}

// =========================================================
// Cards (spaced repetition)
// =========================================================
function ensureCard(id) {
  if (!state.cards[id]) state.cards[id] = newCard(id);
  return state.cards[id];
}

function cardsForLang() {
  return Object.values(state.cards).filter((c) => c.id.startsWith(state.lang + "-") && clipById(c.id));
}

function dueCards(now = Date.now()) {
  return cardsForLang().filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
}

// What a review asks for each clip kind: show the prompt, recall the answer.
function reviewFace(clip) {
  switch (clip.kind) {
    case "vocab": return { prompt: clip.term, answer: clip.meaning };
    case "quiz":  return { prompt: clip.q.replace("___", clip.answer), answer: clip.sub };
    case "speak": return { prompt: clip.line, answer: clip.meaning };
    case "flip":  return { prompt: clip.front, answer: `${clip.reading} · ${clip.meaning}` };
  }
  return { prompt: "", answer: "" };
}

function relDue(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return "due now";
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

// =========================================================
// Speech: text-to-speech and speech recognition
// =========================================================
let voices = [];
function loadVoices() { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; }
if (window.speechSynthesis) {
  loadVoices();
  speechSynthesis.addEventListener("voiceschanged", loadVoices);
}

const IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let silentHintShown = false;
let lastUtterance = null;

// cancel() right before speak() can swallow the next utterance, so only cancel real playback
function stopSpeech() {
  if (window.speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
}

// `force` means the user tapped a sound button, so failures are worth telling them about
function speak(text, force = false) {
  if (!window.speechSynthesis || (!state.sound && !force)) return false;
  const code = lang().speech;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = code;
  u.rate = 0.9;
  const norm = (v) => v.lang.replace("_", "-");
  const voice = voices.find((v) => norm(v) === code) || voices.find((v) => norm(v).startsWith(code.slice(0, 2)));
  if (voice) u.voice = voice;
  if (force) {
    let started = false;
    u.onstart = () => { started = true; };
    u.onerror = (e) => {
      if (e.error !== "interrupted" && e.error !== "canceled") toast(`🔇 Couldn't play audio (${e.error})`, 3500);
    };
    setTimeout(() => { if (!started && lastUtterance === u) toast("🔇 No sound came out. Check the volume, and that silent mode is off", 4000); }, 2500);
    // iPhones mute web speech when the ring switch is on silent, with no error to catch
    if (IOS && !silentHintShown) {
      silentHintShown = true;
      toast("🔊 No sound? Flip your iPhone's silent switch off", 3500);
    }
  }
  stopSpeech();
  lastUtterance = u;
  speechSynthesis.speak(u);
  speechSynthesis.resume(); // Chrome can leave the queue paused after a cancel
  return true;
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let onMicOpen = null;

function listen(code) {
  return new Promise((resolve, reject) => {
    const r = new Recognition();
    r.lang = code;
    r.interimResults = false;
    r.maxAlternatives = 5;
    let heard = [];
    r.onresult = (e) => { heard = Array.from(e.results[0]).map((a) => a.transcript); };
    r.onerror = (e) => reject(e.error);
    r.onend = () => resolve(heard);
    r.onaudiostart = () => onMicOpen?.();
    try { r.start(); } catch (e) { reject(e.name || "start-failed"); return; }
    setTimeout(() => { try { r.stop(); } catch (e) { /* already stopped */ } }, 6000);
  });
}

function normalize(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, " ").trim();
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function similarity(target, heard) {
  const a = normalize(target);
  const b = normalize(heard);
  if (!a || !b) return 0;
  return Math.max(0, Math.round(100 * (1 - levenshtein(a, b) / Math.max(a.length, b.length))));
}

// =========================================================
// Clip rendering
// =========================================================
const feedEl = $("#feed");
let mode = "foryou";       // "foryou" | "review"
let queue = [];            // upcoming for-you clips
let sinceReview = 0;
let sinceDuel = 0;
let rendered = 0;
let active = null;
const clipTimers = [];

const WAVE = "<i></i>".repeat(14);
const EQ = "<i class=\"eq\"><b></b><b></b><b></b><b></b></i>";

function metaHTML(clip, sound) {
  const c = CREATORS[clip.creator];
  const on = state.following.includes(clip.creator);
  return `
    <div class="clip-meta">
      <div class="creator">${avatar(c)}<b>@${esc(c.handle)}</b><button class="follow${on ? " on" : ""}" data-creator="${clip.creator}">${on ? "Following" : "Follow"}</button></div>
      <p class="caption">${esc(clip.caption)}</p>
      <p class="sound">${EQ} ${esc(sound)} · ${esc(c.handle)}</p>
    </div>`;
}

function bodyHTML(clip) {
  const L = lang();
  const tag = `<span class="clip-tag">${L.flag} ${esc(L.name)} · ${esc(clip.tag)}</span>`;
  switch (clip.kind) {
    case "vocab":
      return `${tag}
        <p class="clip-big">${esc(clip.term)}</p>
        <p class="clip-sub">${esc(clip.meaning)}</p>
        <div class="phonetic">${clip.phon.map((p, i) => `<span class="${i === clip.hit ? "hit" : ""}">${esc(p)}</span>`).join("")}</div>
        <button class="play" aria-label="Hear it"><span class="wave" aria-hidden="true">${WAVE}</span><b>🔊 Hear it</b></button>`;
    case "quiz":
      return `${tag}
        <p class="clip-q">${esc(clip.q)}</p>
        <p class="clip-sub">${esc(clip.sub)}</p>
        <div class="options">${shuffle(clip.options).map((o) => `<button class="opt" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>
        <p class="quiz-result" aria-live="polite"></p>`;
    case "speak":
      return `${tag}
        <p class="clip-sub">Say it out loud</p>
        <p class="clip-big speak-line">${esc(clip.line)}</p>
        <p class="clip-sub">${esc(clip.meaning)}${clip.hint ? ` · <em>${esc(clip.hint)}</em>` : ""}</p>
        <div class="speak-row">
          <button class="mic" aria-label="Tap to speak"><span class="mic-ring"></span>🎙️</button>
          <button class="play small" aria-label="Hear it first">🔊</button>
        </div>
        <p class="mic-hint">${Recognition ? "tap the mic and say it" : "say it out loud, then rate yourself"}</p>
        <div class="self-rate" hidden>
          <button class="opt" data-rate="good">Nailed it</button>
          <button class="opt" data-rate="again">Not yet</button>
        </div>
        <div class="score" aria-live="polite">
          <span class="score-ring"><b>0</b><small>%</small></span>
          <span class="score-text"></span>
          <button class="again">Try again</button>
        </div>`;
    case "flip":
      return `${tag}
        <button class="flip-card" aria-label="Flip the card">
          <span class="face front"><b class="${/[぀-ヿ一-鿿]/.test(clip.front) ? "jp" : "word"}">${esc(clip.front)}</b><small>tap to flip</small></span>
          <span class="face back"><b>${esc(clip.reading)}</b><span>${esc(clip.meaning)}</span><small>${esc(clip.note)}</small></span>
        </button>`;
  }
  return "";
}

function clipEl(kind, theme, inner, data = {}) {
  const el = document.createElement("article");
  el.className = `clip clip-${theme} ${kind}`;
  el.dataset.kind = kind;
  Object.assign(el.dataset, data);
  el.innerHTML = `<div class="clip-bg"><span class="glyph">${KIND_GLYPH[kind] || "✦"}</span></div>${inner}`;
  return el;
}

function renderContent(clip) {
  const sound = { vocab: "original sound", quiz: "quick fire", speak: "speak-back", flip: "word stories" }[clip.kind];
  return clipEl(clip.kind, KIND_THEME[clip.kind], `<div class="clip-body">${bodyHTML(clip)}</div>${metaHTML(clip, sound)}`, { id: clip.id });
}

function renderReview(card) {
  const clip = clipById(card.id);
  const face = reviewFace(clip);
  const seen = card.reps ? `Remembered ${card.reps}× in a row` : card.lapses ? "This one's been slippery" : "First review";
  return clipEl("review", "violet", `
    <div class="clip-body">
      <span class="clip-tag">🧠 Review · ${esc(seen)}</span>
      <p class="clip-sub">Do you remember what this means?</p>
      <p class="clip-big">${esc(face.prompt)}</p>
      <div class="reveal-box">
        <button class="opt reveal">Show answer</button>
        <p class="answer">${esc(face.answer)}</p>
      </div>
      <div class="options grades" hidden>
        <button class="opt" data-grade="again">Forgot</button>
        <button class="opt" data-grade="good">Got it</button>
        <button class="opt" data-grade="easy">Easy</button>
      </div>
      <p class="quiz-result" aria-live="polite"></p>
    </div>
    <div class="clip-meta">
      <div class="creator"><span class="avatar" style="--a:#c6b3ff;--b:#8a4dff">LR</span><b>LangRoll</b></div>
      <p class="caption">the feed brings words back right before you'd forget them. that's the whole trick.</p>
      <p class="sound">${EQ} spaced repetition</p>
    </div>`, { id: card.id });
}

function renderDuel() {
  const L = lang();
  const rival = CREATORS.priya;
  return clipEl("duel", "ink", `
    <div class="clip-body">
      <span class="clip-tag">⚡ Duel · ${esc(L.name)} numbers</span>
      <p class="clip-q duel-title">10 questions. Fastest wins.</p>
      <div class="racers">
        <div class="racer you"><span class="avatar" style="--a:#ff9a7a;--b:#e8473b">You</span><span class="bar"><i></i></span><b class="pct">0</b></div>
        <div class="racer them">${avatar(rival)}<span class="bar"><i></i></span><b class="pct">0</b></div>
      </div>
      <div class="duel-play">
        <button class="opt duel-start">Start duel</button>
      </div>
      <p class="duel-result" aria-live="polite"></p>
    </div>
    <div class="clip-meta">
      <div class="creator">${avatar(rival)}<b>@${esc(rival.handle)}</b><button class="follow" data-creator="priya">${state.following.includes("priya") ? "Following" : "Follow"}</button></div>
      <p class="caption">rematch? you got lucky last time 😤 · record ${state.duels.won}–${state.duels.played - state.duels.won}</p>
      <p class="sound">${EQ} duel mode</p>
    </div>`);
}

function renderDone() {
  const n = cardsForLang().length;
  return clipEl("review", "violet", `
    <div class="clip-body">
      <span class="clip-tag">🧠 Review</span>
      <p class="clip-big">All caught up.</p>
      <p class="clip-sub">${n ? `${n} word${n === 1 ? "" : "s"} in your deck. They'll pop back when they're due.` : "Words you learn or save on the feed show up here for review."}</p>
      <div class="options"><button class="opt go-foryou">Back to the feed</button></div>
    </div>`, { done: "1" });
}

// For-you mixes fresh clips with due reviews and the odd duel.
function nextItem() {
  const due = dueCards().filter((c) => !feedEl.querySelector(`.clip.review[data-id="${c.id}"]:not(.graded)`));
  if (due.length && sinceReview >= 3) {
    sinceReview = 0;
    return renderReview(due[0]);
  }
  if (sinceDuel >= 7) {
    sinceDuel = 0;
    return renderDuel();
  }
  if (!queue.length) queue = shuffle(lang().clips);
  sinceReview++;
  sinceDuel++;
  return renderContent(queue.shift());
}

function appendBatch(n = 5) {
  for (let i = 0; i < n; i++) {
    const el = nextItem();
    feedEl.appendChild(el);
    observer.observe(el);
    rendered++;
  }
}

function buildFeed() {
  stopClipTimers();
  feedEl.innerHTML = "";
  active = null;
  rendered = 0;
  queue = [];
  sinceReview = 1;
  sinceDuel = 3;
  feedEl.scrollTop = 0;
  if (mode === "review") {
    const due = dueCards();
    due.forEach((c) => { const el = renderReview(c); feedEl.appendChild(el); observer.observe(el); });
    const done = renderDone();
    feedEl.appendChild(done);
    observer.observe(done);
  } else {
    appendBatch(6);
  }
  // activate now rather than waiting for the observer, so the first clip never renders blank
  setActive(feedEl.firstElementChild);
  $$(".top-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
}

// =========================================================
// Active clip
// =========================================================
const observer = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) setActive(e.target); });
}, { root: feedEl, threshold: 0.6 });

function stopClipTimers() {
  while (clipTimers.length) clearInterval(clipTimers.pop());
}

const onEnter = {
  vocab(el) {
    const clip = clipById(el.dataset.id);
    ensureCard(clip.id);
    persist();
    renderHud();
    const syl = $$(".phonetic span", el);
    let i = 0;
    clipTimers.push(setInterval(() => {
      syl.forEach((s, j) => s.classList.toggle("on", j === i));
      i = (i + 1) % (syl.length + 2);
    }, 420));
    // autoplay pronunciation once the browser allows audio (after any tap)
    if (navigator.userActivation?.hasBeenActive) speak(clip.term);
  },
  flip(el) {
    ensureCard(el.dataset.id);
    persist();
    renderHud();
  },
};

function setActive(el) {
  if (el === active) return;
  if (active?.dataset.kind === "duel") resetDuel(active);
  active = el;
  stopClipTimers();
  stopSpeech();
  $$(".clip", feedEl).forEach((c) => c.classList.toggle("active", c === el));
  $("#feed-screen").dataset.tone = el.classList.contains("clip-peach") ? "light" : "";
  updateRail();
  onEnter[el.dataset.kind]?.(el);

  const idx = $$(".clip", feedEl).indexOf(el);
  if (mode === "foryou" && idx >= rendered - 3) appendBatch();
}

// =========================================================
// Rail: like, save, listen, share
// =========================================================
const likeBtn = $("#rail .like");
const saveBtn = $("#rail .save");

function updateRail() {
  const id = active?.dataset.id;
  $("#rail").classList.toggle("hidden", !id);
  if (!id) return;
  const liked = state.liked.includes(id);
  const saved = state.saved.includes(id);
  likeBtn.classList.toggle("on", liked);
  likeBtn.setAttribute("aria-pressed", String(liked));
  saveBtn.classList.toggle("on", saved);
  saveBtn.setAttribute("aria-pressed", String(saved));
  $("small", saveBtn).textContent = saved ? "Saved" : "Save";
}

function toggleIn(list, id) {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1); else list.push(id);
  return i < 0;
}

function setLike(on) {
  const id = active?.dataset.id;
  if (!id) return;
  if (state.liked.includes(id) !== on) toggleIn(state.liked, id);
  persist();
  updateRail();
  restart(likeBtn, "pop");
}

likeBtn.addEventListener("click", () => setLike(!state.liked.includes(active?.dataset.id)));

saveBtn.addEventListener("click", () => {
  const id = active?.dataset.id;
  if (!id) return;
  const on = toggleIn(state.saved, id);
  // saving puts the word straight into the review queue
  if (on) state.cards[id] = dueSoon(ensureCard(id));
  persist();
  updateRail();
  renderHud();
  restart(saveBtn, "pop");
  toast(on ? "🔖 Saved. It'll come back in review" : "Removed from saved");
});

$("#rail .listen").addEventListener("click", () => {
  const clip = clipById(active?.dataset.id);
  if (!clip) return;
  const text = clip.kind === "quiz" ? clip.q.replace("___", clip.answer) : reviewFace(clip).prompt;
  if (!speak(text, true)) toast("🔇 Audio isn't supported on this browser");
});

$("#rail .share").addEventListener("click", async () => {
  const clip = clipById(active?.dataset.id);
  const face = clip ? reviewFace(clip) : { prompt: "LangRoll", answer: "" };
  const data = { title: "LangRoll", text: `${face.prompt} = ${face.answer}. Learning ${lang().name} on LangRoll`, url: location.href };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(`${data.text} ${data.url}`); toast("↗ Link copied"); }
  } catch (e) { /* share sheet dismissed */ }
});

// double-tap to like; ignore taps that were really scroll gestures
let lastTap = 0;
let downAt = null;
feedEl.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; });
feedEl.addEventListener("pointerup", (e) => {
  if (e.target.closest("button") || !downAt) return;
  if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 10) { lastTap = 0; return; }
  const now = Date.now();
  if (now - lastTap < 320 && active?.dataset.id) {
    const heart = $("#big-heart");
    heart.style.left = e.clientX + "px";
    heart.style.top = e.clientY + "px";
    restart(heart, "go");
    if (!state.liked.includes(active.dataset.id)) setLike(true);
    lastTap = 0;
  } else {
    lastTap = now;
  }
});

// =========================================================
// Clip interactions (delegated)
// =========================================================
feedEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const el = btn.closest(".clip");
  const clip = clipById(el.dataset.id);

  if (btn.classList.contains("follow")) {
    const on = toggleIn(state.following, btn.dataset.creator);
    persist();
    $$(`.follow[data-creator="${btn.dataset.creator}"]`).forEach((b) => {
      b.classList.toggle("on", on);
      b.textContent = on ? "Following" : "Follow";
    });
    return;
  }
  if (btn.classList.contains("play")) {
    if (!speak(clip.kind === "speak" ? clip.line : clip.term, true)) toast("🔇 Audio isn't supported on this browser");
    return;
  }
  if (btn.classList.contains("go-foryou")) return switchMode("foryou");

  switch (el.dataset.kind) {
    case "quiz": return answerQuiz(el, clip, btn);
    case "speak": return speakBack(el, clip, btn);
    case "flip": return flipCard(el, btn);
    case "review": return reviewCard(el, btn);
    case "duel": return duelClick(el, btn);
  }
});

function answerQuiz(el, clip, opt) {
  if (!opt.classList.contains("opt") || el.classList.contains("solved")) return;
  const result = $(".quiz-result", el);
  if (opt.dataset.v === clip.answer) {
    el.classList.add("solved");
    $$(".opt", el).forEach((o) => {
      o.disabled = true;
      o.classList.toggle("right", o === opt);
      o.classList.toggle("wrong", o !== opt);
    });
    const firstTry = !el.classList.contains("missed");
    result.textContent = firstTry ? `Correct! ${clip.explain}` : `There it is. ${clip.explain}`;
    ensureCard(clip.id);
    addXP(firstTry ? 10 : 5, opt);
    confettiFrom(opt);
  } else {
    restart(opt, "shake");
    opt.disabled = true;
    opt.classList.add("wrong");
    result.textContent = "Not quite. Try again!";
    // a miss means this one needs practice soon
    if (!el.classList.contains("missed")) {
      el.classList.add("missed");
      state.cards[clip.id] = dueSoon(ensureCard(clip.id));
      persist();
      renderHud();
    }
  }
}

function showScore(el, clip, score) {
  const ring = $(".score-ring", el);
  ring.style.setProperty("--score", score + "%");
  $("b", ring).textContent = score;
  const [title, sub] = score >= 85 ? ["Great accent!", "a native speaker would get you"]
    : score >= 60 ? ["Almost there", "listen once more and go again"]
    : ["Keep going", "tap 🔊 and copy the rhythm"];
  $(".score-text", el).innerHTML = `${title}<br><small>${sub}</small>`;
  el.classList.add("scored");
  if (score >= 60 && !el.classList.contains("earned")) {
    el.classList.add("earned");
    ensureCard(clip.id);
    addXP(score >= 85 ? 15 : 8, ring);
    if (score >= 85) confettiFrom(ring);
  }
}

const MIC_ERRORS = {
  "not-allowed": IOS
    ? "mic blocked. allow it in Settings › Safari › Microphone, then reload. for now, rate yourself"
    : "mic blocked. allow it from the 🔒 in the address bar, then reload. for now, rate yourself",
  "service-not-allowed": IOS
    ? "speech recognition is off. turn on Settings › Siri › Dictation (or Talk to Siri), then reload. for now, rate yourself"
    : "speech recognition isn't allowed in this browser. rate yourself instead",
  "audio-capture": "no microphone found. say it out loud, then rate yourself",
  "network": "speech recognition needs internet. say it out loud, then rate yourself",
  "language-not-supported": "this browser can't recognise this language yet. rate yourself instead",
};

async function speakBack(el, clip, btn) {
  const hint = $(".mic-hint", el);
  if (btn.classList.contains("again")) {
    el.classList.remove("scored");
    hint.textContent = Recognition ? "tap the mic and say it" : "say it out loud, then rate yourself";
    return;
  }
  if (btn.dataset.rate) {
    $(".self-rate", el).hidden = true;
    return showScore(el, clip, btn.dataset.rate === "good" ? 90 : 40);
  }
  if (!btn.classList.contains("mic") || el.classList.contains("listening")) return;

  if (!Recognition) {
    $(".self-rate", el).hidden = false;
    hint.textContent = "how did it sound?";
    return;
  }
  el.classList.add("listening");
  // the hint only says "listening" once the mic is really open, so a stuck mic is visible
  hint.textContent = "starting the mic…";
  onMicOpen = () => { hint.textContent = "listening… say it now"; };
  stopSpeech(); // playback and recording fight over the audio session on iOS
  try {
    const heard = await listen(lang().speech);
    el.classList.remove("listening");
    if (!heard.length) { hint.textContent = "didn't hear anything. tap the mic and speak up"; return; }
    const score = Math.max(...heard.map((h) => similarity(clip.line, h)));
    hint.textContent = `heard: "${heard[0]}"`;
    showScore(el, clip, score);
  } catch (err) {
    el.classList.remove("listening");
    if (err === "no-speech") {
      hint.textContent = "didn't hear anything. tap the mic and speak up";
      return;
    }
    if (err === "aborted") {
      hint.textContent = "tap the mic and say it";
      return;
    }
    // anything else won't fix itself on a retry: explain it and let them rate themselves
    hint.textContent = MIC_ERRORS[err] || `the mic didn't work here (${err}). say it out loud, then rate yourself`;
    $(".self-rate", el).hidden = false;
  } finally {
    onMicOpen = null;
  }
}

function flipCard(el, btn) {
  if (!btn.classList.contains("flip-card")) return;
  btn.classList.toggle("flipped");
  if (btn.classList.contains("flipped")) {
    speak(clipById(el.dataset.id).front);
    if (!el.classList.contains("earned")) {
      el.classList.add("earned");
      addXP(5, btn);
    }
  }
}

function reviewCard(el, btn) {
  if (btn.classList.contains("reveal")) {
    el.classList.add("revealed");
    $(".grades", el).hidden = false;
    speak(reviewFace(clipById(el.dataset.id)).prompt);
    return;
  }
  const grade = btn.dataset.grade;
  if (!grade || el.classList.contains("graded")) return;
  el.classList.add("graded");
  $$(".grades .opt", el).forEach((o) => {
    o.disabled = true;
    o.classList.toggle("right", o === btn);
  });
  const card = schedule(ensureCard(el.dataset.id), grade);
  state.cards[card.id] = card;
  persist();
  addXP(grade === "again" ? 2 : 5, btn);
  $(".quiz-result", el).textContent = grade === "again"
    ? "No stress. It'll pop up again soon."
    : `Locked in 🧠 back ${relDue(card.due)}`;
  if (grade !== "again") confettiFrom(btn, 12);
}

// =========================================================
// Duels: you answer 10 number questions while your rival races on a timer
// =========================================================
const duels = new WeakMap();

function drawDuel(el, d) {
  [["you", d.you], ["them", d.them]].forEach(([who, n]) => {
    $(`.racer.${who} .bar i`, el).style.width = n * 10 + "%";
    $(`.racer.${who} .pct`, el).textContent = n;
  });
}

function duelQuestion(el, d) {
  const [word, answer] = d.questions[d.you];
  const wrong = shuffle(lang().duel.map((p) => p[1]).filter((v) => v !== answer)).slice(0, 3);
  $(".duel-play", el).innerHTML = `
    <p class="duel-word">${esc(word)}</p>
    <div class="options duel-opts">${shuffle([answer, ...wrong]).map((v) => `<button class="opt" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div>`;
}

function startDuel(el) {
  const pairs = lang().duel;
  const questions = Array.from({ length: 10 }, (_, i) => pairs[(i + Math.floor(Math.random() * pairs.length)) % pairs.length]);
  const d = { you: 0, them: 0, questions: shuffle(questions), over: false };
  duels.set(el, d);
  el.classList.add("running");
  $(".duel-result", el).textContent = "";
  drawDuel(el, d);
  duelQuestion(el, d);
  speak(d.questions[0][0]);
  // rival answers one question every ~1.3–2.3s
  const tick = () => {
    if (d.over) return;
    d.them++;
    drawDuel(el, d);
    if (d.them >= 10) return endDuel(el, d, false);
    d.timer = setTimeout(tick, 1300 + Math.random() * 1000);
  };
  d.timer = setTimeout(tick, 2200);
}

function endDuel(el, d, won) {
  d.over = true;
  clearTimeout(d.timer);
  state.duels.played++;
  if (won) state.duels.won++;
  persist();
  const result = $(".duel-result", el);
  result.textContent = won ? "You win! 🏆" : "Priya got there first 😤";
  result.classList.toggle("win", won);
  $(".duel-play", el).innerHTML = `<button class="opt duel-start">${won ? "Run it back" : "Rematch"}</button>`;
  el.classList.remove("running");
  if (won) {
    addXP(25, result);
    confettiFrom(result);
  }
}

function resetDuel(el) {
  const d = duels.get(el);
  if (!d || d.over) return;
  d.over = true;
  clearTimeout(d.timer);
  el.classList.remove("running");
  $(".duel-play", el).innerHTML = `<button class="opt duel-start">Start duel</button>`;
  $(".duel-result", el).textContent = "";
  drawDuel(el, { you: 0, them: 0 });
}

function duelClick(el, btn) {
  if (btn.classList.contains("duel-start")) return startDuel(el);
  const d = duels.get(el);
  if (!d || d.over || !btn.dataset.v) return;
  if (btn.dataset.v === d.questions[d.you][1]) {
    d.you++;
    drawDuel(el, d);
    if (d.you >= 10) return endDuel(el, d, true);
    duelQuestion(el, d);
  } else {
    restart(btn, "shake");
    btn.disabled = true;
  }
}

// =========================================================
// Screens: onboarding, feed, deck, profile
// =========================================================
const screens = { onboard: $("#onboard"), feed: $("#feed-screen"), deck: $("#deck-screen"), me: $("#me-screen") };

function show(name) {
  Object.entries(screens).forEach(([k, el]) => { el.hidden = k !== name; });
  $("#tabbar").hidden = name === "onboard";
  $$("#tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.screen === name));
  if (name !== "feed") stopSpeech();
  if (name === "deck") renderDeck();
  if (name === "me") renderMe();
  if (name === "feed") renderHud();
}

function switchMode(m) {
  mode = m;
  buildFeed();
  show("feed");
}

$$("#tabbar button").forEach((b) => b.addEventListener("click", () => show(b.dataset.screen)));
$$(".top-tabs .tab").forEach((t) => t.addEventListener("click", () => switchMode(t.dataset.mode)));

// --- onboarding ---
let pickLang = state.lang;
let pickGoal = state.goal;

function renderOnboard() {
  $("#lang-grid").innerHTML = Object.entries(LANGS).map(([code, L]) =>
    `<button class="lang-btn${code === pickLang ? " on" : ""}" data-lang="${code}"><span>${L.flag}</span><b>${L.name}</b></button>`).join("");
  $("#goal-row").innerHTML = GOALS.map((g) =>
    `<button class="goal-btn${g.xp === pickGoal ? " on" : ""}" data-goal="${g.xp}"><b>${g.label}</b><small>${g.sub}</small></button>`).join("");
  $("#start").disabled = !pickLang;
  $("#start").textContent = state.lang ? "Save" : "Start scrolling";
}

$("#lang-grid").addEventListener("click", (e) => {
  const b = e.target.closest(".lang-btn");
  if (!b) return;
  pickLang = b.dataset.lang;
  renderOnboard();
});
$("#goal-row").addEventListener("click", (e) => {
  const b = e.target.closest(".goal-btn");
  if (!b) return;
  pickGoal = Number(b.dataset.goal);
  renderOnboard();
});
$("#start").addEventListener("click", () => {
  const changed = pickLang !== state.lang;
  state.lang = pickLang;
  state.goal = pickGoal;
  persist();
  if (changed) { mode = "foryou"; buildFeed(); }
  show("feed");
});

// --- deck ---
function renderDeck() {
  const cards = cardsForLang().sort((a, b) => a.due - b.due);
  const due = cards.filter((c) => c.due <= Date.now()).length;
  const strong = cards.filter((c) => c.interval >= 7).length;
  $("#deck-stats").innerHTML = `
    <div><b>${cards.length}</b><small>words</small></div>
    <div><b>${due}</b><small>due now</small></div>
    <div><b>${strong}</b><small>strong</small></div>`;
  $("#deck-review").disabled = !due;
  $("#deck-review").textContent = due ? `Review ${due} due word${due === 1 ? "" : "s"}` : "Nothing due right now";
  $("#deck-list").innerHTML = cards.length ? cards.map((c) => {
    const face = reviewFace(clipById(c.id));
    const saved = state.saved.includes(c.id);
    return `<li class="${c.due <= Date.now() ? "due" : ""}">
      <span class="deck-word"><b>${esc(face.prompt)}</b><small>${esc(face.answer)}</small></span>
      <span class="deck-due">${saved ? "🔖 " : ""}${relDue(c.due)}</span>
    </li>`;
  }).join("") : `<li class="empty">Nothing yet. Words you see, miss or save on the feed land here.</li>`;
}
$("#deck-review").addEventListener("click", () => switchMode("review"));

// --- profile ---
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  if (!screens.me.hidden) renderMe();
});

function renderMe() {
  rollDay();
  const L = lang();
  const pct = Math.min(100, Math.round((state.today.xp / state.goal) * 100));
  $("#me-lang").textContent = `${L.flag} ${L.name}`;
  $("#goal-ring").style.setProperty("--p", pct);
  $("#goal-ring b").textContent = state.today.xp;
  $("#goal-ring small").textContent = `/ ${state.goal} XP`;
  $("#me-stats").innerHTML = `
    <div><b>🔥 ${currentStreak()}</b><small>day streak</small></div>
    <div><b>${state.xp}</b><small>total XP</small></div>
    <div><b>${state.duels.won}/${state.duels.played}</b><small>duels won</small></div>
    <div><b>${state.liked.length}</b><small>likes</small></div>`;
  $("#sound-toggle").checked = state.sound;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $("#install-row").hidden = standalone || (!installPrompt && !ios);
  $("#install-hint").textContent = installPrompt ? "Add LangRoll to your home screen" : "Tap Share, then Add to Home Screen";
  $("#install").hidden = !installPrompt;
}

$("#change-lang").addEventListener("click", () => {
  pickLang = state.lang;
  pickGoal = state.goal;
  renderOnboard();
  show("onboard");
});
$("#sound-toggle").addEventListener("change", (e) => {
  state.sound = e.target.checked;
  persist();
});
$("#install").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  renderMe();
});
$("#reset").addEventListener("click", () => {
  if (!confirm("Reset all progress? Your XP, streak and deck will be erased.")) return;
  try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  location.reload();
});

// =========================================================
// Boot
// =========================================================
renderOnboard();
if (state.lang) {
  buildFeed();
  show("feed");
} else {
  show("onboard");
}

// refresh due counts while the app stays open
setInterval(renderHud, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) renderHud(); });

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => { /* offline support is a bonus */ });
}
