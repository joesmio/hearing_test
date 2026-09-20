import { createSync, listenerSnapshotIsSafe } from "./sync.js";
import { renderHearingChart, hearingPillsHtml } from "./hearing-chart.js";

const $ = (id) => document.getElementById(id);
let lastSeq = 0;

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
  lastSeq = snap.seq || lastSeq;
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
  const ear = $("earAnswers");
  if (ear) ear.hidden = !snap.earOn;
  const cal = $("calAnswers");
  if (cal) {
    cal.hidden = !snap.calOn;
    const comfort = Boolean(snap.calComfort);
    const heard = $("answer-cal-heard") || cal.querySelector('[data-testid="answer-cal-heard"]');
    const missed = $("answer-cal-missed") || cal.querySelector('[data-testid="answer-cal-missed"]');
    const ok = $("answer-cal-ok") || cal.querySelector('[data-testid="answer-cal-ok"]');
    const loud = $("answer-cal-loud") || cal.querySelector('[data-testid="answer-cal-loud"]');
    if (heard) heard.hidden = comfort;
    if (missed) missed.hidden = comfort;
    if (ok) ok.hidden = !comfort;
    if (loud) loud.hidden = !comfort;
  }
  const review = $("hearingReview");
  if (review) {
    const on = Boolean(snap.reviewOn && snap.hearing);
    review.hidden = !on;
    if (on) {
      $("hearingHeadline").textContent = snap.hearing.headline || "Does this match the clinic chart?";
      $("hearingBody").textContent = snap.hearing.body || "";
      renderHearingChart($("hearingChart"), snap.hearing);
      const pills = $("hearingPills");
      if (pills) pills.innerHTML = hearingPillsHtml(snap.hearing);
    }
  }
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

function tap(e) {
  const btn = e.target.closest("[data-word]");
  if (btn) sync.sendAnswer(btn.dataset.word, { seq: lastSeq });
}

$("answers").addEventListener("click", tap);
$("earAnswers").addEventListener("click", tap);
$("calAnswers").addEventListener("click", tap);
$("hearingReview")?.addEventListener("click", tap);
