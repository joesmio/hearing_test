import { hearingChartSvg } from "./hearing-chart.js";
import {
  createEarTest,
  currentBeep,
  applyEarAnswer,
  unlockEar,
  gainToKitchenHl,
  planFromKitchen,
  earPlainCopy,
  hearingSpectrum,
  hearingReviewCopy,
  hearingBand,
  createCalTest,
  applyCalAnswer,
  unlockCal,
  KITCHEN_FREQS,
  ANCHOR_FREQS,
} from "./audiogram.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(gainToKitchenHl(0.01) < 40, "quiet threshold is good hearing");
assert(gainToKitchenHl(0.5) > 65, "only-hears-loud is a tired band");
assert(gainToKitchenHl(null) === 100, "never heard");

let test = createEarTest();
const ceiling = 1500;
let guards = 0;
while (!test.done) {
  const beep = currentBeep(test);
  assert(beep, "beep while running");
  if (beep.kind === "catch") {
    test = applyEarAnswer(test, false);
  } else {
    test = applyEarAnswer(test, beep.freq <= ceiling);
  }
  const dup = applyEarAnswer(test, true);
  assert(dup === test, "duplicate tap must not skip a frequency");
  test = unlockEar(test);
  guards += 1;
  assert(guards < 120, "ear test must finish");
}
assert(test.done, "finishes");
assert(Object.keys(test.thresh).length === test.freqs.length, "every freq scored");
assert(test.freqs.length > ANCHOR_FREQS.length, `cliff should add pitches, got ${test.freqs.join(",")}`);
assert(test.freqs.some((f) => f > 1500 && f < 2000), "a pitch is measured between 1.5 and 2 kHz");
assert(test.freqs.includes(10000), "a gone top is measured at 10 kHz");
assert(test.thresh[1000] < 70, "he heard 1 kHz at the screen level");
assert(test.thresh[4000] === 100, "highs he never heard");
assert(test.thresh[10000] === 100, "10 kHz was actually tested");

let flat = createEarTest();
let flatGuards = 0;
while (!flat.done && flatGuards < 80) {
  const beep = currentBeep(flat);
  flat = applyEarAnswer(flat, beep.kind === "catch" ? false : true);
  flat = unlockEar(flat);
  flatGuards += 1;
}
assert(flat.done && flat.freqs.length === ANCHOR_FREQS.length, "flat hearing stays on the anchor pitches");

const plan = planFromKitchen(test.thresh);
assert(plan.dstLo <= 1500 && plan.dstHi > 1000, plan.because);
assert(plan.dstHi < plan.srcLo, "landing stays below the hole");
assert(plan.srcLo > 1500 && plan.srcLo <= 2000, `source starts at the cliff ${plan.srcLo}`);
assert(plan.srcHi >= 10000, "source stops at the measured 10 kHz hole");
assert(plan.mode === "hiss", "kitchen plan uses hiss substitution");
assert(plan.freqs.length === plan.thresh.length, "worklet freqs match the measured thresholds");
assert(plan.measured.length === test.freqs.length, "raw chart is kept on the plan");
assert(/missed/i.test(plan.because) && /parks the hiss/i.test(plan.because) && /still heard/i.test(plan.because), plan.because);
assert(plan.savedAt, "chart records when it was saved");
assert(!/clinic diagnosis/i.test(earPlainCopy(plan).body + earPlainCopy(plan).headline), "copy stays kitchen");
assert(earPlainCopy(plan).body.toLowerCase().includes("not a medical"), earPlainCopy(plan).body);

const ski = {};
for (const f of KITCHEN_FREQS) ski[f] = f >= 2000 ? 100 : 40;
const skiPlan = planFromKitchen(ski);
assert(skiPlan.dstHi < skiPlan.srcLo, "landing below source");
assert(skiPlan.srcHi === 8000, `source ends on the last missed pitch, not an invented 10 kHz (${skiPlan.srcHi})`);
assert(/2 kHz/.test(skiPlan.because) && /1\.5 kHz/.test(skiPlan.because), skiPlan.because);

const full = {};
for (const f of KITCHEN_FREQS) full[f] = 30;
const fullPlan = planFromKitchen(full);
assert(fullPlan.mode === "original" && !(fullPlan.srcHi > fullPlan.srcLo), "do not move sound he still heard");

let cal = createCalTest(plan);
cal = applyCalAnswer(cal, "missed");
assert(cal.gain > 0.02, "seek climbs");
cal = unlockCal(cal);
cal = applyCalAnswer(cal, "heard");
assert(cal.phase === "comfort", cal.phase);
cal = unlockCal(cal);
cal = applyCalAnswer(cal, "ok");
assert(cal.done && cal.mix > 0.3, "locks a usable mix");

const spectrum = hearingSpectrum(test.thresh, plan);
assert(spectrum.points.length === test.freqs.length, "every measured pitch is on the chart");
assert(spectrum.points.find((p) => p.freq === 1000).band === "still", "1 kHz still there");
assert(spectrum.points.find((p) => p.freq === 4000).band === "gone", "4 kHz gone");
assert(spectrum.points.some((p) => p.freq > 8000), "chart includes the 10 kHz point");
assert(spectrum.landing && spectrum.landing.lo < spectrum.landing.hi, "landing band marked");
assert(spectrum.source && spectrum.source.lo < spectrum.source.hi, "source band marked");
assert(/missed/i.test(spectrum.because), spectrum.because);
assert(hearingBand(40) === "still" && hearingBand(80) === "loud" && hearingBand(100) === "gone", "bands");

const skiSpec = hearingSpectrum(ski, skiPlan);
const copy = hearingReviewCopy(skiSpec);
assert(/clinic/i.test(copy.himHeadline + copy.himBody), copy.himHeadline);
assert(/quiet at the top/i.test(copy.himBody), copy.himBody);
assert(skiSpec.points.filter((p) => p.freq < 2000).every((p) => p.band === "still"), "lows remain");
assert(skiSpec.points.filter((p) => p.freq >= 2000).every((p) => p.band === "gone"), "highs gone");

const svg = hearingChartSvg(skiSpec);
assert(/<svg/i.test(svg), "clinic-shaped chart is an svg");
assert(/hiss sits here/.test(svg), "landing band labelled");
assert(/take sound from here/.test(svg), "source band labelled");
assert(/Heard easily/.test(svg) && /Not heard/.test(svg), "clinic quiet-at-top labels");
assert(!/<script/i.test(svg), "chart svg must not embed script");
const wide = hearingChartSvg(spectrum);
assert(/10k/.test(wide), "axis reaches the measured 10 kHz point");

console.log("audiogram tests passed", { blurb: plan.blurb, mix: cal.mix });
