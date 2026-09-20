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
} from "./audiogram.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(gainToKitchenHl(0.01) < 40, "quiet threshold is good hearing");
assert(gainToKitchenHl(0.5) > 65, "only-hears-loud is a tired band");
assert(gainToKitchenHl(null) === 100, "never heard");

let test = createEarTest();
const heard = new Set([250, 500, 1000, 1500]);
let guards = 0;
while (!test.done) {
  const beep = currentBeep(test);
  assert(beep, "beep while running");
  if (beep.kind === "catch") {
    test = applyEarAnswer(test, false);
  } else {
    test = applyEarAnswer(test, heard.has(beep.freq));
  }
  const dup = applyEarAnswer(test, true);
  assert(dup === test, "duplicate tap must not skip a frequency");
  test = unlockEar(test);
  guards += 1;
  assert(guards < 40, "ear test must finish");
}
assert(test.done, "finishes");
assert(Object.keys(test.thresh).length === KITCHEN_FREQS.length, "every freq scored");
assert(test.thresh[1000] < 70, "he heard 1 kHz at the screen level");
assert(test.thresh[4000] === 100, "highs he never heard");

const plan = planFromKitchen(test.thresh);
assert(plan.dstLo < 1500 && plan.dstHi > 1000, plan.blurb);
assert(plan.srcHi >= 9000, "source includes 10 kHz");
assert(plan.mode === "hiss", "kitchen plan uses hiss substitution");
assert(!/clinic diagnosis/i.test(earPlainCopy(plan).body + earPlainCopy(plan).headline), "copy stays kitchen");
assert(earPlainCopy(plan).body.toLowerCase().includes("not a medical"), earPlainCopy(plan).body);

const ski = {};
for (const f of KITCHEN_FREQS) ski[f] = f >= 2000 ? 100 : 40;
const skiPlan = planFromKitchen(ski);
assert(skiPlan.dstHi < skiPlan.srcLo, "landing below source");

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
assert(spectrum.points.length === KITCHEN_FREQS.length, "every kitchen pitch is on the chart");
assert(spectrum.points.find((p) => p.freq === 1000).band === "still", "1 kHz still there");
assert(spectrum.points.find((p) => p.freq === 4000).band === "gone", "4 kHz gone");
assert(spectrum.landing && spectrum.landing.lo < spectrum.landing.hi, "landing band marked");
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
assert(/Heard easily/.test(svg) && /Not heard/.test(svg), "clinic quiet-at-top labels");
assert(!/<script/i.test(svg), "chart svg must not embed script");

console.log("audiogram tests passed", { blurb: plan.blurb, mix: cal.mix });
