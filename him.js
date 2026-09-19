import { createSync, listenerSnapshotIsSafe } from "./sync.js";

const $ = (id) => document.getElementById(id);

function markLinked() {
  const lamp = $("linkLamp");
  if (!lamp) return;
  lamp.classList.add("on");
  lamp.textContent = "linked to her laptop";
}

function render(snap) {
  if (!snap) return;
  if (snap.results) {
    /* scores are allowed to mention fee/see as the two choices */
  } else if (!listenerSnapshotIsSafe(snap)) {
    return;
  }
  markLinked();
  $("prompt").textContent = snap.prompt || "Wait for her.";
  $("blockLabel").textContent = snap.blockLabel || "";
  $("hissLamp").classList.toggle("on", snap.hissOn);
  const practice = $("practiceWord");
  if (snap.himView === "practice" && snap.practiceWord) {
    practice.hidden = false;
    practice.textContent = snap.practiceWord === "fee" ? "FEE" : "SEE";
  } else {
    practice.hidden = true;
    practice.textContent = "";
  }
  $("answers").hidden = !snap.answersOn;
  const results = $("results");
  if (snap.results) {
    results.hidden = false;
    $("resultHeadline").textContent = snap.results.headline || "How you did";
    $("resultBody").textContent = snap.results.body || "";
    $("scoreDry").textContent = `${snap.results.dryFrac}  ${snap.results.dryPct}`;
    $("scoreDsp").textContent = `${snap.results.dspFrac}  ${snap.results.dspPct}`;
  } else {
    results.hidden = true;
  }
}

const sync = createSync({
  role: "him",
  onListener: render,
});

try {
  const raw = localStorage.getItem("fee-see-state");
  if (raw) {
    const env = JSON.parse(raw);
    if (env.listener) render(env.listener);
  }
} catch {
  /* private mode */
}

fetch("/sync")
  .then((r) => r.json())
  .then((env) => env.listener && render(env.listener))
  .catch(() => {});

$("answers").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-word]");
  if (btn) sync.sendAnswer(btn.dataset.word);
});
