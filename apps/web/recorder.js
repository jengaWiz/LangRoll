// Records the learner saying a line, as the 16 kHz mono 16-bit WAV that pronunciation scoring
// takes (apps/api/src/speech.ts). Works the same in every browser, because it captures raw samples
// with Web Audio rather than relying on each browser's own recording formats.
//
// Recording stops by itself shortly after the learner stops talking, when they tap again
// (stop()), or at the time limit.
const Recorder = (() => {
  const RATE = 16000;
  const MAX_MS = 8000;     // a line takes a few seconds; the API allows 15
  const QUIET_MS = 1100;   // this long without speech, after some speech, ends the recording
  const SPEECH_LEVEL = 0.02; // RMS above this counts as talking

  const supported = Boolean(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
  let stopNow = null;

  async function record({ onOpen } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const chunks = [];
    try {
      if (ctx.state === "suspended") await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessor is deprecated but runs everywhere, including older iPhones, with no extra
      // file to load; at this rate and length its cost is negligible.
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0; // keep the graph running without playing the mic back
      source.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
      onOpen?.();

      await new Promise((resolve) => {
        const started = performance.now();
        let heardAt = 0;
        let quietSince = 0;
        const finish = () => { clearTimeout(cap); node.onaudioprocess = null; stopNow = null; resolve(); };
        const cap = setTimeout(finish, MAX_MS);
        stopNow = finish;
        node.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          chunks.push(new Float32Array(input));
          let sum = 0;
          for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
          const loud = Math.sqrt(sum / input.length) > SPEECH_LEVEL;
          const now = performance.now();
          if (loud) { heardAt = heardAt || now; quietSince = 0; } else if (heardAt) { quietSince = quietSince || now; }
          if (heardAt && quietSince && now - quietSince > QUIET_MS && now - started > 1000) finish();
        };
      });
      source.disconnect();
      node.disconnect();
      return toWav(chunks, ctx.sampleRate);
    } finally {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    }
  }

  // Ends a recording in progress, as when the mic is tapped again.
  function stop() {
    stopNow?.();
  }

  // Joins the chunks, resamples to 16 kHz by averaging, and writes a WAV file.
  function toWav(chunks, fromRate) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    const ratio = fromRate / RATE;
    const n = Math.floor(total / ratio);
    const pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const from = Math.floor(i * ratio);
      const to = Math.min(total, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = from; j < to; j++) sum += all[j];
      const v = Math.max(-1, Math.min(1, sum / Math.max(1, to - from)));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    const buf = new ArrayBuffer(44 + pcm.byteLength);
    const view = new DataView(buf);
    const text = (o, s) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + pcm.byteLength, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, RATE, true);
    view.setUint32(28, RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, pcm.byteLength, true);
    new Int16Array(buf, 44).set(pcm);
    return { wav: buf, seconds: n / RATE };
  }

  // base64 for the JSON request body
  function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  return { supported, record, stop, toBase64 };
})();
