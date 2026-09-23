/** Kitchen headphone screen — not a clinic audiogram. */

import { FREQS, derivePlan, interpThresh } from "./plan.js";

/** Starting grid. The test inserts more pitches where his answers change. */
export const ANCHOR_FREQS = [250, 500, 1000, 1500, 2000, 3000, 4000, 6000, 8000];
export const KITCHEN_FREQS = ANCHOR_FREQS;
export const MAX_EAR_POINTS = 16;
export const MAX_REFINE_WAVES = 2;
const REFINE_CANDIDATES = [750, 1500, 3000, 6000, 10000];
const REFINE_RATIO = 1.22;

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
    freqs: ANCHOR_FREQS.slice(),
    index: 0,
    phase: "screen",
    kind: "tone",
    gain: SCREEN_GAIN,
    thresh: {},
    falseAlarms: 0,
    catchEvery: 4,
    presentations: 0,
    waves: 0,
    done: false,
    open: true,
  };
}

function roundHz(freq) {
  const step = freq >= 3000 ? 100 : freq >= 800 ? 50 : 25;
  return Math.round(freq / step) * step;
}

function alreadyHave(freqs, hz) {
  return freqs.some((f) => Math.abs(Math.log(f / hz)) < Math.log(1.06));
}

/**
 * Add a pitch between neighbours whose hearing changed, and one step above
 * 8 kHz when the top of the chart is already gone. Flat maps stay on the anchors.
 */
export function proposeRefineFreqs(freqs, thresh) {
  const sorted = [...new Set(freqs)].filter((f) => f > 0).sort((a, b) => a - b);
  const wanted = [];
  const push = (hz) => {
    const f = roundHz(hz);
    if (f < 200 || f > 12000) return;
    if (alreadyHave(sorted, f) || alreadyHave(wanted, f)) return;
    wanted.push(f);
  };

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (b / a < REFINE_RATIO) continue;
    const ha = thresh[a] ?? 100;
    const hb = thresh[b] ?? 100;
    if (hearingBand(ha) === hearingBand(hb) && Math.abs(ha - hb) < 20) continue;
    const between = REFINE_CANDIDATES.filter((c) => c > a * 1.08 && c < b / 1.08);
    if (between.length) {
      const mid = Math.sqrt(a * b);
      between.sort((x, y) => Math.abs(Math.log(x / mid)) - Math.abs(Math.log(y / mid)));
      push(between[0]);
    } else {
      push(Math.sqrt(a * b));
    }
  }

  const top = sorted[sorted.length - 1];
  if (top && hearingBand(thresh[top] ?? 100) !== "still") {
    for (const c of REFINE_CANDIDATES) {
      if (c / top >= 1.15 && c / top <= 1.45) push(c);
    }
  }

  const room = MAX_EAR_POINTS - sorted.length;
  return wanted.sort((a, b) => a - b).slice(0, Math.max(0, room));
}

function withRefinement(test, thresh, presentations) {
  const waves = test.waves || 0;
  if (waves < MAX_REFINE_WAVES) {
    const extra = proposeRefineFreqs(test.freqs, thresh);
    if (extra.length) {
      const freqs = [...test.freqs, ...extra].sort((a, b) => a - b);
      const nextIndex = freqs.findIndex((f) => thresh[f] == null);
      return {
        ...test,
        freqs,
        thresh,
        phase: "screen",
        index: nextIndex === -1 ? freqs.length - 1 : nextIndex,
        kind: "tone",
        presentations,
        waves: waves + 1,
        done: nextIndex === -1,
        open: false,
      };
    }
  }
  return {
    ...test,
    thresh,
    phase: "screen",
    index: Math.max(0, test.freqs.length - 1),
    kind: "tone",
    presentations,
    done: true,
    open: false,
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
  if (index >= test.freqs.length) return withRefinement(test, thresh, presentations);
  const catchNext = presentations > 0 && presentations % test.catchEvery === 0;
  return {
    ...test,
    thresh,
    phase,
    index,
    kind: catchNext ? "catch" : "tone",
    presentations,
    done: false,
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

export function measuredPoints(thresh) {
  return Object.keys(thresh || {})
    .map((k) => Number(k))
    .filter((f) => f > 0 && thresh[f] != null)
    .sort((a, b) => a - b)
    .map((freq) => {
      const hl = thresh[freq];
      return { freq, hl, band: hearingBand(hl), label: freqShortLabel(freq), clinicLabel: freqClinicLabel(freq) };
    });
}

function rangePhrase(points) {
  if (!points.length) return "";
  const parts = [];
  let run = [points[0]];
  const flush = () => {
    const a = run[0];
    const b = run[run.length - 1];
    parts.push(a.freq === b.freq ? a.clinicLabel : `${a.clinicLabel}–${b.clinicLabel}`);
  };
  for (let i = 1; i < points.length; i++) {
    const prev = run[run.length - 1];
    if (points[i].freq / prev.freq <= 2.5) run.push(points[i]);
    else {
      flush();
      run = [points[i]];
    }
  }
  flush();
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The sentence that ties the recorded dots to the two bands the computer will use. */
export function becauseSentence(points, plan) {
  const missed = points.filter((p) => p.band !== "still");
  if (!missed.length || !(plan.srcHi > plan.srcLo)) {
    const heard = rangePhrase(points.filter((p) => p.band === "still")) || "every pitch we played";
    return `He still heard ${heard}, so the computer does not move any sound. This chart is saved.`;
  }
  if (!(plan.dstHi > plan.dstLo)) {
    return `He missed ${rangePhrase(missed)}. There is no pitch below that he still heard, so the computer does not park a hiss. This chart is saved.`;
  }
  const take = `${freqClinicLabel(plan.srcLo)}–${freqClinicLabel(plan.srcHi)}`;
  const park = `${freqClinicLabel(plan.dstLo)}–${freqClinicLabel(plan.dstHi)}`;
  const inBand = points.filter(
    (p) => p.band === "still" && p.freq >= plan.dstLo - 1 && p.freq <= plan.dstHi + 1
  );
  const heardBit = rangePhrase(inBand) || rangePhrase(points.filter((p) => p.band === "still" && p.freq < plan.srcLo));
  return `He missed ${rangePhrase(missed)}. The computer takes sound from ${take} and parks the hiss at ${park}, which covers ${heardBit || "a lower pitch"} — pitches he still heard.`;
}

/**
 * The recorded dots set both bands. Source is the pitches he did not still hear.
 * Landing is the highest of those he did, kept strictly below that hole.
 */
export function planFromKitchen(thresh) {
  const points = measuredPoints(thresh);
  const freqs = points.map((p) => p.freq);
  const hl = points.map((p) => p.hl);
  const mapped = freqs.length ? FREQS.map((f) => interpThresh(f, freqs, hl)) : FREQS.map(() => 100);
  const plan = derivePlan(mapped, FREQS);
  const missed = points.filter((p) => p.band !== "still" && p.freq >= 1500);
  const still = points.filter((p) => p.band === "still");

  if (missed.length && still.length) {
    const firstMiss = missed[0];
    const lastStill = [...still].reverse().find((p) => p.freq < firstMiss.freq);
    let srcLo = firstMiss.freq;
    if (lastStill) {
      const edge = Math.round(Math.sqrt(lastStill.freq * firstMiss.freq));
      srcLo = Math.max(lastStill.freq + 40, Math.min(firstMiss.freq, edge));
    }
    let srcHi = firstMiss.freq;
    for (const p of points) {
      if (p.freq < firstMiss.freq) continue;
      if (p.band === "still" && p.freq > firstMiss.freq) break;
      if (p.band !== "still") srcHi = p.freq;
    }
    if (srcHi <= srcLo) srcHi = srcLo + 80;
    plan.srcLo = Math.round(srcLo);
    plan.srcHi = Math.round(srcHi);

    const below = still.filter((p) => p.freq < plan.srcLo);
    const landPool = below.filter((p) => p.freq <= 2500);
    const pool = landPool.length ? landPool : below;
    if (pool.length && plan.srcLo > 400) {
      const dest = pool[pool.length - 1];
      const lower = [...pool].reverse().find((p) => p.freq <= dest.freq * 0.8) || pool[Math.max(0, pool.length - 2)];
      let dstLo = lower && lower.freq < dest.freq ? lower.freq : Math.round(dest.freq * 0.65);
      let dstHi = Math.min(plan.srcLo - 80, Math.round(dest.freq + Math.max(80, (dest.freq - dstLo) * 0.35)));
      if (dstHi < dest.freq) dstHi = Math.min(plan.srcLo - 80, dest.freq);
      if (dstLo > dest.freq) dstLo = dest.freq;
      if (dstHi <= dstLo + 120) dstHi = Math.min(plan.srcLo - 80, dstLo + 400);
      plan.dstLo = Math.round(dstLo);
      plan.dstHi = Math.round(Math.max(dstHi, Math.min(dest.freq, plan.srcLo - 80)));
      plan.mode = "hiss";
    } else {
      plan.kind = "captions";
      plan.mode = "original";
      plan.srcLo = Math.round(srcLo);
      plan.srcHi = Math.round(srcHi);
    }
  } else if (!missed.length) {
    plan.kind = "ordinary";
    plan.mode = "original";
    plan.srcLo = 0;
    plan.srcHi = 0;
    plan.dstLo = 0;
    plan.dstHi = 0;
  } else {
    plan.kind = "captions";
    plan.mode = "original";
    plan.srcLo = missed[0].freq;
    plan.srcHi = Math.max(missed[missed.length - 1].freq, missed[0].freq + 80);
    plan.dstLo = 0;
    plan.dstHi = 0;
  }

  if (plan.mode !== "hiss") {
    plan.gate = false;
  } else {
    plan.mode = "hiss";
    plan.gate = true;
    plan.mix = 0.85;
  }
  plan.because = becauseSentence(points, plan);
  plan.blurb = plan.because;
  plan.savedAt = new Date().toISOString();
  plan.measured = points;
  plan.freqs = freqs.length ? freqs : FREQS.slice();
  plan.thresh = hl.length ? hl : mapped;
  plan.kitchen = true;
  plan.falseAlarms = 0;
  plan.pointCount = points.length;
  return plan;
}

export function freqShortLabel(hz) {
  if (hz >= 1000) return hz % 1000 === 0 ? `${hz / 1000}k` : `${(hz / 1000).toFixed(1)}k`;
  return String(hz);
}

export function freqClinicLabel(hz) {
  if (hz >= 1000) return hz % 1000 === 0 ? `${hz / 1000} kHz` : `${(hz / 1000).toFixed(1)} kHz`;
  return `${hz} Hz`;
}

/** Kitchen thresholds → clinic-shaped points he can compare to a printout. */
export function hearingBand(hl) {
  if (hl < 70) return "still";
  if (hl < 95) return "loud";
  return "gone";
}

export function formatSavedAt(iso) {
  const d = new Date(iso || "");
  if (!iso || Number.isNaN(d.getTime())) return "on this Mac";
  try {
    return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "on this Mac";
  }
}

export function hearingSpectrum(thresh, plan, freqs) {
  const fromPlan = plan?.measured?.map((p) => p.freq);
  const fromThresh = thresh
    ? Object.keys(thresh)
        .map((k) => Number(k))
        .filter((f) => f > 0)
        .sort((a, b) => a - b)
    : [];
  const use = freqs && freqs.length ? freqs : fromPlan && fromPlan.length ? fromPlan : fromThresh.length ? fromThresh : KITCHEN_FREQS;
  const points = use.map((freq) => {
    const hl = thresh && thresh[freq] != null ? thresh[freq] : 100;
    return {
      freq,
      label: freqShortLabel(freq),
      clinicLabel: freqClinicLabel(freq),
      hl,
      band: hearingBand(hl),
    };
  });
  const source = plan && plan.srcHi > plan.srcLo ? { lo: plan.srcLo, hi: plan.srcHi } : null;
  const landing = plan && plan.dstHi > plan.dstLo ? { lo: plan.dstLo, hi: plan.dstHi } : null;
  return {
    points,
    landing,
    source,
    kind: plan?.kind || "unknown",
    blurb: plan?.blurb || "",
    because: plan?.because || "",
    savedAt: plan?.savedAt || null,
    pointCount: points.length,
  };
}

export function hearingReviewCopy(spectrum) {
  const because = spectrum?.because || "The tinted bands are exactly what the computer will do with this chart.";
  const n = spectrum?.points?.length || 0;
  const when = formatSavedAt(spectrum?.savedAt);
  return {
    himHeadline: "This saved chart is what the computer will use.",
    himBody: `${because} Saved ${when}. ${n} pitches. Quiet at the top — same layout as the clinic paper. If the drop is in the wrong place, tap THAT'S NOT ME.`,
    sisterHeadline: "Saved. These two bands are the change.",
    sisterBody: `${because} Saved ${when} on this Mac, and the word test uses this chart. ${n} pitches, not a clinic diagnosis. If his paper drops somewhere else, redo the beeps.`,
  };
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
    headline: "The saved chart is what moves the hiss.",
    body: `${plan.because || plan.blurb}. Not a medical audiogram: no booth, no bone conduction, no calibrated earphones. Good enough to avoid dumping S into a hole on this Mac.`,
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
