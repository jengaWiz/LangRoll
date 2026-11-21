// Plays the scenes in watch clips with YouTube's embedded player, made to feel like the feed's
// own video rather than an embed:
// - The next scene's player is created ahead, loaded but not playing, so it starts at once.
//   It stays out of sight behind the video's own thumbnail until its first frame plays, so
//   swiping in shows a picture instead of a player waiting to be pressed.
// - A player that has played is closed when its clip is left, never paused to be resumed later:
//   once paused, YouTube keeps its title and controls over the video for several seconds after
//   it plays again. Coming back to a scene starts a fresh player.
// - A player lives in the feed, placed over its clip's slot, so it scrolls with the clip natively.
// - YouTube shows its title and logo over the video for about 3 seconds whenever a video starts
//   or jumps. So each scene starts a few seconds before its line, and loops back to there: the
//   overlay plays over that run-up, and the line itself always plays clean. The line under the
//   video lights up while it's being said.
// - YouTube's own controls are on. A tap on the video brings up its play and sound buttons, which
//   work in every browser, because Safari only allows sound after a tap inside the video itself.
//   They appear with the title, so they too fall in the run-up rather than over the line.
// YouTube's rules (developers.google.com/youtube/terms/developer-policies) shape the rest: a
// player on show is visible and tappable with its branding, nothing is drawn over it, and
// nothing plays off screen.
const Watch = (() => {
  const API = "https://www.youtube.com/iframe_api";
  const LOOKAHEAD = 3;        // create the next scene's player if it's within this many clips
  const BLOCKED_AFTER = 1200; // ms to wait for sound before deciding the browser blocked it
  const RUN_UP = 4.5;         // seconds of run-up: YouTube's overlay lasted up to 4s in testing
  const REVEAL_AFTER = 700;   // ms: show a player that hasn't started by now, so it can be pressed

  // Where a scene starts playing, and where it loops back to.
  const from = (clip) => Math.max(0, clip.start - RUN_UP);

  const players = new Map(); // clip element -> { wrap, yt, ready, queued, el, clip }
  const broken = new Set(); // videos that can't play here (removed, or embedding turned off)
  let api = null;
  let failed = false;
  let feed = null;
  let current = null;
  let generation = 0;
  let tickTimer = 0;
  let hooks = { sound: () => true, setSound() {}, unavailable() {}, hint() {} };

  function init(feedEl, appHooks) {
    feed = feedEl;
    hooks = { ...hooks, ...appHooks };
    new ResizeObserver(() => players.forEach(place)).observe(feed);
    document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  }

  // Whether a scene can go in the feed right now.
  function usable(clip) {
    return !failed && navigator.onLine !== false && !broken.has(clip.video);
  }

  function load() {
    if (api) return api;
    api = new Promise((resolve, reject) => {
      if (window.YT?.Player) return resolve(window.YT);
      const before = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { before?.(); resolve(window.YT); };
      const script = document.createElement("script");
      script.src = API;
      script.async = true;
      script.onerror = () => reject(new Error("the YouTube player didn't load"));
      document.head.appendChild(script);
      setTimeout(() => reject(new Error("the YouTube player took too long to load")), 15000);
    });
    api.catch(() => {
      failed = true;
      feed.querySelectorAll(".clip.watch").forEach((el) => hooks.unavailable(el));
    });
    return api;
  }

  // Creates a player for a scene, loaded at its start and waiting. A player is always created
  // with its video: one created empty reports an error straight away.
  function create(YT, el, clip) {
    const wrap = document.createElement("div");
    wrap.className = "watch-player";
    const mount = document.createElement("div");
    wrap.appendChild(mount);
    feed.appendChild(wrap);
    const p = { wrap, yt: null, ready: false, queued: [], el, clip };
    players.set(el, p);
    el.style.setProperty("--watch-done", "0");
    place(p);
    p.yt = new YT.Player(mount, {
      host: "https://www.youtube-nocookie.com", // YouTube's privacy-enhanced mode
      width: "100%",
      height: "100%",
      videoId: clip.video,
      playerVars: { start: Math.floor(from(clip)), playsinline: 1, controls: 1, rel: 0, iv_load_policy: 3, fs: 0, disablekb: 1, origin: location.origin },
      events: {
        onReady: () => { p.ready = true; p.queued.splice(0).forEach((fn) => fn()); },
        onStateChange: (e) => stateChanged(p, e.data),
        onError: (e) => videoFailed(p, e.data),
      },
    });
    return p;
  }

  function close(p) {
    players.delete(p.el);
    clearTimeout(p.revealTimer);
    p.el.classList.remove("playing", "speaking");
    if (p === current) {
      current = null;
      clearInterval(tickTimer);
    }
    p.yt.destroy?.();
    p.wrap.remove();
  }

  // Runs now if the player is ready, otherwise once it is, in the order asked.
  function whenReady(p, fn) {
    if (p.ready) fn(); else p.queued.push(fn);
  }

  // Lines the player up with its clip's video slot, in fractions of a pixel so no sliver of the
  // thumbnail shows round the edge.
  function place(p) {
    const slot = p.el.querySelector(".watch-slot");
    if (!slot || !p.wrap.isConnected) return;
    const r = slot.getBoundingClientRect();
    const f = feed.getBoundingClientRect();
    Object.assign(p.wrap.style, {
      top: `${r.top - f.top + feed.scrollTop}px`,
      left: `${r.left - f.left + feed.scrollLeft}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    p.wrap.classList.toggle("tall", slot.classList.contains("tall"));
  }

  // Called whenever the feed's active clip changes, and when the feed comes back into view.
  function show(active) {
    const run = ++generation;
    if (current && current.el === active) return; // already playing it
    // close the scene just left, players thrown away with the feed, and scenes no longer close by
    if (current) close(current);
    const clips = [...feed.querySelectorAll(".clip")];
    const at = clips.indexOf(active);
    const wanted = [];
    if (active?.dataset.kind === "watch") wanted.push(active);
    const next = clips.slice(at + 1, at + 1 + LOOKAHEAD).find((c) => c.dataset.kind === "watch");
    if (next) wanted.push(next);
    for (const p of [...players.values()]) {
      if (!p.el.isConnected || !wanted.includes(p.el)) close(p);
    }
    if (failed) {
      if (active?.dataset.kind === "watch") hooks.unavailable(active);
      return;
    }
    if (!wanted.length) return;

    load().then((YT) => {
      if (run !== generation) return; // the feed has moved on
      for (const el of wanted) {
        const clip = clipById(el.dataset.id);
        if (clip && !broken.has(clip.video) && !players.has(el)) create(YT, el, clip);
      }
      const p = players.get(active);
      if (p) play(p);
    }, () => {});
  }

  function play(p) {
    current = p;
    place(p);
    whenReady(p, () => {
      if (p !== current) return;
      if (hooks.sound()) p.yt.unMute(); else p.yt.mute();
      p.yt.playVideo();
      // A browser that won't start a video out of sight (or at all) gets it shown anyway, with
      // YouTube's play button, rather than leaving the thumbnail up.
      p.revealTimer = setTimeout(() => { if (p === current) p.wrap.classList.add("live"); }, REVEAL_AFTER);
      tick();
      if (!p.yt.isMuted()) checkSound(p);
    });
  }

  // Browsers only play sound after a tap. If this one blocked it, play muted and say how to fix it.
  // `asked` is whether the learner just pressed the sound button: if even that was blocked, only
  // YouTube's own sound button, inside the video, will do.
  function checkSound(p, asked = false) {
    setTimeout(() => {
      if (p !== current || p.yt.getPlayerState() === YT.PlayerState.PLAYING) return;
      p.yt.mute();
      p.yt.playVideo();
      hooks.hint(asked ? "in-video" : "button");
      updateControls(p);
    }, BLOCKED_AFTER);
  }

  function stateChanged(p, s) {
    if (p !== current) return;
    // the player comes out from behind the thumbnail with its first frame
    if (s === YT.PlayerState.PLAYING) {
      p.wrap.classList.add("live");
      p.el.classList.add("playing");
    }
    // a scene that runs to the end of the video loops too
    if (s === YT.PlayerState.ENDED) { p.yt.seekTo(from(p.clip), true); p.yt.playVideo(); }
    updateControls(p);
  }

  // 100: the video was removed or made private. 101 and 150: its owner turned embedding off.
  // Other errors may be this browser's, so the scene is skipped now but not for good.
  const GONE = [100, 101, 150];

  function videoFailed(p, code) {
    if (GONE.includes(code)) broken.add(p.clip.video);
    close(p);
    hooks.unavailable(p.el);
  }

  // Loops the scene, moves its progress bar through the line, and lights the line up while
  // it's being said.
  function tick() {
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      const p = current;
      if (!p?.ready) return clearInterval(tickTimer);
      const { start, end } = p.clip;
      let t = p.yt.getCurrentTime();
      if (t >= end - 0.05) {
        t = from(p.clip);
        p.yt.seekTo(t, true);
      }
      const done = Math.min(1, Math.max(0, (t - start) / (end - start)));
      p.el.style.setProperty("--watch-done", done.toFixed(3));
      p.el.classList.toggle("speaking", t >= start - 0.15 && t < end);
    }, 100);
  }

  function updateControls(p) {
    const btn = p.el.querySelector(".watch-sound");
    if (!btn || !p.ready) return;
    const muted = p.yt.isMuted();
    btn.textContent = muted ? "🔇" : "🔊";
    btn.setAttribute("aria-label", muted ? "Turn sound on" : "Turn sound off");
    btn.setAttribute("aria-pressed", String(!muted));
  }

  // The sound button under the video. The choice sticks for every scene after this one.
  function toggleSound() {
    const p = current;
    if (!p?.ready) return;
    const on = p.yt.isMuted();
    hooks.setSound(on);
    if (on) {
      p.yt.unMute();
      p.yt.playVideo();
      checkSound(p, true);
    } else {
      p.yt.mute();
    }
    updateControls(p);
  }

  // Leaving the feed or the app: close the playing scene rather than pause it (see the top).
  function pause() {
    generation++;
    if (current) close(current);
  }

  return { init, usable, show, pause, toggleSound };
})();
