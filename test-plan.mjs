import { PRESETS, derivePlan, speechScore, audibility } from "./plan.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(audibility(20) === 1, "quiet is fully audible");
assert(audibility(90) === 0, "90 dB is none");
assert(Math.abs(audibility(57.5) - 0.5) < 1e-9, "mid audibility");

const mild = derivePlan(PRESETS.mild_hf.thresh);
assert(mild.kind === "ordinary", `mild should be ordinary, got ${mild.kind}`);
assert(mild.score > 0.6, `mild score ${mild.score}`);

const missing = derivePlan(PRESETS.missing.thresh);
assert(
  missing.kind === "lowering" || missing.kind === "split",
  `missing-band should remap, got ${missing.kind}`
);
assert(missing.srcHi > missing.srcLo, "source band ordered");
assert(missing.dstHi > missing.dstLo, "dest band ordered");
assert(missing.dstHi <= missing.srcLo + 1e-6, "dest should sit below source");
assert(missing.dstLo >= 800, `landing should stay in the 1 kHz region, got ${missing.dstLo}`);

const severe = derivePlan(PRESETS.severe.thresh);
assert(severe.kind === "captions", `severe should be captions, got ${severe.kind}`);
assert(severe.score < 0.25, `severe score ${severe.score}`);
assert(severe.coreProfound >= 2, "severe has dead core bands");

const ski = derivePlan(PRESETS.ski.thresh);
assert(ski.kind === "split" || ski.kind === "captions" || ski.kind === "lowering", ski.kind);
assert(ski.score < 0.55, `ski score ${ski.score}`);

const notch = derivePlan(PRESETS.notch.thresh);
assert(notch.kind === "lowering", `a 4 kHz notch should be lowering (${notch.kind})`);
assert(notch.kind !== "captions", `a 4 kHz notch is not caption territory (${notch.kind})`);
assert(speechScore(PRESETS.notch.thresh) > 0.55, "notch still has most speech");

console.log("plan tests passed");
console.log({
  mild: mild.kind,
  missing: `${missing.kind} ${missing.blurb}`,
  ski: ski.kind,
  severe: severe.kind,
  notch: notch.kind,
});
