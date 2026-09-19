import {
  buildLiveSession,
  emptyScore,
  markAnswer,
  resultCopy,
  listenerPrompt,
  sisterPrompt,
  workletForCondition,
  PHASES,
  createModel,
  unlockButtons,
  applyAnswer,
  currentTrial,
} from "./protocol.js";
import { mapTransposeHz, SIBILANT_PLAN } from "./lowering.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const s = buildLiveSession(42, 6);
assert(s.dry.length === 6 && s.dsp.length === 6, "block sizes");
assert(s.dry.every((t) => t.live && t.condition === "dry"), "dry is live speech");
assert(s.dsp.every((t) => t.live && t.condition === "dsp"), "dsp is live speech");
const dryFee = s.dry.filter((t) => t.word === "fee").length;
const drySee = s.dry.filter((t) => t.word === "see").length;
assert(dryFee === 3 && drySee === 3, `balanced dry ${dryFee} ${drySee}`);
assert(
  s.dry.map((t) => t.word).join() !== s.dsp.map((t) => t.word).join(),
  "blocks should not be identical sequences"
);

const score = emptyScore();
markAnswer(score, "dry", "fee", "see");
markAnswer(score, "dry", "see", "see");
markAnswer(score, "dsp", "fee", "fee");
markAnswer(score, "dsp", "see", "see");
assert(score.dry.correct === 1 && score.dry.n === 2, "dry score");
assert(score.dsp.correct === 2 && score.dsp.n === 2, "dsp score");
const copy = resultCopy(score);
assert(/came apart|moved/.test(copy.headline + copy.body), copy.headline);
assert(!listenerPrompt("listen").toLowerCase().includes("fee"), "listener prompt must not name fee");
assert(!listenerPrompt("listen").toLowerCase().includes("see"), "listener prompt must not name see");
assert(sisterPrompt("fee").includes("FEE"), "sister cue");
assert(sisterPrompt("see").includes("SEE"), "sister cue see");

const dsp = workletForCondition("dsp");
assert(dsp.mode === "transpose" && dsp.listen === "aid", "dsp worklet");
assert(workletForCondition("dry").mode === "original", "dry is passthrough");
assert(PHASES.includes("dry") && PHASES.includes("dsp"), "phases");

const f = mapTransposeHz(6000, SIBILANT_PLAN.srcLo, SIBILANT_PLAN.srcHi, SIBILANT_PLAN.dstLo, SIBILANT_PLAN.dstHi);
assert(f != null && f > 1500 && f < 2000, `6 kHz should land near 1.7 kHz, got ${f}`);
assert(mapTransposeHz(1000, 3500, 8000, 1000, 2200) == null, "lows stay unmapped");

let m = createModel(2, 7);
assert(m.session.dry.length === 2 && m.session.dsp.length === 2, "short session");
let answers = 0;
while (m.view !== "results") {
  const before = `${m.block}:${m.index}:${m.step}`;
  m = unlockButtons(m);
  assert(m.step === "listen", `unlock from ${before}`);
  const t = currentTrial(m);
  m = applyAnswer(m, t.word);
  answers += 1;
  m = applyAnswer(m, "fee");
  assert(answers <= 4, "duplicate tap must not consume extra trials");
}
assert(answers === 4, `expected 4 live answers, got ${answers}`);
assert(m.view === "results", "reaches results");
assert(m.score.dry.n === 2 && m.score.dsp.n === 2, "both blocks scored");
assert(m.score.dsp.correct === 2, "correct taps on dsp");

console.log("protocol tests passed", { f: Math.round(f), dry: s.dry.map((t) => t.word).join(",") });
