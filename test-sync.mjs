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

const practice = toListenerSnapshot({
  view: "practice",
  step: "say",
  score: emptyScore(),
  practiceWord: "fee",
});
assert(practice.practiceWord === "fee", "practice may label the word");
assert(listenerSnapshotIsSafe(practice), "practice labels are allowed");

const leak = { ...listening, targetWord: "see" };
assert(!listenerSnapshotIsSafe(leak), "reject leaked target");

console.log("sync safety tests passed");
