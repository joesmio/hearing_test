import {
  createModel,
  currentTrial,
  unlockButtons,
  applyAnswer,
  resultCopy,
  sisterPrompt,
  workletForCondition,
} from "./protocol.js";
import { createSync } from "./sync.js";

const params = new URLSearchParams(location.search);
const uiTest = params.has("ui");
const perBlock = Math.max(2, Math.min(8, Number(params.get("n")) || 6));

let model = {
  view: "welcome",
  step: "say",
  block: "dry",
  index: 0,
  session: null,
  score: { dry: { n: 0, correct: 0 }, dsp: { n: 0, correct: 0 } },
  practiceWord: null,
  live: false,
  hissOn: false,
  seq: 1,
};

let audioCtx = null;
let audioReady = null;
let workletNode = null;
let outputGain = null;
let sourceNode = null;
let fileSource = null;
let micStream = null;
let analyser = null;
const tokenCache = new Map();

const $ = (id) => document.getElementById(id);

const sync = createSync({
  role: "sister",
  onAnswer: (word) => {
    if (model.view === "trial" && model.step === "listen") takeAnswer(word);
  },
});

function showError(msg) {
  const el = $("appError");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
}

window.addEventListener("error", (e) => showError(e.message || "Something broke on her laptop."));
window.addEventListener("unhandledrejection", (e) => {
  showError(String((e && e.reason && e.reason.message) || e.reason || e));
});

function trial() {
  return currentTrial(model);
}

function setWorklet(condition) {
  if (!workletNode) return;
  workletNode.port.postMessage(workletForCondition(condition));
}

function publish() {
  model.seq += 1;
  const list = model.session ? model.session[model.block] : [];
  model.progress = { n: list.length, i: model.index };
  sync.publish(model);
}

function show(name) {
  model.view = name;
  for (const id of ["view-practice", "view-trial", "view-results"]) {
    $(id).hidden = id !== `view-${name}`;
  }
  publish();
}

function renderTrial() {
  if (model.view === "results") {
    finish();
    return;
  }
  const t = trial();
  if (!t) {
    finish();
    return;
  }
  $("blockLabel").textContent =
    model.block === "dry" ? "First half — her voice as it is" : "Second half — computer trick on";
  const list = model.session[model.block];
  $("progress").innerHTML = list
    .map((_, i) => `<i class="${i < model.index ? "done" : i === model.index ? "now" : ""}"></i>`)
    .join("");
  $("sisterWord").textContent = sisterPrompt(t.word);
  $("sisterHint").textContent =
    model.step === "say" ? "Say it once, toward the lid. He cannot see this." : "Wait — his buttons are live.";
  $("saidIt").hidden = model.step !== "say";
  $("waitTap").hidden = model.step !== "listen";
  setWorklet(model.block === "dsp" || model.step === "listen" ? t.condition : model.block);
  show("trial");
}

function finish() {
  const copy = resultCopy(model.score);
  $("resultHeadline").textContent = copy.headline || "How you did";
  $("resultBody").textContent = copy.body || "";
  $("scoreDry").textContent = `${copy.dryFrac}  ${copy.dryPct}`;
  $("scoreDsp").textContent = `${copy.dspFrac}  ${copy.dspPct}`;
  model.view = "results";
  show("results");
}

function takeAnswer(word) {
  const next = applyAnswer(model, word);
  if (next === model) return;
  model = next;
  if (model.view === "results") finish();
  else renderTrial();
}

async function setupAudio() {
  audioCtx = new AudioContext({ latencyHint: "interactive" });
  await audioCtx.audioWorklet.addModule("processor.js");
  workletNode = new AudioWorkletNode(audioCtx, "hearing-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  outputGain = audioCtx.createGain();
  outputGain.gain.value = Number($("liveGain").value);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  workletNode.connect(outputGain);
  outputGain.connect(audioCtx.destination);
  outputGain.connect(analyser);
  workletNode.port.onmessage = (e) => {
    if (!e.data || e.data.type !== "fft") return;
    const db = e.data.aid;
    const hi = db.slice(Math.floor(db.length * 0.55));
    const hissOn = Math.max(...hi) > -55;
    $("hissLamp").classList.toggle("on", hissOn);
    if (hissOn !== model.hissOn) {
      model.hissOn = hissOn;
      publish();
    }
  };
  await fillOutputs();
  await applyOutput();
}

async function ensureAudio() {
  if (audioReady) return audioReady;
  audioReady = setupAudio().catch((err) => {
    audioReady = null;
    throw err;
  });
  return audioReady;
}

function stopFileSource() {
  if (!fileSource) return;
  try {
    fileSource.onended = null;
    fileSource.stop();
  } catch {
    /* already stopped */
  }
  try {
    fileSource.disconnect();
  } catch {
    /* ignore */
  }
  fileSource = null;
}

function reconnectMic() {
  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch {
      /* ignore */
    }
    sourceNode = null;
  }
  if (micStream && audioCtx && workletNode) {
    sourceNode = audioCtx.createMediaStreamSource(micStream);
    sourceNode.connect(workletNode);
  }
}

function tickLevel() {
  if (!analyser) return;
  const spec = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(spec);
  let peak = 0;
  for (const v of spec) peak = Math.max(peak, Math.abs(v - 128));
  $("levelBar").style.width = `${Math.min(100, (peak / 60) * 100)}%`;
  requestAnimationFrame(tickLevel);
}

async function fillOutputs() {
  const sel = $("outDevice");
  if (!sel || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outs = devices.filter((d) => d.kind === "audiooutput");
    const current = sel.value;
    sel.innerHTML = "";
    const def = document.createElement("option");
    def.value = "";
    def.textContent = "Mac default (use the headphone jack)";
    sel.appendChild(def);
    for (const d of outs) {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || "Headphones";
      sel.appendChild(opt);
    }
    if (current && [...sel.options].some((o) => o.value === current)) sel.value = current;
  } catch {
    /* labels need a prior permission */
  }
}

async function applyOutput() {
  const sel = $("outDevice");
  if (!sel || !audioCtx || typeof audioCtx.setSinkId !== "function") return;
  try {
    await audioCtx.setSinkId(sel.value || "");
  } catch (err) {
    showError(`Could not lock headphones: ${err.message}`);
  }
}

async function playBuffer(buffer, word) {
  await ensureAudio();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  stopFileSource();
  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch {
      /* ignore */
    }
    sourceNode = null;
  }
  setWorklet("practice");
  if (word) {
    model.practiceWord = word;
    if (model.view === "welcome") show("practice");
    else publish();
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(workletNode);
  fileSource = src;
  src.onended = () => {
    if (fileSource === src) fileSource = null;
    reconnectMic();
  };
  src.start();
  $("micStatus").textContent = word
    ? `Playing ${word.toUpperCase()} through the trick — hiss should sit lower.`
    : "Playing her recording through the trick.";
}

async function loadToken(stem) {
  if (tokenCache.has(stem)) return tokenCache.get(stem);
  const res = await fetch(`audio/${stem}.wav`);
  if (!res.ok) throw new Error(`Missing preview file audio/${stem}.wav`);
  await ensureAudio();
  const buf = await audioCtx.decodeAudioData(await res.arrayBuffer());
  tokenCache.set(stem, buf);
  return buf;
}

async function previewWord(word) {
  try {
    const buf = await loadToken(`${word}-a`);
    await playBuffer(buf, word);
  } catch (err) {
    showError(err.message || String(err));
  }
}

async function startLive() {
  $("micStatus").textContent = "Asking for the microphone…";
  try {
    await ensureAudio();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    stopFileSource();
    if (sourceNode) sourceNode.disconnect();
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
    if (!uiTest) {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: $("echoToggle").checked,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      sourceNode = audioCtx.createMediaStreamSource(micStream);
      sourceNode.connect(workletNode);
    }
    model.live = true;
    $("meterBox").hidden = false;
    $("micStatus").textContent = uiTest
      ? "UI test — no microphone. Preview files still play through the trick."
      : "Microphone is live. Talk toward the lid.";
    setWorklet("practice");
    await fillOutputs();
    show("practice");
    tickLevel();
  } catch (err) {
    $("micStatus").textContent = `Microphone blocked: ${err.message}`;
    showError(`Microphone blocked: ${err.message}`);
  }
}

function openHim() {
  const url = new URL("him.html", location.href);
  if (uiTest) url.searchParams.set("ui", "1");
  const w = window.open(url.toString(), "fee-see-him", "width=900,height=700");
  if (!w) $("himUrl").textContent = "Pop-up blocked — open him.html on the iPad instead.";
}

async function showWhere() {
  try {
    const res = await fetch("/where");
    const data = await res.json();
    const him = (data.urls || []).map((u) => u.replace(/\/?$/, "/him.html"));
    const lan = him.filter((u) => !u.includes("127.0.0.1"));
    $("himUrl").textContent = lan.length
      ? `Sidecar: Open his screen, then drag that window onto the iPad.  ·  iPad Safari: ${lan.join("  ·  ")}`
      : him.length
        ? `Sidecar: Open his screen, then drag that window onto the iPad.  ·  Same Mac: ${him[0]}`
        : "";
  } catch {
    $("himUrl").textContent = `Sidecar: Open his screen and drag it onto the iPad.  ·  iPad Safari: ${location.origin}/him.html`;
  }
}

$("openHim").addEventListener("click", openHim);
$("startMic").addEventListener("click", startLive);
$("practiceFee").addEventListener("click", () => {
  model.practiceWord = "fee";
  setWorklet("practice");
  publish();
});
$("practiceSee").addEventListener("click", () => {
  model.practiceWord = "see";
  setWorklet("practice");
  publish();
});
$("previewFee").addEventListener("click", () => previewWord("fee"));
$("previewSee").addEventListener("click", () => previewWord("see"));
$("herFile").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    await ensureAudio();
    const buf = await audioCtx.decodeAudioData(await file.arrayBuffer());
    await playBuffer(buf, null);
  } catch (err) {
    showError(`Could not play that file: ${err.message}`);
  }
});
$("beginTest").addEventListener("click", async () => {
  if (!model.live) await startLive();
  if (!model.live) return;
  try {
    await fetch("/sync?takeAnswers=1");
  } catch {
    /* offline file:// */
  }
  model = { ...createModel(perBlock, Date.now() % 100000), live: true };
  setWorklet("dry");
  renderTrial();
});
$("saidIt").addEventListener("click", () => {
  const next = unlockButtons(model);
  if (next === model) return;
  model = next;
  const t = trial();
  if (t) setWorklet(t.condition);
  renderTrial();
});
$("again").addEventListener("click", () => {
  model.practiceWord = null;
  setWorklet("practice");
  show("practice");
});
$("liveGain").addEventListener("input", () => {
  if (outputGain) outputGain.gain.value = Number($("liveGain").value);
});
$("echoToggle").addEventListener("change", () => {
  if (model.live && !uiTest) startLive();
});
$("outDevice").addEventListener("change", () => {
  applyOutput();
});

showWhere();
publish();
