// LangRoll app: an endless feed of language clips with XP, streaks and spaced review.
// Content lives in content.js, review scheduling in srs.js. Everything persists to localStorage.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// This file's own ?v= number, bumped on every release, identifies the build in feedback.
const APP_VERSION = `app-v${new URL(document.currentScript.src).searchParams.get("v") || "dev"}`;
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
    installed: false,
    installSnoozedUntil: 0,
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
// A language can be retired (the launch keeps es, fr and ja). Anyone who had picked one goes
// back to language selection instead of the app crashing on content that no longer exists.
if (state.lang && !LANGS[state.lang]) state.lang = null;

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
    case "watch": return { prompt: clip.line, answer: clip.meaning };
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

// The phone's own voice is the fallback for lines without a recording, so pick its best one, not
// the first that matches. Browsers name their good voices: Edge's "Online (Natural)", Apple's
// "Premium" and "Enhanced" downloads, Chrome's "Google" voices. Apple also lists novelty voices
// (Grandma, Rocko…) in every language; those come last. The course's own accent comes first.
const GOOD_VOICE = /natural|neural|premium|enhanced|google/i;
const NOVELTY_VOICE = /\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;
function pickVoice(code) {
  if (!voices.length) loadVoices(); // Safari doesn't always say when its voices are ready
  const norm = (v) => v.lang.replace("_", "-").toLowerCase();
  const want = code.toLowerCase();
  const score = (v) =>
    (norm(v) === want ? 100 : norm(v).startsWith(want.slice(0, 2)) ? 50 : -1000) +
    (/premium/i.test(v.name) ? 12 : 0) +
    (GOOD_VOICE.test(v.name) ? 10 : 0) +
    (NOVELTY_VOICE.test(v.name) ? -20 : 0) +
    (v.localService ? 1 : 0); // all else equal, a voice that works offline
  let best = null;
  for (const v of voices) if (score(v) > 0 && (!best || score(v) > score(best))) best = v;
  return best;
}

const IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let silentHintShown = false;
let lastUtterance = null;

// Natural recordings of every word and line, made by scripts/generate-audio.mjs with a native
// speaker's voice. The phone's built-in voice is only a fallback, for text not recorded yet.
let recordings = {};
fetch("audio/manifest.json")
  .then((r) => (r.ok ? r.json() : {}))
  .then((m) => { recordings = m; })
  .catch(() => { /* offline before the first visit: the phone's voice still works */ });
// One element for every recording: once a tap has let it play, iPhones let it play again.
const voicePlayer = new Audio();
voicePlayer.preload = "auto";

function recordingFor(text) {
  const file = recordings[state.lang]?.[String(text).trim()];
  return file ? `audio/${file}` : null;
}

// cancel() right before speak() can swallow the next utterance, so only cancel real playback
function stopSpeech() {
  if (!voicePlayer.paused) voicePlayer.pause();
  if (window.speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
}

// `force` means the user tapped a sound button, so failures are worth telling them about
function speak(text, force = false) {
  if (!state.sound && !force) return false;
  const src = recordingFor(text);
  if (!src) return speakWithVoice(text, force);
  stopSpeech();
  voicePlayer.src = src;
  voicePlayer.currentTime = 0;
  voicePlayer.play().catch((e) => {
    // AbortError: another line started first. NotAllowedError: no tap yet, so stay quiet.
    // Anything else means the file didn't load, so say it with the phone's voice instead.
    if (e.name !== "AbortError" && e.name !== "NotAllowedError") speakWithVoice(text, force);
  });
  return true;
}

function speakWithVoice(text, force) {
  if (!window.speechSynthesis || (!state.sound && !force)) return false;
  const code = lang().speech;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = code;
  u.rate = 0.9;
  const voice = pickVoice(code);
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

const LISTEN_MS = 6000; // how long to record once the mic is open
const MIC_OPEN_MS = 20000; // how long to wait for the mic, including the permission prompt

function listen(code) {
  return new Promise((resolve, reject) => {
    const r = new Recognition();
    r.lang = code;
    r.interimResults = false;
    r.maxAlternatives = 5;
    let heard = [];
    let timer = null;
    const stop = () => { try { r.stop(); } catch (e) { /* already stopped */ } };
    r.onresult = (e) => { heard = Array.from(e.results[0]).map((a) => a.transcript); };
    r.onerror = (e) => { clearTimeout(timer); reject(e.error); };
    r.onend = () => { clearTimeout(timer); resolve(heard); };
    // Start the recording window only once the mic is open. Counting from the tap let a
    // slow "Allow microphone?" prompt (asked on every visit by iOS Safari) use it all up.
    r.onaudiostart = () => {
      clearTimeout(timer);
      timer = setTimeout(stop, LISTEN_MS);
      onMicOpen?.();
    };
    try { r.start(); } catch (e) { reject(e.name || "start-failed"); return; }
    timer = setTimeout(() => {
      r.onend = null;
      r.onerror = null;
      try { r.abort(); } catch (e) { /* already stopped */ }
      reject("mic-timeout");
    }, MIC_OPEN_MS);
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
let installOffered = false; // the install card shows at most once per visit
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
  // Marks text in the language being learned, so screen readers use the right voice and the
  // browser applies that language's line-breaking rules. English text around it stays unmarked.
  const inLang = `lang="${L.speech}"`;
  switch (clip.kind) {
    case "vocab":
      return `${tag}
        <p class="clip-big" ${inLang}>${esc(clip.term)}</p>
        <p class="clip-sub">${esc(clip.meaning)}</p>
        <div class="phonetic">${clip.phon.map((p, i) => `<span class="${i === clip.hit ? "hit" : ""}">${esc(p)}</span>`).join("")}</div>
        <button class="play" aria-label="Hear it"><span class="wave" aria-hidden="true">${WAVE}</span><b>🔊 Hear it</b></button>`;
    case "quiz":
      return `${tag}
        <p class="clip-q" ${inLang}>${esc(clip.q)}</p>
        <p class="clip-sub">${esc(clip.sub)}</p>
        <div class="options">${shuffle(clip.options).map((o) => `<button class="opt" data-v="${esc(o)}" ${inLang}>${esc(o)}</button>`).join("")}</div>
        <p class="quiz-result" aria-live="polite"></p>`;
    case "speak":
      return `${tag}
        <p class="clip-sub">Say it out loud</p>
        <p class="clip-big speak-line" ${inLang}>${esc(clip.line)}</p>
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
          <span class="face front"><b class="${/[぀-ヿ一-鿿]/.test(clip.front) ? ([...clip.front].length > 2 ? "jp long" : "jp") : "word"}" ${inLang}>${esc(clip.front)}</b><small>tap to flip</small></span>
          <span class="face back"><b>${esc(clip.reading)}</b><span>${esc(clip.meaning)}</span><small>${esc(clip.note)}</small></span>
        </button>`;
    case "watch":
      // Like, save and share sit under the video, as on YouTube: the floating rail would cover
      // the player, and YouTube's rules don't allow anything in front of it.
      return `${tag}
        <p class="clip-q watch-line${[...clip.line].length > 45 ? " long" : ""}" ${inLang}>${esc(clip.line)}</p>
        <p class="clip-sub">${esc(clip.meaning)}</p>
        <div class="watch-actions">
          <button class="watch-sound" aria-label="Turn sound on" aria-pressed="false">🔇</button>
          <button data-act="like" aria-pressed="false"><span aria-hidden="true">♥</span>Like</button>
          <button data-act="save" aria-pressed="false"><span aria-hidden="true">🔖</span>Save</button>
          <button data-act="share"><span aria-hidden="true">↗</span>Share</button>
        </div>`;
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

// A scene from a YouTube video. The video's own thumbnail shows until a player (watch.js)
// starts playing over it.
function renderWatch(clip) {
  const video = encodeURIComponent(clip.video);
  const poster = `https://i.ytimg.com/vi/${video}/hqdefault.jpg`;
  const el = clipEl("watch", "ink", `
    <div class="watch-slot ${clip.shape === "tall" ? "tall" : "wide"}"><img class="watch-poster" src="${poster}" alt="" decoding="async"></div>
    <div class="watch-progress" aria-hidden="true"><i></i></div>
    <div class="clip-body">${bodyHTML(clip)}</div>
    <div class="clip-meta">
      <a class="watch-source" href="https://www.youtube.com/watch?v=${video}&amp;t=${Math.floor(clip.start)}s" target="_blank" rel="noopener">Scene from ${esc(clip.channel)} · YouTube ↗</a>
      <p class="caption">${esc(clip.caption)}</p>
    </div>`, { id: clip.id });
  el.style.setProperty("--poster", `url("${poster}")`);
  return el;
}

function renderContent(clip) {
  if (clip.kind === "watch") return renderWatch(clip);
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

// Getting the app without an app store: a card a few clips into a visit, with the steps for this
// browser. It comes early on purpose: an iPhone's Home Screen app keeps its own storage, apart from
// Safari, so progress made in Safari doesn't move over.
const INSTALL_AFTER = 6; // clips into the feed before the card can show
const INSTALL_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const SHARE_ICON = `<svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4M8 10H6v11h12V10h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderInstall(how) {
  const steps = {
    ios: `<li>Tap <b>Share</b> ${SHARE_ICON}<small>No Share button? Tap <b>•••</b> first</small></li>
          <li>Tap <b>Add to Home Screen</b></li>
          <li>Tap <b>Add</b></li>`,
    menu: `<li>Tap <b>⋮</b> in your browser</li>
           <li>Tap <b>Install app</b> or <b>Add to Home screen</b></li>`,
  }[how];
  const el = clipEl("install", "blue", `
    <div class="clip-body">
      <span class="clip-tag">📲 Get the app · free</span>
      <p class="clip-q">Add LangRoll to your Home Screen</p>
      <p class="clip-sub">${how === "ios" ? "Do it early: the Home Screen app keeps its own progress, apart from Safari." : "It opens full screen like any app and works offline."}</p>
      ${steps ? `<ol class="install-steps">${steps}</ol>` : ""}
      <div class="options install-actions">
        ${how === "prompt" ? `<button class="opt" data-install="now">Install</button>` : `<button class="opt" data-install="done">I added it</button>`}
        <button class="opt" data-install="later">Not now</button>
      </div>
      <p class="quiz-result" aria-live="polite"></p>
    </div>
    <div class="clip-meta">
      <div class="creator"><span class="avatar" style="--a:#7d93ff;--b:#3646d6">LR</span><b>LangRoll</b></div>
      <p class="caption">no app store, no download 📲</p>
    </div>`);
  $(".glyph", el).textContent = "📲";
  return el;
}

async function installClick(el, btn) {
  const action = btn.dataset.install;
  if (!action || el.classList.contains("answered")) return;
  const result = $(".quiz-result", el);
  const settle = (text) => {
    el.classList.add("answered");
    $$(".install-actions .opt", el).forEach((o) => { o.disabled = true; o.classList.toggle("right", o === btn); });
    result.textContent = text;
  };
  if (action === "later" || (action === "now" && !(await promptInstall()))) {
    state.installSnoozedUntil = Date.now() + INSTALL_SNOOZE_MS;
    persist();
    return settle("No problem. It's under You whenever you want it.");
  }
  if (action === "done") { state.installed = true; persist(); }
  settle("📲 Nice! Open LangRoll from your Home Screen from now on.");
  confettiFrom(btn, 12);
}

// Scenes are the feed's highlight but only a few of the clips, so a plain shuffle could leave one
// 30 clips down. Each round deals the first scene third (after a lesson or two, by which time
// there's been a tap and sound can play) and spreads the rest about every six clips.
const FIRST_SCENE_AT = 2;
const SCENE_EVERY = 6;
function dealScenes(clips) {
  const scenes = clips.filter((c) => c.kind === "watch");
  const rest = clips.filter((c) => c.kind !== "watch");
  scenes.forEach((scene, i) => rest.splice(Math.min(rest.length, FIRST_SCENE_AT + i * SCENE_EVERY), 0, scene));
  return rest;
}

// For-you mixes fresh clips with due reviews and the odd duel.
function nextItem() {
  const how = installMethod();
  if (how && !installOffered && rendered >= INSTALL_AFTER && Date.now() >= state.installSnoozedUntil) {
    installOffered = true;
    return renderInstall(how);
  }
  const due =dueCards().filter((c) => !feedEl.querySelector(`.clip.review[data-id="${c.id}"]:not(.graded)`));
  if (due.length && sinceReview >= 3) {
    sinceReview = 0;
    return renderReview(due[0]);
  }
  if (sinceDuel >= 7) {
    sinceDuel = 0;
    return renderDuel();
  }
  // scenes drop out when YouTube can't be reached or a video stops playing
  const playable = (c) => c.kind !== "watch" || Watch.usable(c);
  let clip = queue.shift();
  while (clip && !playable(clip)) clip = queue.shift();
  if (!clip) {
    queue = dealScenes(shuffle(lang().clips.filter(playable)));
    clip = queue.shift();
  }
  sinceReview++;
  sinceDuel++;
  return renderContent(clip);
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
  // only the clips: the video players stay, so they don't have to load again
  for (const c of $$(".clip", feedEl)) c.remove();
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
  setActive($(".clip", feedEl));
  $$(".top-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
}

// =========================================================
// Active clip
// =========================================================
Watch.init(feedEl, {
  // Sound needs an earlier tap; before one, scenes start muted rather than not at all.
  sound: () => state.sound && navigator.userActivation?.hasBeenActive !== false,
  setSound(on) { state.sound = on; persist(); },
  hint(how) {
    toast(how === "in-video" ? "🔇 Tap the video, then YouTube's sound button" : "🔇 Sound is off. Tap 🔇 under the video", 3000);
  },
  // A scene that can't play: drop it if it's still ahead, otherwise say so where it would be.
  unavailable(el) {
    const ahead = active && el !== active && active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (ahead && el.isConnected) {
      observer.unobserve(el);
      el.remove();
    } else {
      el.classList.add("unavailable");
    }
  },
});

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
    Sync.record("clip_viewed", clip.id);
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
    Sync.record("clip_viewed", el.dataset.id);
    persist();
    renderHud();
  },
  watch(el) {
    onEnter.flip(el);
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
  Watch.show(el);

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
  const overVideo = active?.dataset.kind === "watch";
  $("#rail").classList.toggle("hidden", !id || overVideo);
  $("#rail").classList.toggle("over-video", overVideo);
  if (!id) return;
  const liked = state.liked.includes(id);
  const saved = state.saved.includes(id);
  // watch clips carry their own row of the same buttons
  for (const [act, on] of [["like", liked], ["save", saved]]) {
    const b = $(`.watch-actions [data-act="${act}"]`, active);
    if (!b) continue;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
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
  Sync.record("clip_saved", id, { saved: on });
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
  if (e.target.closest("button, a") || !downAt) return;
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
  if (btn.classList.contains("watch-sound")) return Watch.toggleSound();
  // a watch clip's action row works the rail's buttons, so both behave the same
  if (btn.dataset.act) return $(`#rail .${btn.dataset.act}`).click();

  switch (el.dataset.kind) {
    case "quiz": return answerQuiz(el, clip, btn);
    case "speak": return speakBack(el, clip, btn);
    case "flip": return flipCard(el, btn);
    case "review": return reviewCard(el, btn);
    case "duel": return duelClick(el, btn);
    case "install": return installClick(el, btn);
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
    Sync.record("quiz_answered", clip.id, { firstTry });
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
  Sync.record("speech_scored", clip.id, { score: Math.round(score) });
  // any attempt puts the line in the deck, as it does on the server
  ensureCard(clip.id);
  persist();
  if (score >= 60 && !el.classList.contains("earned")) {
    el.classList.add("earned");
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
  "mic-timeout": "the mic never opened. allow microphone access and try again, or rate yourself",
};

// Pronunciation scoring on our server (Azure, see apps/api/src/speech.ts), when signed in. If the
// server can't score, the rest of the visit uses the phone's own recognition instead.
let serverScoring = true;
const canScoreOnServer = () => serverScoring && Sync.enabled && Recorder.supported;

async function scoreOnServer(el, clip, hint) {
  el.classList.add("listening", "recording");
  hint.textContent = "starting the mic…";
  stopSpeech(); // playback and recording fight over the audio session on iOS
  let take;
  try {
    take = await Recorder.record({ onOpen: () => { hint.textContent = "listening… say it, then tap the mic"; } });
  } catch (err) {
    el.classList.remove("listening", "recording");
    hint.textContent = MIC_ERRORS[err?.name === "NotAllowedError" ? "not-allowed" : "audio-capture"];
    $(".self-rate", el).hidden = false;
    return;
  }
  el.classList.remove("recording");
  // nothing usable was captured: ask again rather than pay to score silence
  if (take.seconds < 0.3) {
    el.classList.remove("listening");
    hint.textContent = "didn't catch that. tap the mic and say it again";
    return;
  }
  hint.textContent = "checking how it sounded…";
  try {
    const result = await Sync.api("POST", "/speech/assess", { lang: state.lang, text: clip.line, audio: Recorder.toBase64(take.wav) });
    if (result.status === "no_speech") {
      hint.textContent = "didn't hear anything. tap the mic and speak up";
      return;
    }
    hint.textContent = result.heard ? `heard: "${result.heard}"` : "";
    showWords(el, clip, result.words);
    showScore(el, clip, result.score);
  } catch (err) {
    if (err.status === 429 && err.code !== "daily_limit") {
      hint.textContent = "that's a lot of tries! wait a moment, then go again";
      return;
    }
    // used up today's checks, or the server can't score: the phone's recognition from here on
    serverScoring = false;
    hint.textContent = err.code === "daily_limit"
      ? "that's today's pronunciation checks. how did it sound?"
      : "couldn't check that one. how did it sound?";
    $(".self-rate", el).hidden = false;
  } finally {
    el.classList.remove("listening");
  }
}

// Shows the line word by word, marked by how each word came out. Where the scorer's words line
// up with the line's own, the line keeps its spelling and punctuation; otherwise (Japanese, which
// has no spaces, or a different split) the scorer's words are shown.
function showWords(el, clip, words) {
  const said = (words || []).filter((w) => w.error !== "Insertion");
  if (!said.length) return;
  const mark = (w) => (w.error === "Omission" ? "missed" : w.accuracy >= 80 ? "good" : w.accuracy >= 60 ? "ok" : "work");
  const own = clip.line.split(/\s+/);
  const lineUp = state.lang !== "ja" && own.length === said.length;
  const shown = said.map((w, i) => `<span class="w ${mark(w)}" title="${w.accuracy}%">${esc(lineUp ? own[i] : w.word)}</span>`);
  $(".speak-line", el).innerHTML = shown.join(state.lang === "ja" ? "" : " ");
}

async function speakBack(el, clip, btn) {
  const hint = $(".mic-hint", el);
  if (btn.classList.contains("again")) {
    el.classList.remove("scored");
    $(".speak-line", el).textContent = clip.line;
    hint.textContent = Recognition ? "tap the mic and say it" : "say it out loud, then rate yourself";
    return;
  }
  if (btn.dataset.rate) {
    $(".self-rate", el).hidden = true;
    return showScore(el, clip, btn.dataset.rate === "good" ? 90 : 40);
  }
  if (!btn.classList.contains("mic")) return;
  // a second tap while recording means "done"
  if (el.classList.contains("listening")) {
    if (el.classList.contains("recording")) Recorder.stop();
    return;
  }
  if (canScoreOnServer()) return scoreOnServer(el, clip, hint);

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
      Sync.record("card_flipped", el.dataset.id);
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
  Sync.record("review_graded", card.id, { grade });
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
  Sync.record("duel_finished", `${state.lang}-duel`, { won });
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
  if (name !== "feed") { stopSpeech(); Watch.pause(); }
  if (name === "deck") renderDeck();
  if (name === "me") renderMe();
  if (name === "feed") { renderHud(); Watch.show(active); }
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
// Sync failures never interrupt learning: the app runs from localStorage and retries later.
const syncFailed = (err) => console.warn("sync:", err.message);

// The server is the source of truth for XP, streaks and the deck. The screen updates instantly
// from the local copy, then takes the server's numbers once everything recorded here has been
// uploaded, so they're the real ones and editing localStorage doesn't stick.
function applyServer(server) {
  if (!server || !state.lang) return;
  const { totalXp, today, streak } = server.progress;
  state.xp = totalXp;
  if (today.day === dayKey()) state.today = { day: today.day, xp: today.xp, goalHit: today.goalHit };
  state.streak = streak.current
    ? { count: streak.current, last: today.xp > 0 ? today.day : yesterdayKey() }
    : { count: 0, last: null };
  // The server doesn't send ease. A guest account belongs to one phone, so this phone made every
  // review the server knows about, and its own ease is the server's: keep it across the swap.
  const local = {};
  for (const id of Object.keys(state.cards)) {
    if (id.startsWith(state.lang + "-")) { local[id] = state.cards[id]; delete state.cards[id]; }
  }
  for (const c of server.cards) {
    state.cards[c.clipId] = { id: c.clipId, due: Date.parse(c.dueAt), interval: c.intervalDays, ease: local[c.clipId]?.ease ?? 2.5, reps: c.reps, lapses: c.lapses };
  }
  persist();
  renderHud();
  if (screens.me && !screens.me.hidden) renderMe();
  if (screens.deck && !screens.deck.hidden) renderDeck();
}

function refreshFromServer() {
  return Sync.pull().then(applyServer, syncFailed);
}

// Profile first, so the server knows the language before we ask for its deck.
function syncProfile() {
  return Sync.saveProfile({ lang: state.lang, goal: state.goal }).then(refreshFromServer, syncFailed);
}

// Learners who used the app before it synced keep their words: each card and saved clip is sent
// once as a "seen" or "saved" event, which gives it a card on the server. Old XP can't move over,
// because the server only counts XP it worked out itself.
const MIGRATED = "langroll:migrated";
function migrateLocalDeck() {
  if (!Sync.enabled) return;
  let done = false;
  try { done = localStorage.getItem(MIGRATED) === "1"; } catch (e) { /* storage blocked */ }
  if (done) return;
  const known = (id) => Boolean(clipById(id));
  const cards = Object.keys(state.cards).filter(known);
  const saved = state.saved.filter(known);
  cards.forEach((id) => Sync.record("clip_viewed", id));
  saved.forEach((id) => Sync.record("clip_saved", id, { saved: true }));
  try { localStorage.setItem(MIGRATED, "1"); } catch (e) { /* storage blocked */ }
  if (state.xp > 0 || cards.length) toast("☁️ Your progress now syncs to your account. Your words came with you", 4500);
}

$("#start").addEventListener("click", () => {
  const changed = pickLang !== state.lang;
  state.lang = pickLang;
  state.goal = pickGoal;
  persist();
  syncProfile();
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
window.addEventListener("appinstalled", () => {
  state.installed = true;
  installPrompt = null;
  persist();
  if (!screens.me.hidden) renderMe();
});

// How this browser adds LangRoll to the Home Screen: Chrome and Edge's own install prompt,
// Safari's Share menu (iPads included, which identify as Macs), or the browser menu on other
// Android browsers. Null once it's installed, or where there's no way to.
function installMethod() {
  if (state.installed || matchMedia("(display-mode: standalone)").matches || navigator.standalone) return null;
  if (installPrompt) return "prompt";
  if (IOS) return "ios";
  if (/Android/i.test(navigator.userAgent)) return "menu";
  return null;
}

// Shows the browser's install prompt, which works once; true if the learner installed.
async function promptInstall() {
  const prompt = installPrompt;
  installPrompt = null;
  if (!prompt) return false;
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === "accepted") { state.installed = true; persist(); }
  return outcome === "accepted";
}

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
  const how = installMethod();
  $("#install-row").hidden = !how;
  $("#install-hint").textContent = { prompt: "Add LangRoll to your home screen", ios: "Tap Share, then Add to Home Screen", menu: "Tap ⋮, then Install app" }[how] || "";
  $("#install").hidden = how !== "prompt";
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
  await promptInstall();
  renderMe();
});
// --- feedback ---
// A coarse device label ("iPhone Safari"), enough to spot device bugs without a full user agent.
function platformLabel() {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || IOS ? "iPad" : /Android/.test(ua) ? "Android"
    : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Other";
  const browser = /CriOS|Chrome/.test(ua) ? "Chrome" : /FxiOS|Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "Other";
  const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  return `${device} ${browser}${installed ? " (installed)" : ""}`;
}

const feedbackDialog = $("#feedback");
$("#feedback-open").addEventListener("click", () => {
  if (!Sync.enabled) return toast("Feedback works in the live app");
  feedbackDialog.showModal();
  $("#feedback-text").focus();
});
$("#feedback-form").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "send") return; // Cancel just closes the dialog
  e.preventDefault();
  const text = $("#feedback-text").value.trim();
  if (!text) return;
  const send = $("#feedback-send");
  send.disabled = true;
  try {
    await Sync.sendFeedback(text, APP_VERSION, platformLabel());
    $("#feedback-text").value = "";
    feedbackDialog.close();
    toast("💌 Thanks! The team will read it");
  } catch (err) {
    toast(err.status === 429 ? "That's a lot of feedback. Try again in a bit" : "Couldn't send. Check your connection and try again", 3500);
  } finally {
    send.disabled = false;
  }
});

// --- delete my data ---
// Deletes everything on the server first, and only then clears this phone, so a failed request
// never leaves the account half-deleted.
$("#reset").addEventListener("click", async () => {
  if (!confirm("Delete all your data? Your XP, streak, deck and feedback will be erased for good.")) return;
  if (Sync.enabled) {
    try {
      await Sync.deleteAccount();
    } catch (err) {
      return toast("Couldn't reach the server, so nothing was deleted. Try again when you're online", 4000);
    }
  }
  try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  location.reload();
});

// =========================================================
// Boot
// =========================================================
renderOnboard();
migrateLocalDeck();
if (state.lang) {
  buildFeed();
  show("feed");
  syncProfile();
} else {
  show("onboard");
}

// refresh due counts while the app stays open, and the server's numbers when it comes back
setInterval(renderHud, 30000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return; // watch.js pauses the video itself
  if (!screens.feed.hidden) Watch.show(active);
  renderHud();
  refreshFromServer();
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => { /* offline support is a bonus */ });
}
