import { FREQS, PRESETS, derivePlan } from "./plan.js";

const FREQ_LABELS = ["250", "500", "1k", "2k", "3k", "4k", "6k", "8k"];

const SOURCES = [
  { id: "sss", file: "audio/sss.wav", label: "sss (4–8 kHz)" },
  { id: "shh", file: "audio/shh.wav", label: "shh (2–4 kHz)" },
  { id: "fff", file: "audio/fff.wav", label: "fff" },
  { id: "eee", file: "audio/eee.wav", label: "eee" },
  { id: "fish", file: "audio/fish.wav", label: "fish" },
  { id: "sister", file: "audio/sister.wav", label: "sister" },
  { id: "fifty", file: "audio/fifty.wav", label: "fifty" },
  { id: "sentence", file: "audio/sentence.wav", label: "a thin sentence" },
  { id: "chirp", file: "audio/chirp.wav", label: "chirp 200–8k" },
];

const MODES = [
  { id: "original", label: "Normal ear" },
  { id: "loss", label: "His ear, no algorithm" },
  { id: "boost", label: "Turn the missing band up" },
  { id: "transpose", label: "Transpose it down" },
  { id: "compress", label: "Compress it down" },
];

const LISTEN = [
  { id: "ear", label: "His ear (after the hole)" },
  { id: "aid", label: "Aid output only" },
  { id: "dry", label: "Dry original" },
];

const LIVE_MODES = [
  { id: "original", label: "Her voice, no remap" },
  { id: "transpose", label: "Transpose f/s down" },
  { id: "compress", label: "Compress f/s down" },
];

const state = {
  thresh: PRESETS.ski.thresh.slice(),
  preset: "ski",
  mode: "loss",
  listen: "ear",
  source: "sss",
  deadDb: 90,
  dragging: -1,
  playing: false,
  useMic: false,
  live: false,
  liveMode: "transpose",
};

let audioCtx = null;
let workletNode = null;
let sourceNode = null;
let outputGain = null;
let micStream = null;
let bufferCache = new Map();
let currentBuf = null;
let specAid, specEar;

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg) {
  $("status").textContent = msg || "";
}

function currentPlan() {
  return derivePlan(state.thresh, FREQS, state.deadDb);
}

function syncWorklet() {
  if (!workletNode) return;
  const plan = currentPlan();
  workletNode.port.postMessage({
    mode: state.mode,
    listen: state.listen,
    thresh: state.thresh,
    freqs: FREQS,
    deadDb: state.deadDb,
    srcLo: plan.srcLo,
    srcHi: plan.srcHi,
    dstLo: plan.dstLo,
    dstHi: plan.dstHi,
    start: plan.start,
    ratio: plan.ratio,
    mix: 0.85,
  });
}

function renderVerdict() {
  const plan = currentPlan();
  const card = $("verdict");
  card.dataset.kind = plan.kind;
  $("verdictKicker").textContent =
    plan.kind === "captions"
      ? "Caption territory"
      : plan.kind === "split"
        ? "Use both"
        : plan.kind === "ordinary"
          ? "Aid first"
          : "Algorithm territory";
  $("verdictTitle").textContent = plan.title;
  $("verdictSummary").textContent = plan.summary;
  $("siiValue").textContent = plan.score.toFixed(2);
  $("siiBar").style.width = `${Math.round(plan.score * 100)}%`;
  $("planBlurb").textContent = `Remap plan: ${plan.blurb}`;
}

function drawAudiogram() {
  const canvas = $("audiogram");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 720;
  const cssH = 420;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pad = { l: 48, r: 16, t: 18, b: 36 };
  const w = cssW - pad.l - pad.r;
  const h = cssH - pad.t - pad.b;
  ctx.fillStyle = "#fffdf7";
  ctx.fillRect(0, 0, cssW, cssH);

  const xAt = (i) => pad.l + (i / (FREQS.length - 1)) * w;
  const yAt = (db) => pad.t + (db / 120) * h;

  // speech banana
  ctx.fillStyle = "rgba(201,187,164,0.28)";
  ctx.beginPath();
  const banana = [
    [0, 20],
    [1, 15],
    [2, 15],
    [3, 20],
    [4, 25],
    [5, 30],
    [6, 35],
    [7, 40],
    [7, 55],
    [6, 50],
    [5, 45],
    [4, 40],
    [3, 35],
    [2, 30],
    [1, 30],
    [0, 40],
  ];
  banana.forEach(([i, db], n) => {
    const fn = n === 0 ? "moveTo" : "lineTo";
    ctx[fn](xAt(i), yAt(db));
  });
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#eadfcb";
  ctx.lineWidth = 1;
  for (let db = 0; db <= 120; db += 10) {
    ctx.beginPath();
    ctx.moveTo(pad.l, yAt(db));
    ctx.lineTo(pad.l + w, yAt(db));
    ctx.stroke();
  }
  for (let i = 0; i < FREQS.length; i++) {
    ctx.beginPath();
    ctx.moveTo(xAt(i), pad.t);
    ctx.lineTo(xAt(i), pad.t + h);
    ctx.stroke();
  }

  ctx.strokeStyle = "#a43b28";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.l, yAt(90));
  ctx.lineTo(pad.l + w, yAt(90));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#5a5147";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let db = 0; db <= 120; db += 20) {
    ctx.fillText(String(db), pad.l - 8, yAt(db));
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  FREQ_LABELS.forEach((lab, i) => ctx.fillText(lab, xAt(i), pad.t + h + 8));
  ctx.save();
  ctx.translate(14, pad.t + h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("dB HL  (worse ↓)", 0, 0);
  ctx.restore();

  const plan = currentPlan();
  ctx.fillStyle = "rgba(164,59,40,0.10)";
  const srcA = freqToX(plan.srcLo, pad, w);
  const srcB = freqToX(plan.srcHi, pad, w);
  ctx.fillRect(srcA, pad.t, Math.max(4, srcB - srcA), h);
  ctx.fillStyle = "rgba(29,95,90,0.12)";
  const dA = freqToX(plan.dstLo, pad, w);
  const dB = freqToX(plan.dstHi, pad, w);
  ctx.fillRect(dA, pad.t, Math.max(4, dB - dA), h);

  ctx.strokeStyle = "#1d5f5a";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  state.thresh.forEach((db, i) => {
    const fn = i === 0 ? "moveTo" : "lineTo";
    ctx[fn](xAt(i), yAt(db));
  });
  ctx.stroke();

  state.thresh.forEach((db, i) => {
    ctx.beginPath();
    ctx.fillStyle = db >= state.deadDb ? "#a43b28" : "#1d5f5a";
    ctx.arc(xAt(i), yAt(db), 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fffdf7";
    ctx.beginPath();
    ctx.arc(xAt(i), yAt(db), 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function freqToX(f, pad, w) {
  const min = Math.log(FREQS[0]);
  const max = Math.log(FREQS[FREQS.length - 1]);
  const t = (Math.log(f) - min) / (max - min);
  return pad.l + t * w;
}

function hitIndex(ev) {
  const canvas = $("audiogram");
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const padL = 48;
  const padR = 16;
  const w = rect.width - padL - padR;
  let best = 0;
  let bestD = 1e9;
  for (let i = 0; i < FREQS.length; i++) {
    const px = padL + (i / (FREQS.length - 1)) * w;
    const d = Math.abs(px - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function setThreshFromEvent(ev, i) {
  const canvas = $("audiogram");
  const rect = canvas.getBoundingClientRect();
  const y = ev.clientY - rect.top;
  const padT = 18;
  const padB = 36;
  const h = rect.height - padT - padB;
  const db = ((y - padT) / h) * 120;
  state.thresh[i] = Math.round(Math.min(120, Math.max(0, db)) / 5) * 5;
  state.preset = "custom";
  refresh();
}

function refresh() {
  renderVerdict();
  drawAudiogram();
  syncWorklet();
}

function makeChipGroup(el, items, get, set) {
  el.innerHTML = "";
  for (const item of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = item.label;
    b.dataset.id = item.id;
    b.setAttribute("aria-pressed", get() === item.id ? "true" : "false");
    b.addEventListener("click", () => {
      set(item);
      [...el.children].forEach((c) =>
        c.setAttribute("aria-pressed", c.dataset.id === item.id ? "true" : "false")
      );
    });
    el.appendChild(b);
  }
}

function latencyMs() {
  if (!audioCtx) return 0;
  const base = audioCtx.baseLatency || 0;
  const out = audioCtx.outputLatency || 0;
  const algo = 1024 / audioCtx.sampleRate;
  return Math.round((base + out + algo) * 1000);
}

function setLiveMeter(msg) {
  $("liveMeter").textContent = msg;
}

function setLiveWarn(msg) {
  const el = $("liveWarn");
  el.textContent = msg || "";
  el.classList.toggle("show", Boolean(msg));
}

function applyLiveGain() {
  if (outputGain) outputGain.gain.value = Number($("liveGain").value);
}

async function ensureAudio() {
  if (audioCtx) return audioCtx;
  audioCtx = new AudioContext({ latencyHint: "interactive" });
  try {
    await audioCtx.audioWorklet.addModule("processor.js");
  } catch (err) {
    setStatus(`Audio engine failed to load: ${err.message}`);
    throw err;
  }
  workletNode = new AudioWorkletNode(audioCtx, "hearing-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  outputGain = audioCtx.createGain();
  applyLiveGain();
  workletNode.port.onmessage = (e) => {
    if (e.data && e.data.type === "ready") {
      setStatus("Engine ready.");
      return;
    }
    if (e.data && e.data.type === "fft") {
      paintSpec(specAid, e.data.aid, "aid");
      paintSpec(specEar, e.data.ear, "ear");
      $("specAidBox").classList.add("has-signal");
      $("specEarBox").classList.add("has-signal");
    }
  };
  workletNode.onprocessorerror = () => {
    setStatus("Audio processor crashed — reload the page.");
  };
  workletNode.connect(outputGain);
  outputGain.connect(audioCtx.destination);
  syncWorklet();
  return audioCtx;
}

function paintSpec(view, db, which) {
  const { ctx, w, h, image } = view;
  const data = image.data;
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const row = y * rowBytes;
    data.copyWithin(row, row + 8, row + rowBytes);
  }
  const plan = currentPlan();
  view.frames = (view.frames || 0) + 1;
  view.canvas.dataset.frames = String(view.frames);
  for (let y = 0; y < h; y++) {
    const i = Math.max(0, Math.min(db.length - 1, Math.round((1 - y / h) * (db.length - 1))));
    const v = db[i];
    const t = Math.min(1, Math.max(0, (v + 80) / 55));
    let r, g, b;
    if (which === "ear") {
      r = 28 + t * 210;
      g = 22 + t * 100;
      b = 16 + t * 36;
    } else {
      r = 22 + t * 90;
      g = 30 + t * 180;
      b = 28 + t * 150;
    }
    const f = 80 * Math.pow(8000 / 80, 1 - y / h);
    if (f >= plan.srcLo && f <= plan.srcHi) {
      r = Math.min(255, r + 50);
    }
    if (f >= plan.dstLo && f <= plan.dstHi) {
      g = Math.min(255, g + 40);
    }
    for (const dx of [0, 1]) {
      const off = (y * w + (w - 1 - dx)) * 4;
      data[off] = r;
      data[off + 1] = g;
      data[off + 2] = b;
      data[off + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function bindSpec(id) {
  const canvas = $(id);
  const ctx = canvas.getContext("2d");
  const w = 480;
  const h = 180;
  canvas.width = w;
  canvas.height = h;
  ctx.fillStyle = "#1b1712";
  ctx.fillRect(0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  return { canvas, ctx, w, h, image, frames: 0 };
}

async function loadBuffer(url) {
  if (bufferCache.has(url)) return bufferCache.get(url);
  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  const buf = await audioCtx.decodeAudioData(arr);
  bufferCache.set(url, buf);
  return buf;
}

function stopMicTracks() {
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
}

function stopSource() {
  if (sourceNode) {
    try {
      sourceNode.stop();
    } catch {
      /* already stopped */
    }
    try {
      sourceNode.disconnect();
    } catch {
      /* ok */
    }
    sourceNode = null;
  }
  stopMicTracks();
  state.playing = false;
  state.useMic = false;
  state.live = false;
  $("playBtn").textContent = "Play";
  $("liveBtn").textContent = "Start live listen";
  $("liveBtn").dataset.on = "false";
}

async function playCurrent() {
  await ensureAudio();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  stopSource();
  const src = SOURCES.find((s) => s.id === state.source);
  const buf = await loadBuffer(src.file);
  currentBuf = buf;
  const node = audioCtx.createBufferSource();
  node.buffer = buf;
  node.connect(workletNode);
  node.onended = () => {
    if (sourceNode === node) {
      state.playing = false;
      $("playBtn").textContent = "Play";
    }
  };
  node.start();
  sourceNode = node;
  state.playing = true;
  $("playBtn").textContent = "Stop";
  setStatus(`Playing ${src.label}`);
}

async function fillMicList() {
  const sel = $("micSelect");
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const mics = devices.filter((d) => d.kind === "audioinput");
  const current = sel.value;
  sel.innerHTML = "";
  if (!mics.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Default microphone";
    sel.appendChild(opt);
    return;
  }
  for (const d of mics) {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Microphone (${d.deviceId.slice(0, 6)})`;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
}

function micConstraints(preferDevice) {
  const deviceId = preferDevice && $("micSelect").value;
  const echo = $("echoToggle").checked;
  const audio = {
    echoCancellation: echo,
    noiseSuppression: false,
    autoGainControl: false,
  };
  if (deviceId) audio.deviceId = { ideal: deviceId };
  return { audio };
}

async function openMic() {
  try {
    return await navigator.mediaDevices.getUserMedia(micConstraints(true));
  } catch {
    return navigator.mediaDevices.getUserMedia(micConstraints(false));
  }
}

async function connectMic(forLive) {
  await ensureAudio();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  stopSource();
  const stream = await openMic();
  micStream = stream;
  await fillMicList();
  const node = audioCtx.createMediaStreamSource(stream);
  node.connect(workletNode);
  sourceNode = node;
  state.playing = true;
  state.useMic = true;
  $("playBtn").textContent = "Stop";
  applyLiveGain();
  syncWorklet();
  const lag = latencyMs();
  if (forLive) {
    if (lag >= 90) {
      setLiveWarn(
        `Reported delay about ${lag} ms. If speech feels late, use a headphone cable — Bluetooth is usually the culprit.`
      );
    } else {
      setLiveWarn("");
    }
  }
  return lag;
}

async function startMic() {
  try {
    const lag = await connectMic(false);
    setStatus(`Microphone live for the lab (~${lag} ms). Hiss sss / fff.`);
  } catch (err) {
    setStatus(`Microphone blocked: ${err.message}`);
  }
}

function pressListenChip(id) {
  state.listen = id;
  const box = $("listen");
  [...box.children].forEach((c) =>
    c.setAttribute("aria-pressed", c.dataset.id === id ? "true" : "false")
  );
}

function pressModeChip(id) {
  state.mode = id;
  const box = $("modes");
  [...box.children].forEach((c) =>
    c.setAttribute("aria-pressed", c.dataset.id === id ? "true" : "false")
  );
}

async function startLive() {
  state.mode = state.liveMode;
  state.listen = "aid";
  pressModeChip(state.mode);
  pressListenChip("aid");
  try {
    const lag = await connectMic(true);
    state.live = true;
    $("liveBtn").textContent = "Stop live listen";
    $("liveBtn").dataset.on = "true";
    const algo = LIVE_MODES.find((m) => m.id === state.liveMode).label;
    setLiveMeter(`Live · ${algo} · he hears remapped sound · ~${lag} ms`);
    setStatus("Live listen on — aid output only.");
  } catch (err) {
    setLiveMeter(`Microphone blocked: ${err.message}`);
    setLiveWarn("Allow the microphone when Chrome or Safari asks. System Settings → Privacy → Microphone.");
  }
}

function toggleLive() {
  if (state.live) {
    stopSource();
    setLiveMeter("Stopped. Headphones can come off.");
    setLiveWarn("");
    setStatus("");
    return;
  }
  startLive();
}

async function loadFile(file) {
  await ensureAudio();
  const arr = await file.arrayBuffer();
  const buf = await audioCtx.decodeAudioData(arr.slice(0));
  bufferCache.set("upload", buf);
  currentBuf = buf;
  stopSource();
  const node = audioCtx.createBufferSource();
  node.buffer = buf;
  node.connect(workletNode);
  node.onended = () => {
    if (sourceNode === node) {
      state.playing = false;
      $("playBtn").textContent = "Play";
    }
  };
  node.start();
  sourceNode = node;
  state.playing = true;
  $("playBtn").textContent = "Stop";
  setStatus(`Playing ${file.name}`);
}

function setupCaptions() {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const box = $("captionBox");
  const btn = $("captionBtn");
  const st = $("captionStatus");
  if (!Rec) {
    st.textContent = "This browser has no speech recogniser. Chrome or Edge will.";
    btn.disabled = true;
    return;
  }
  let rec = null;
  let on = false;
  btn.addEventListener("click", () => {
    if (on) {
      rec.stop();
      on = false;
      btn.textContent = "Start live captions";
      st.textContent = "Stopped.";
      return;
    }
    rec = new Rec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-GB";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript + (e.results[i].isFinal ? " " : "");
      }
      box.textContent = text.trim() || "…";
    };
    rec.onerror = (e) => {
      st.textContent = e.error === "not-allowed" ? "Microphone blocked." : e.error;
    };
    rec.onend = () => {
      if (on) rec.start();
    };
    rec.start();
    on = true;
    btn.textContent = "Stop captions";
    st.textContent = "Listening…";
    box.innerHTML = '<span class="idle">Listening…</span>';
  });
}

function setup() {
  specAid = bindSpec("specAid");
  specEar = bindSpec("specEar");

  const presetBox = $("presets");
  Object.entries(PRESETS).forEach(([id, p]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = p.label;
    b.dataset.id = id;
    b.setAttribute("aria-pressed", id === state.preset ? "true" : "false");
    b.addEventListener("click", () => {
      state.preset = id;
      state.thresh = p.thresh.slice();
      [...presetBox.children].forEach((c) =>
        c.setAttribute("aria-pressed", c.dataset.id === id ? "true" : "false")
      );
      refresh();
    });
    presetBox.appendChild(b);
  });

  makeChipGroup($("sources"), SOURCES, () => state.source, (item) => {
    state.source = item.id;
    if (state.playing && !state.useMic) playCurrent();
  });
  makeChipGroup($("modes"), MODES, () => state.mode, (item) => {
    state.mode = item.id;
    syncWorklet();
  });
  makeChipGroup($("listen"), LISTEN, () => state.listen, (item) => {
    state.listen = item.id;
    syncWorklet();
  });
  makeChipGroup($("liveModes"), LIVE_MODES, () => state.liveMode, (item) => {
    state.liveMode = item.id;
    if (state.live) {
      state.mode = item.id;
      state.listen = "aid";
      pressModeChip(item.id);
      pressListenChip("aid");
      syncWorklet();
      setLiveMeter(`Live · ${item.label} · he hears remapped sound · ~${latencyMs()} ms`);
    }
  });

  $("liveBtn").addEventListener("click", toggleLive);
  $("liveGain").addEventListener("input", applyLiveGain);
  $("echoToggle").addEventListener("change", () => {
    if (state.live) startLive();
  });
  $("micSelect").addEventListener("change", () => {
    if (state.live) startLive();
  });
  fillMicList().catch(() => {});

  const canvas = $("audiogram");
  canvas.addEventListener("pointerdown", (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    state.dragging = hitIndex(ev);
    setThreshFromEvent(ev, state.dragging);
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (state.dragging < 0) return;
    setThreshFromEvent(ev, state.dragging);
  });
  const endDrag = () => {
    state.dragging = -1;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  $("deadToggle").addEventListener("change", (e) => {
    state.deadDb = e.target.checked ? 90 : 130;
    refresh();
  });

  $("playBtn").addEventListener("click", () => {
    if (state.playing) stopSource();
    else playCurrent();
  });
  $("micBtn").addEventListener("click", startMic);
  $("file").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f);
  });

  window.addEventListener("resize", drawAudiogram);
  setupCaptions();
  refresh();
}

setup();
