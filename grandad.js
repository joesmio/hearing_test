import {
  buildLiveSession,
  emptyScore,
  markAnswer,
  resultCopy,
  listenerPrompt,
  sisterPrompt,
  workletForCondition,
} from "./protocol.js";

const uiTest = new URLSearchParams(location.search).has("ui");

const state = {
  view: "welcome",
  live: false,
  session: null,
  score: emptyScore(),
  block: "dry",
  index: 0,
  step: "turnaway",
};

let audioCtx = null;
let workletNode = null;
let outputGain = null;
let sourceNode = null;
let micStream = null;
let analyser = null;

const $ = (id) => document.getElementById(id);

function trial() {
  if (!state.session) return null;
  const list = state.session[state.block];
  return list[state.index] || null;
}

function setWorklet(condition) {
  if (!workletNode) return;
  const cfg = workletForCondition(condition);
  workletNode.port.postMessage(cfg);
}

function showView(name) {
  state.view = name;
  document.body.dataset.view = name;
  for (const id of ["view-welcome", "view-practice", "view-trial", "view-results"]) {
    $(id).hidden = id !== `view-${name}`;
  }
  $("sisterCue").hidden = true;
  $("prompt").textContent = listenerPrompt(
    name === "trial" ? (state.step === "listen" ? "listen" : "turnaway") : name
  );
}

function renderProgress() {
  const list = state.session[state.block];
  $("progress").innerHTML = list
    .map((_, i) => `<i class="${i < state.index ? "done" : i === state.index ? "now" : ""}"></i>`)
    .join("");
  $("blockLabel").textContent =
    state.block === "dry" ? "First half — her voice as it is" : "Second half — computer trick on";
}

function renderTrial() {
  const t = trial();
  if (!t) {
    if (state.block === "dry") {
      state.block = "dsp";
      state.index = 0;
      state.step = "turnaway";
      setWorklet("dsp");
      renderTrial();
      return;
    }
    finish();
    return;
  }
  showView("trial");
  renderProgress();
  $("answers").hidden = state.step !== "listen";
  $("turnaway").hidden = state.step !== "turnaway";
  $("sisterCue").hidden = state.step !== "cue";
  if (state.step === "cue") {
    $("sisterWord").textContent = sisterPrompt(t.word);
    $("prompt").textContent = "";
  } else if (state.step === "listen") {
    $("prompt").textContent = listenerPrompt("listen");
  } else {
    $("prompt").textContent = listenerPrompt("turnaway");
  }
}

function finish() {
  const copy = resultCopy(state.score);
  $("resultHeadline").textContent = copy.headline;
  $("resultBody").textContent = copy.body;
  $("scoreDry").textContent = `${copy.dryFrac}  ${copy.dryPct}`;
  $("scoreDsp").textContent = `${copy.dspFrac}  ${copy.dspPct}`;
  showView("results");
}

async function ensureAudio() {
  if (audioCtx) return;
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
    if (e.data && e.data.type === "fft") paintHiss(e.data.aid);
  };
  setWorklet("practice");
}

function paintHiss(db) {
  if (!db || !db.length) return;
  const hi = db.slice(Math.floor(db.length * 0.55));
  const peak = Math.max(...hi);
  const on = peak > -55;
  $("hissLamp").classList.toggle("on", on);
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

async function startLive() {
  $("micStatus").textContent = "Asking for the microphone…";
  try {
    await ensureAudio();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (!uiTest) {
      const echo = $("echoToggle").checked;
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: echo,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      sourceNode = audioCtx.createMediaStreamSource(micStream);
      sourceNode.connect(workletNode);
    }
    state.live = true;
    $("meterBox").hidden = false;
    $("micStatus").textContent = uiTest
      ? "UI test — no microphone."
      : "Microphone is live. She can talk.";
    $("opsMeter").textContent = "Live · aid output · sibilants → 1–2 kHz";
    setWorklet("practice");
    showView("practice");
    $("prompt").textContent = listenerPrompt("practice");
    tickLevel();
  } catch (err) {
    $("micStatus").textContent = `Microphone blocked: ${err.message}`;
  }
}

function beginTest() {
  state.session = buildLiveSession(Date.now() % 100000, 6);
  state.score = emptyScore();
  state.block = "dry";
  state.index = 0;
  state.step = "turnaway";
  setWorklet("dry");
  renderTrial();
}

function answer(word) {
  const t = trial();
  if (!t || state.step !== "listen") return;
  markAnswer(state.score, t.condition, t.word, word);
  state.index += 1;
  state.step = "turnaway";
  renderTrial();
}

function setup() {
  $("startMic").addEventListener("click", startLive);
  $("beginTest").addEventListener("click", beginTest);
  $("practiceFee").addEventListener("click", () => setWorklet("practice"));
  $("practiceSee").addEventListener("click", () => setWorklet("practice"));
  $("showSister").addEventListener("click", () => {
    state.step = "cue";
    renderTrial();
  });
  $("cueReady").addEventListener("click", () => {
    state.step = "listen";
    const t = trial();
    if (t) setWorklet(t.condition);
    renderTrial();
  });
  $("answers").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-word]");
    if (btn) answer(btn.dataset.word);
  });
  $("again").addEventListener("click", () => {
    showView("practice");
    $("prompt").textContent = listenerPrompt("practice");
    setWorklet("practice");
  });
  $("liveGain").addEventListener("input", () => {
    if (outputGain) outputGain.gain.value = Number($("liveGain").value);
  });
  $("echoToggle").addEventListener("change", () => {
    if (state.live && !uiTest) startLive();
  });
  showView("welcome");
}

setup();
