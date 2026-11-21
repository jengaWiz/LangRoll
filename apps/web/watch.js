// Plays the scenes in watch clips with YouTube's embedded player, made to feel like the feed's
// own video rather than an embed:
// - Two players are reused for every scene. One plays the clip on screen while the other loads the
//   next scene ahead, so it starts at once. Reusing them, instead of one iframe per clip, also
//   keeps sound on across scenes on iPhone once the video has been tapped.
// - A player lives in the feed and is moved over its clip's slot by position only, because moving
//   an iframe to another parent reloads it. Being in the feed, it scrolls with the clip natively.
// - The scene loops between its start and end, like a short video.
// YouTube's rules (developers.google.com/youtube/terms/developer-policies) shape the rest: the
// player stays visible and tappable, nothing is drawn over it, and nothing plays off screen.
const Watch = (() => {
  const API = "https://www.youtube.com/iframe_api";
  const POOL = 2;
  const LOOKAHEAD = 3;        // load the next scene if it's within this many clips
  const BLOCKED_AFTER = 1200; // ms to wait for sound before deciding the browser blocked it

  const players = []; // { wrap, yt, ready, queued, el, clip, warming }
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

  // A player is created with its first scene: one created empty reports an error straight away.
  function createPlayer(YT, clip) {
    const wrap = document.createElement("div");
    wrap.className = "watch-player";
    wrap.hidden = true;
    const mount = document.createElement("div");
    wrap.appendChild(mount);
    feed.appendChild(wrap);
    const p = { wrap, yt: null, ready: false, queued: [], el: null, clip: null, video: clip.video, warming: false };
    p.yt = new YT.Player(mount, {
      host: "https://www.youtube-nocookie.com", // YouTube's privacy-enhanced mode
      width: "100%",
      height: "100%",
      videoId: clip.video,
      playerVars: { start: Math.floor(clip.start), playsinline: 1, controls: 0, rel: 0, iv_load_policy: 3, fs: 0, disablekb: 1, origin: location.origin },
      events: {
        onReady: () => { p.ready = true; p.queued.splice(0).forEach((fn) => fn()); },
        onStateChange: (e) => stateChanged(p, e.data),
        onError: (e) => videoFailed(p, e.data),
      },
    });
    players.push(p);
    return p;
  }

  // Runs now if the player is ready, otherwise once it is, in the order asked.
  function whenReady(p, fn) {
    if (p.ready) fn(); else p.queued.push(fn);
  }

  // Lines the player up with its clip's video slot.
  function place(p) {
    const slot = p.el?.querySelector(".watch-slot");
    if (!slot || !p.wrap.isConnected) return;
    // measured in fractions of a pixel, so no sliver of the thumbnail shows round the edge
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

  // Puts a scene on a player and buffers its start, so it plays at once when its clip comes up.
  function assign(p, el, clip) {
    p.el = el;
    p.clip = clip;
    place(p);
    p.wrap.hidden = false;
    const loaded = p.video === clip.video; // a new player already has its first scene
    p.video = clip.video;
    whenReady(p, () => {
      if (p === current) {
        if (!loaded) p.yt.cueVideoById({ videoId: clip.video, startSeconds: clip.start });
        return; // play() starts it
      }
      // Play muted for a moment to buffer, then stop at the start: stateChanged pauses it.
      p.warming = true;
      p.yt.mute();
      if (loaded) p.yt.playVideo();
      else p.yt.loadVideoById({ videoId: clip.video, startSeconds: clip.start });
    });
  }

  function release(p) {
    p.el = null;
    p.clip = null;
    p.wrap.hidden = true;
    whenReady(p, () => p.yt.stopVideo());
  }

  // Called whenever the feed's active clip changes, and when the feed comes back into view.
  function show(active) {
    const run = ++generation;
    // players whose iframe was thrown away with the feed can't be used again
    for (const p of [...players]) {
      if (!p.wrap.isConnected) { p.yt.destroy?.(); players.splice(players.indexOf(p), 1); }
    }
    pause();
    current = null;
    const clips = [...feed.querySelectorAll(".clip")];
    const at = clips.indexOf(active);
    const wanted = [];
    if (active?.dataset.kind === "watch") wanted.push(active);
    const next = clips.slice(at + 1, at + 1 + LOOKAHEAD).find((c) => c.dataset.kind === "watch");
    if (next) wanted.push(next);
    if (failed) {
      if (active?.dataset.kind === "watch") hooks.unavailable(active);
      return;
    }
    if (!wanted.length) return;

    load().then((YT) => {
      if (run !== generation) return; // the feed has moved on
      for (const el of wanted) {
        const clip = clipById(el.dataset.id);
        if (!clip || broken.has(clip.video)) continue;
        let p = players.find((q) => q.el === el);
        if (!p) {
          p = players.find((q) => !wanted.includes(q.el)) || (players.length < POOL ? createPlayer(YT, clip) : null);
          if (!p) continue;
          if (el === active) current = p; // so assign doesn't warm the one about to play
          assign(p, el, clip);
        }
        if (el === active) play(p);
      }
      players.filter((p) => p.el && !wanted.includes(p.el)).forEach(release);
    }, () => {});
  }

  function play(p) {
    current = p;
    p.warming = false;
    place(p);
    whenReady(p, () => {
      if (p !== current) return;
      p.yt.seekTo(p.clip.start, true);
      if (hooks.sound()) p.yt.unMute(); else p.yt.mute();
      p.yt.playVideo();
      tick();
      if (!p.yt.isMuted()) checkSound(p);
    });
  }

  // Browsers only play sound after a tap. If this one blocked it, play muted and say how to fix it.
  function checkSound(p) {
    const clip = p.clip;
    setTimeout(() => {
      if (p !== current || p.clip !== clip) return;
      if (p.yt.getPlayerState() === YT.PlayerState.PLAYING) return;
      p.yt.mute();
      p.yt.playVideo();
      hooks.hint(p.el);
      updateControls(p);
    }, BLOCKED_AFTER);
  }

  function stateChanged(p, s) {
    const S = YT.PlayerState;
    if (s === S.PLAYING && p.warming) {
      p.warming = false;
      p.yt.pauseVideo();
      p.yt.seekTo(p.clip.start, true);
      return;
    }
    if (p !== current) return;
    // A scene that runs to the end of the video loops too.
    if (s === S.ENDED) { p.yt.seekTo(p.clip.start, true); p.yt.playVideo(); }
    updateControls(p);
  }

  // 100: the video was removed or made private. 101 and 150: its owner turned embedding off.
  // Other errors may be this browser's, so the scene is skipped now but not for good.
  const GONE = [100, 101, 150];

  function videoFailed(p, code) {
    if (!p.clip) return;
    if (GONE.includes(code)) broken.add(p.clip.video);
    const el = p.el;
    if (p === current) current = null;
    release(p);
    hooks.unavailable(el);
  }

  // Loops the scene and moves its progress bar.
  function tick() {
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      const p = current;
      if (!p?.ready || !p.clip) return clearInterval(tickTimer);
      const { start, end } = p.clip;
      const t = p.yt.getCurrentTime();
      if (t >= end - 0.05) p.yt.seekTo(start, true);
      const done = Math.min(1, Math.max(0, (t - start) / (end - start)));
      p.el.style.setProperty("--watch-done", done.toFixed(3));
    }, 100);
  }

  function updateControls(p) {
    const btn = p.el?.querySelector(".watch-sound");
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
      checkSound(p);
    } else {
      p.yt.mute();
    }
    updateControls(p);
  }

  function pause() {
    clearInterval(tickTimer);
    if (current?.ready) current.yt.pauseVideo();
  }

  return { init, usable, show, pause, toggleSound };
})();
