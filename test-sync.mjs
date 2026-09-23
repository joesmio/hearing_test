import { toListenerSnapshot, listenerSnapshotIsSafe } from "./sync.js";
import { emptyScore } from "./protocol.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const listening = toListenerSnapshot({
  view: "trial",
  step: "listen",
  block: "dsp",
  index: 2,
  session: { dsp: [1, 2, 3, 4, 5, 6] },
  score: emptyScore(),
  practiceWord: null,
  live: true,
  hissOn: true,
  seq: 3,
  progress: { n: 6, i: 2 },
});

assert(listening.himView === "listen", "listen view");
assert(listening.answersOn === true, "buttons on");
assert(listenerSnapshotIsSafe(listening), "listen snapshot must be safe");
assert(!("targetWord" in listening), "no target");
assert(!("sisterPrompt" in listening), "no sister prompt field");
assert(!/Say\s+F/i.test(JSON.stringify(listening)), "must not tell him to say FEE");

const waiting = toListenerSnapshot({
  view: "trial",
  step: "say",
  block: "dry",
  score: emptyScore(),
  practiceWord: null,
  progress: { n: 6, i: 0 },
});
assert(waiting.himView === "wait", "wait while she reads the word");
assert(waiting.answersOn === false, "buttons locked");
assert(listenerSnapshotIsSafe(waiting), "wait is safe");

const ear = toListenerSnapshot({
  view: "ear",
  step: "say",
  score: emptyScore(),
  ear: { freqs: [1000], index: 0 },
});
assert(ear.earOn, "ear buttons");
assert(ear.prompt === "Did you hear a beep?", ear.prompt);
assert(!/1000|kHz/i.test(JSON.stringify(ear)), "him must not see the beep frequency");
assert(listenerSnapshotIsSafe(ear), "ear snapshot");

const practice = toListenerSnapshot({
  view: "practice",
  step: "say",
  score: emptyScore(),
  practiceWord: "fee",
});
assert(practice.practiceWord === "fee", "practice may label the word");
assert(listenerSnapshotIsSafe(practice), "practice labels are allowed");

const practiceUsing = toListenerSnapshot({
  view: "practice",
  step: "say",
  score: emptyScore(),
  practiceWord: null,
  plan: {
    kitchen: true,
    because:
      "He missed 4 kHz–8 kHz. The computer takes sound from 4 kHz–8 kHz and parks the hiss at 1 kHz–1.5 kHz, which covers 1 kHz — pitches he still heard.",
    savedAt: "2026-09-23T12:00:00.000Z",
    srcLo: 4000,
    srcHi: 8000,
    dstLo: 1000,
    dstHi: 1500,
  },
});
assert(practiceUsing.chartInUse && /parks the hiss/.test(practiceUsing.chartInUse.body), "practice shows the saved chart is in use");
assert(listenerSnapshotIsSafe(practiceUsing), "in-use chart stays cue-safe");
assert(!/Say\s+F/i.test(JSON.stringify(practiceUsing)) && !/Say\s+S/i.test(JSON.stringify(practiceUsing)), "chart note must not cue a word");

const listeningWithChart = toListenerSnapshot({
  view: "trial",
  step: "listen",
  block: "dsp",
  score: emptyScore(),
  plan: {
    kitchen: true,
    because: practiceUsing.chartInUse.body,
    srcLo: 4000,
    srcHi: 8000,
    dstLo: 1000,
    dstHi: 1500,
  },
});
assert(listeningWithChart.chartInUse, "the word test keeps the saved chart in use");
assert(listenerSnapshotIsSafe(listeningWithChart), "listen chart note is cue-safe");

const earWithOldChart = toListenerSnapshot({
  view: "ear",
  step: "say",
  score: emptyScore(),
  plan: {
    kitchen: true,
    because: "He missed 4 kHz.",
    srcLo: 4000,
    srcHi: 8000,
    dstLo: 1000,
    dstHi: 1500,
  },
});
assert(earWithOldChart.chartInUse == null, "a new beep test does not show the previous chart");
assert(!/kHz/i.test(JSON.stringify(earWithOldChart)), "him must not see pitches during the beeps");

const review = toListenerSnapshot({
  view: "review",
  score: emptyScore(),
  hearing: {
    points: [
      { freq: 1000, label: "1k", clinicLabel: "1 kHz", hl: 40, band: "still" },
      { freq: 4000, label: "4k", clinicLabel: "4 kHz", hl: 100, band: "gone" },
    ],
    landing: { lo: 800, hi: 1400 },
    headline: "Does this match the clinic chart?",
    body: "Quiet at the top.",
  },
  seq: 9,
});
assert(review.reviewOn, "review buttons");
assert(review.himView === "review", review.himView);
assert(review.prompt === "Does this look like your clinic chart?", review.prompt);
assert(review.hearing.points[0].freq === 1000, "him sees the kitchen map");
assert(/kHz/.test(JSON.stringify(review.hearing)), "review may name pitches");
assert(!review.answersOn && !review.earOn, "word and beep buttons stay off");
assert(listenerSnapshotIsSafe(review), "review snapshot");
assert(!/Say\s+F/i.test(JSON.stringify(review)), "review must not cue a word");

const leak = { ...listening, targetWord: "see" };
assert(!listenerSnapshotIsSafe(leak), "reject leaked target");

console.log("sync safety tests passed");
