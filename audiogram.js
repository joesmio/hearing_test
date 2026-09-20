/** Kitchen headphone screen — not a clinic audiogram. */

import { FREQS, derivePlan, interpThresh } from "./plan.js";

export const KITCHEN_FREQS = [250, 500, 1000, 1500, 2000, 3000, 4000, 6000, 8000];

export const SCREEN_GAIN = 0.06;
export const LOUD_GAIN = 0.55;

/** Map the gain at which he first heard a tone onto a clinic-like 15–100 scale. */
export function gainToKitchenHl(gain) {
  if (gain == null || !(gain > 0)) return 100;
  const dbBelow = -20 * Math.log10(Math.min(1, Math.max(1e-4, gain)));
  const hl = 85 - dbBelow * (65 / 40);
  return Math.round(Math.min(95, Math.max(15, hl)));
}

export function createEarTest() {
  return {
    freqs: KITCHEN_FREQS.slice(),
    index: 0,
    phase: "screen",
    kind: "tone",
    gain: SCREEN_GAIN,
    thresh: {},
    falseAlarms: 0,
    catchEvery: 4,
    presentations: 0,
    done: false,
    open: true,
  };
}

export function currentBeep(test) {
  if (!test || test.done) return null;
  if (test.kind === "catch") return { kind: "catch", freq: 0, gain: 0 };
  const freq = test.freqs[test.index];
  return { kind: "tone", freq, gain: test.phase === "loud" ? LOUD_GAIN : SCREEN_GAIN };
}

export function unlockEar(test) {
  if (!test || test.done) return test;
  return { ...test, open: true };
}

export function applyEarAnswer(test, heard) {
  if (!test || test.done || test.open === false) return test;
  if (test.kind === "catch") {
    const nextIndex = test.index;
    const more = nextIndex < test.freqs.length;
    return {
      ...test,
      falseAlarms: test.falseAlarms + (heard ? 1 : 0),
      kind: "tone",
      presentations: test.presentations + 1,
      done: !more,
      open: false,
    };
  }

  const freq = test.freqs[test.index];
  const thresh = { ...test.thresh };
  let phase = test.phase;
  let index = test.index;

  if (phase === "screen") {
    if (heard) {
      thresh[freq] = gainToKitchenHl(SCREEN_GAIN);
      index += 1;
      phase = "screen";
    } else {
      phase = "loud";
    }
  } else if (heard) {
    thresh[freq] = gainToKitchenHl(LOUD_GAIN);
    index += 1;
    phase = "screen";
  } else {
    thresh[freq] = 100;
    index += 1;
    phase = "screen";
  }

  const presentations = test.presentations + 1;
  const done = index >= test.freqs.length;
  const catchNext = !done && presentations > 0 && presentations % test.catchEvery === 0;
  return {
    ...test,
    thresh,
    phase,
    index: done ? test.freqs.length - 1 : index,
    kind: catchNext ? "catch" : "tone",
    presentations,
    done,
    open: false,
  };
}

export function kitchenHlArray(thresh, freqs = KITCHEN_FREQS) {
  return freqs.map((f) => (thresh[f] == null ? 100 : thresh[f]));
}

export function kitchenToPlanThresh(thresh, planFreqs = FREQS) {
  const kf = KITCHEN_FREQS;
  const kh = kitchenHlArray(thresh, kf);
  return planFreqs.map((f) => interpThresh(f, kf, kh));
}

/**
 * Place the hiss in a surviving headphone band, a half-octave below any hole.
 * Specialist kit is not required for this placement. A clinic audiogram is
 * still the right document for diagnosis, bone conduction, and masking.
 */
export function planFromKitchen(thresh) {
  const mapped = kitchenToPlanThresh(thresh);
  const plan = derivePlan(mapped);
  const usable = KITCHEN_FREQS.filter((f) => (thresh[f] ?? 100) < 70 && f <= 2500);
  if (usable.length) {
    const dest = usable.includes(1000) ? 1000 : usable.includes(1500) ? 1500 : usable[usable.length - 1];
    const width = dest >= 1500 ? 800 : 1000;
    plan.dstLo = Math.max(400, dest - width * 0.25);
    plan.dstHi = Math.min(plan.srcLo - 100, dest + width * 0.75);
    if (plan.dstHi <= plan.dstLo + 200) plan.dstHi = plan.dstLo + 400;
    plan.blurb = `${Math.round(plan.srcLo)}–${Math.round(plan.srcHi)} Hz → ${Math.round(plan.dstLo)}–${Math.round(plan.dstHi)} Hz`;
  }
  plan.srcHi = Math.max(plan.srcHi, 10000);
  plan.mode = "hiss";
  plan.gate = true;
  plan.mix = 0.85;
  plan.kitchen = true;
  plan.thresh = mapped;
  plan.falseAlarms = 0;
  return plan;
}

export function earPlainCopy(plan) {
  if (!plan) {
    return {
      headline: "We have not found his remaining band yet.",
      body: "Play the beeps through these headphones first. A clinic audiogram is better for a diagnosis, but we only need to know where this cable still reaches him.",
    };
  }
  if (plan.kind === "captions") {
    return {
      headline: "These headphones barely reach him.",
      body: `${plan.blurb}. If he heard almost none of the beeps, this is caption territory — the trick has nowhere safe to land. Try the hiss-loudness check anyway; if he cannot hear that either, stop.`,
    };
  }
  return {
    headline: "We can park the hiss where he still heard a beep.",
    body: `${plan.blurb}. Not a medical audiogram: no booth, no bone conduction, no calibrated earphones. Good enough to avoid dumping S into a hole on this Mac.`,
  };
}

export function createCalTest(plan) {
  return {
    phase: "seek",
    gain: 0.02,
    heardGain: null,
    mix: plan?.mix ?? 0.85,
    dstLo: plan?.dstLo ?? 1000,
    dstHi: plan?.dstHi ?? 2200,
    done: false,
    open: true,
  };
}

export function unlockCal(cal) {
  if (!cal || cal.done) return cal;
  return { ...cal, open: true };
}

export function applyCalAnswer(cal, tap) {
  if (!cal || cal.done || cal.open === false) return cal;
  if (cal.phase === "seek") {
    if (tap === "heard") {
      const comfort = Math.min(0.7, cal.gain * 3.16);
      return { ...cal, phase: "comfort", heardGain: cal.gain, gain: comfort, open: false };
    }
    const up = Math.min(0.7, cal.gain * 1.78);
    if (up >= 0.69 && cal.gain >= 0.6) {
      return { ...cal, done: true, mix: 0.4, gain: 0.7, open: false };
    }
    return { ...cal, gain: up, open: false };
  }
  if (tap === "loud") {
    const mix = Math.max(0.25, (cal.heardGain || 0.02) * 8);
    return { ...cal, done: true, mix: Math.min(0.7, mix), open: false };
  }
  return { ...cal, done: true, mix: Math.min(1, Math.max(0.35, (cal.gain || 0.1) * 6)), open: false };
}
