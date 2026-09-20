import {
  createModel,
  currentTrial,
  unlockButtons,
  applyAnswer,
  sisterPrompt,
} from "./protocol.js";
import { toListenerSnapshot, listenerSnapshotIsSafe } from "./sync.js";
import { hearingSpectrum, hearingReviewCopy, planFromKitchen, KITCHEN_FREQS } from "./audiogram.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

let model = createModel(2, 11);
const sisterCues = [];
let taps = 0;

while (model.view !== "results") {
  const wait = toListenerSnapshot(model);
  assert(listenerSnapshotIsSafe(wait), "wait snapshot leaked");
  assert(wait.himView === "wait", wait.himView);
  assert(wait.answersOn === false, "buttons must stay locked while she reads");
  assert(!/Say\s+F/i.test(JSON.stringify(wait)), "him wait leaked Say FEE");
  const t = currentTrial(model);
  assert(t && t.live, "trial is live speech");
  sisterCues.push(sisterPrompt(t.word));
  assert(/FEE|SEE/.test(sisterPrompt(t.word)), "sister sees the word");

  model = unlockButtons(model);
  const listen = toListenerSnapshot(model);
  assert(listenerSnapshotIsSafe(listen), "listen snapshot leaked");
  assert(listen.answersOn === true, "him buttons unlock after she speaks");
  assert(listen.prompt === "What did she say?", listen.prompt);

  model = applyAnswer(model, t.word);
  taps += 1;
  model = applyAnswer(model, "see");
}

const results = toListenerSnapshot(model);
assert(model.view === "results", "session ends on results");
assert(results.results, "him receives scores");
assert(listenerSnapshotIsSafe(results), "results snapshot");
assert(taps === 4, taps);
assert(model.score.dry.n === 2 && model.score.dsp.n === 2, "both blocks");
assert(results.results.dspFrac === "2 / 2", results.results.dspFrac);
assert(sisterCues.length === 4, "four live cues");
assert(sisterCues.some((c) => c.includes("FEE")) && sisterCues.some((c) => c.includes("SEE")), "both words");

const kitchen = {};
for (const f of KITCHEN_FREQS) kitchen[f] = f >= 2000 ? 100 : 40;
const spec = hearingSpectrum(kitchen, planFromKitchen(kitchen));
const copy = hearingReviewCopy(spec);
const reviewSnap = toListenerSnapshot({
  view: "review",
  score: { dry: { n: 0, correct: 0 }, dsp: { n: 0, correct: 0 } },
  hearing: { ...spec, headline: copy.himHeadline, body: copy.himBody },
  seq: 4,
});
assert(listenerSnapshotIsSafe(reviewSnap), "review must not leak the sister cue");
assert(reviewSnap.reviewOn && !reviewSnap.answersOn, "only the sanity-check buttons");
assert(/clinic/i.test(reviewSnap.prompt + reviewSnap.hearing.headline), "he is asked to check the clinic paper");

console.log("two-screen session passed", {
  cues: sisterCues.join(" | "),
  dry: results.results.dryFrac,
  dsp: results.results.dspFrac,
  headline: results.results.headline,
});
