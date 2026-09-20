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
