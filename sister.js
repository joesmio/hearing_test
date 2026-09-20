import {
  createModel,
  currentTrial,
  unlockButtons,
  applyAnswer,
  resultCopy,
  sisterPrompt,
  workletForCondition,
} from "./protocol.js";
import { SIBILANT_PLAN } from "./lowering.js";
import { createSync } from "./sync.js";
import {
  createEarTest,
  currentBeep,
  applyEarAnswer,
  unlockEar,
  planFromKitchen,
  earPlainCopy,
  hearingSpectrum,
  hearingReviewCopy,
  createCalTest,
  applyCalAnswer,
  unlockCal,
} from "./audiogram.js";
import { renderHearingChart, hearingPillsHtml } from "./hearing-chart.js";
import { createLiveSpectrum } from "./live-spectrum.js";

const params = new URLSearchParams(location.search);
const uiTest = params.has("ui");
const perBlock = Math.max(2, Math.min(8, Number(params.get("n")) || 8));
const forcedOrder = params.get("order") === "dsp" ? "dsp-first" : params.has("n") ? "dry-first" : null;

let activePlan = loadPlan() || { ...SIBILANT_PLAN };
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
  plan: activePlan,
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
const liveScope = createLiveSpectrum();

const $ = (id) => document.getElementById(id);

const seenAnswers = new Set();

function acceptRemoteAnswer(word, meta = {}) {
  const id = meta.id || (meta.at != null ? `${word}:${meta.at}` : "");
  if (id) {
    if (seenAnswers.has(id)) return;
    seenAnswers.add(id);
  }
  if (word === "looks-right") {
    if (model.view === "review") acceptHearing();
    return;
  }
  if (word === "redo-beeps") {
    if (model.view === "review") startEar();
    return;
  }
  if (word === "heard" || word === "missed") {
    if (model.view === "ear") takeEar(word === "heard");
    else if (model.view === "cal") takeCal(word === "heard" ? "heard" : "missed");
    return;
  }
  if (word === "ok" || word === "loud") {
    if (model.view === "cal") takeCal(word);
    return;
  }
  if (model.view === "trial" && model.step === "listen") {
    if (meta.seq != null && model.seq && Number(meta.seq) !== Number(model.seq)) return;
    takeAnswer(word);
  }
}

const sync = createSync({
  role: "sister",
  onAnswer: acceptRemoteAnswer,
});

function loadPlan() {
  try {
    const raw = localStorage.getItem("fee-see-plan");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePlan(plan) {
  activePlan = plan;
  model.plan = plan;
  try {
    localStorage.setItem("fee-see-plan", JSON.stringify(plan));
  } catch {
    /* ignore */
  }
  paintPlan();
}

function paintPlan() {
  const el = $("planBlurb");
  if (!el) return;
  const copy = earPlainCopy(activePlan.kitchen ? activePlan : activePlan.blurb ? activePlan : null);
  el.textContent = activePlan.blurb
    ? `${activePlan.blurb}. ${copy.headline}`
    : "No beep test yet — using a typical 1–2 kHz landing. Run “Find his remaining hearing” if you can.";
}

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
  workletNode.port.postMessage(workletForCondition(condition, activePlan));
}

function publish() {
  model.seq += 1;
  model.plan = activePlan;
  const list = model.session ? model.session[model.block] : [];
  model.progress = { n: list.length, i: model.index };
  sync.publish(model);
}

function show(name) {
  model.view = name;
  for (const id of ["view-practice", "view-trial", "view-results", "view-ear", "view-cal", "view-review"]) {
    const el = $(id);
    if (el) el.hidden = id !== `view-${name}`;
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
    model.step === "say"
      ? "Turn so he cannot see your mouth. Say it once, toward the lid."
      : "Wait — his buttons are live.";
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
  attachLiveScope();
  workletNode.port.onmessage = (e) => {
    if (!e.data || e.data.type !== "fft") return;
    liveScope.paintFft(e.data, activePlan);
    const micBox = $("specMicBox");
    const aidBox = $("specAidBox");
    if (micBox) micBox.classList.add("has-signal");
    if (aidBox) aidBox.classList.add("has-signal");
    const db = e.data.aid;
    const hi = db.slice(Math.floor(db.length * 0.55));
    const hissOn = Math.max(...hi) > -55;
    $("hissLamp").classList.toggle("on", hissOn);
    if (hissOn !== model.hissOn) {
      model.hissOn = hissOn;
      publish();
    }
  };
  setWorklet("practice");
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

function showLiveMeters() {
  if ($("meterBox")) $("meterBox").hidden = false;
  if ($("liveScope")) $("liveScope").hidden = false;
}

function tickLevel() {
  if (!analyser) return;
  const spec = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(spec);
  let peak = 0;
  for (const v of spec) peak = Math.max(peak, Math.abs(v - 128));
  $("levelBar").style.width = `${Math.min(100, (peak / 60) * 100)}%`;
  liveScope.paintWave(analyser);
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

function makeTone(freq, gain, dur = 0.55) {
  const sr = audioCtx.sampleRate;
  const n = Math.floor(sr * dur);
  const buf = audioCtx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const ramp = Math.floor(sr * 0.02);
  for (let i = 0; i < n; i++) {
    let e = 1;
    if (i < ramp) e = i / ramp;
    else if (i > n - ramp) e = (n - i) / ramp;
    d[i] = Math.sin((2 * Math.PI * freq * i) / sr) * gain * e;
  }
  return buf;
}

function makeBandNoise(lo, hi, gain, dur = 0.85) {
  const sr = audioCtx.sampleRate;
  const n = Math.floor(sr * dur);
  const buf = audioCtx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const ramp = Math.floor(sr * 0.03);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let f = lo; f < hi; f += 45) s += Math.sin((2 * Math.PI * f * i) / sr + f * 0.01);
    let e = 1;
    if (i < ramp) e = i / ramp;
    else if (i > n - ramp) e = (n - i) / ramp;
    d[i] = s * e;
  }
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  const g = gain / peak;
  for (let i = 0; i < n; i++) d[i] *= g;
  return buf;
}

function playRaw(buffer) {
  stopFileSource();
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(outputGain);
  fileSource = src;
  src.start();
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

function attachLiveScope() {
  liveScope.attach({
    wave: $("waveCanvas"),
    mic: $("specMic"),
    aid: $("specAid"),
  });
}

function enterPractice(status) {
  model.live = true;
  showLiveMeters();
  attachLiveScope();
  $("micStatus").textContent = status;
  setWorklet("practice");
  show("practice");
  if (uiTest) {
    for (let i = 0; i < 28; i++) liveScope.paintDemo(activePlan);
    $("specMicBox")?.classList.add("has-signal");
    $("specAidBox")?.classList.add("has-signal");
  }
}

async function startLive() {
  $("micStatus").textContent = "Asking for the microphone…";
  try {
    if (uiTest) {
      enterPractice("UI test — no microphone. Preview files still play through the trick.");
      return;
    }
    await ensureAudio();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    stopFileSource();
    if (sourceNode) sourceNode.disconnect();
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: $("echoToggle").checked,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    sourceNode = audioCtx.createMediaStreamSource(micStream);
    sourceNode.connect(workletNode);
    await fillOutputs();
    enterPractice("Microphone is live. Talk toward the lid. His own aids stay off.");
    tickLevel();
  } catch (err) {
    $("micStatus").textContent = `Microphone blocked: ${err.message}. You can still play FEE/SEE or her file through the trick.`;
    try {
      await ensureAudio();
      if (audioCtx.state === "suspended") await audioCtx.resume();
      enterPractice("No microphone — play a file or the FEE/SEE takes through his headphones.");
    } catch (e2) {
      showError(`Microphone blocked: ${err.message}`);
    }
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

function paintBeep() {
  const beep = currentBeep(model.ear);
  const label = $("earSister");
  if (!beep) {
    if (label) label.textContent = "Done";
    return;
  }
  if (label) label.textContent = beep.kind === "catch" ? "Silence catch" : `${beep.freq} Hz`;
}

async function playCurrentBeep() {
  await ensureAudio();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  const beep = currentBeep(model.ear);
  if (!beep) return;
  if (beep.kind === "catch") {
    stopFileSource();
    return;
  }
  playRaw(makeTone(beep.freq, beep.gain));
}

function paintHearingReview() {
  const spectrum = model.hearing;
  const copy = model.reviewCopy || hearingReviewCopy(spectrum);
  const headline = $("reviewHeadline");
  const body = $("reviewBody");
  if (headline) headline.textContent = copy.sisterHeadline;
  if (body) body.textContent = copy.sisterBody;
  renderHearingChart($("reviewChart"), spectrum);
  const pills = $("reviewPills");
  if (pills) pills.innerHTML = hearingPillsHtml(spectrum);
}

function enterHearingReview() {
  const plan = planFromKitchen(model.ear.thresh);
  plan.falseAlarms = model.ear.falseAlarms || 0;
  savePlan(plan);
  const spectrum = hearingSpectrum(model.ear.thresh, plan);
  model.reviewCopy = hearingReviewCopy(spectrum);
  model.hearing = {
    ...spectrum,
    headline: model.reviewCopy.himHeadline,
    body: model.reviewCopy.himBody,
  };
  const copy = earPlainCopy(plan);
  $("micStatus").textContent = `${copy.headline} Show him the chart next to his clinic printout before you go on.`;
  paintHearingReview();
  show("review");
}

function acceptHearing() {
  if (model.view !== "review") return;
  show("practice");
}

async function startEar() {
  try {
    model.ear = createEarTest();
    model.cal = null;
    fetch("/sync?takeAnswers=1").catch(() => {});
    paintBeep();
    if (uiTest) {
      show("ear");
      return;
    }
    await ensureAudio();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    showLiveMeters();
    show("ear");
    await playCurrentBeep();
  } catch (err) {
    showError(`Cannot play beeps: ${err.message}`);
  }
}

let lastTapKey = "";
let lastTapAt = 0;
function debounceTap(key) {
  const now = Date.now();
  if (key === lastTapKey && now - lastTapAt < 400) return false;
  lastTapKey = key;
  lastTapAt = now;
  return true;
}

function takeEar(heard) {
  if (!model.ear || model.ear.done) return;
  if (!debounceTap(heard ? "ear-heard" : "ear-missed")) return;
  const next = applyEarAnswer(model.ear, heard);
  if (next === model.ear) return;
  model.ear = next;
  if (model.ear.done) {
    enterHearingReview();
    return;
  }
  paintBeep();
  publish();
  const reopen = () => {
    if (model.ear && !model.ear.done) model.ear = unlockEar(model.ear);
  };
  if (uiTest) setTimeout(reopen, 40);
  else playCurrentBeep().finally(reopen);
}

async function playCurrentCal() {
  await ensureAudio();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  const cal = model.cal;
  if (!cal) return;
  playRaw(makeBandNoise(cal.dstLo, cal.dstHi, cal.gain));
}

async function startCal() {
  try {
    model.cal = createCalTest(activePlan);
    fetch("/sync?takeAnswers=1").catch(() => {});
    $("calSister").textContent = "Playing a quiet parked hiss. He taps HEARD when it just appears.";
    if (uiTest) {
      show("cal");
      return;
    }
    await ensureAudio();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    showLiveMeters();
    show("cal");
    await playCurrentCal();
  } catch (err) {
    showError(`Cannot play hiss: ${err.message}`);
  }
}

function takeCal(tap) {
  if (!model.cal || model.cal.done) return;
  if (!debounceTap(`cal-${tap}`)) return;
  const next = applyCalAnswer(model.cal, tap);
  if (next === model.cal) return;
  model.cal = next;
  if (model.cal.done) {
    savePlan({ ...activePlan, mix: model.cal.mix });
    $("micStatus").textContent = `Hiss locked at mix ${model.cal.mix.toFixed(2)}.`;
    $("liveGain").value = String(Math.min(1.05, Math.max(0.12, model.cal.mix * 0.55)));
    if (outputGain) outputGain.gain.value = Number($("liveGain").value);
    show("practice");
    return;
  }
  $("calSister").textContent =
    model.cal.phase === "comfort"
      ? "A little louder now. He taps OK or TOO SHARP."
      : "Still seeking — playing a bit louder.";
  publish();
  const reopen = () => {
    if (model.cal && !model.cal.done) model.cal = unlockCal(model.cal);
  };
  if (uiTest) setTimeout(reopen, 40);
  else playCurrentCal().finally(reopen);
}

if ($("runLength")) {
  $("runLength").textContent = `This run is ${perBlock} without the trick, then ${perBlock} with it — ${perBlock * 2} taps. Blocks swap order across days so practice does not fake the score.`;
}
paintPlan();

if (uiTest) {
  window.feeSeeTest = {
    completeEar(heardFreqs) {
      const heard = new Set(heardFreqs || [250, 500, 1000, 1500]);
      let test = createEarTest();
      let guard = 0;
      while (!test.done && guard < 40) {
        const beep = currentBeep(test);
        if (!beep) break;
        if (beep.kind === "catch") test = applyEarAnswer(test, false);
        else test = applyEarAnswer(test, heard.has(beep.freq));
        test = unlockEar(test);
        guard += 1;
      }
      model.ear = test;
      enterHearingReview();
    },
    paintDemoSpectrum() {
      attachLiveScope();
      showLiveMeters();
      for (let i = 0; i < 28; i++) liveScope.paintDemo(activePlan);
      $("specMicBox")?.classList.add("has-signal");
      $("specAidBox")?.classList.add("has-signal");
    },
  };
}

$("acceptHearing")?.addEventListener("click", acceptHearing);
$("redoHearing")?.addEventListener("click", () => startEar());
$("openHim").addEventListener("click", openHim);
$("startEar").addEventListener("click", startEar);
$("startMic").addEventListener("click", startLive);
$("startCal").addEventListener("click", startCal);
$("earReplay").addEventListener("click", () => playCurrentBeep().catch((err) => showError(err.message)));
$("calReplay").addEventListener("click", () => playCurrentCal().catch((err) => showError(err.message)));
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
  const order = forcedOrder || (Date.now() % 2 ? "dsp-first" : "dry-first");
  model = {
    ...createModel(perBlock, Date.now() % 100000, { order, plan: activePlan }),
    live: true,
  };
  setWorklet(model.block === "dsp" ? "dsp" : "dry");
  renderTrial();
});
$("playCue").addEventListener("click", async () => {
  const t = trial();
  if (!t) return;
  try {
    setWorklet(t.condition);
    const buf = await loadToken(`${t.word}-a`);
    await playBuffer(buf, null);
  } catch (err) {
    showError(err.message || String(err));
  }
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
  if (model.live && !uiTest && micStream) startLive();
});
$("outDevice").addEventListener("change", () => {
  applyOutput();
});

showWhere();
publish();
