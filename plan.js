/** Audiogram → remapping plan + caption-territory verdict. Not a diagnosis. */

export const FREQS = [250, 500, 1000, 2000, 3000, 4000, 6000, 8000];

export const PRESETS = {
  mild_hf: {
    label: "Mild high-frequency (age)",
    thresh: [15, 15, 20, 30, 40, 50, 55, 60],
  },
  notch: {
    label: "4 kHz notch (noise)",
    thresh: [15, 15, 20, 25, 60, 75, 65, 35],
  },
  missing: {
    label: "Missing mid band",
    thresh: [20, 20, 25, 80, 95, 90, 35, 30],
  },
  ski: {
    label: "Ski-slope highs",
    thresh: [25, 30, 45, 70, 85, 95, 100, 105],
  },
  severe: {
    label: "Severe–profound",
    thresh: [75, 85, 90, 100, 105, 110, 110, 110],
  },
};

const SII_BANDS = [
  { f: 250, w: 0.04 },
  { f: 500, w: 0.14 },
  { f: 1000, w: 0.22 },
  { f: 2000, w: 0.23 },
  { f: 3000, w: 0.18 },
  { f: 4000, w: 0.13 },
  { f: 6000, w: 0.06 },
];

export function interpThresh(f, freqs, th) {
  if (f <= freqs[0]) return th[0];
  const last = freqs.length - 1;
  if (f >= freqs[last]) return th[last];
  for (let i = 1; i <= last; i++) {
    if (f <= freqs[i]) {
      const a = freqs[i - 1];
      const b = freqs[i];
      const t = Math.log(Math.max(f, 1) / a) / Math.log(b / a);
      return th[i - 1] + t * (th[i] - th[i - 1]);
    }
  }
  return th[last];
}

export function audibility(db) {
  if (db <= 25) return 1;
  if (db >= 90) return 0;
  return 1 - (db - 25) / (90 - 25);
}

export function speechScore(th, freqs = FREQS) {
  let s = 0;
  for (const b of SII_BANDS) {
    s += b.w * audibility(interpThresh(b.f, freqs, th));
  }
  return s;
}

function fmtHz(hz) {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`;
  return `${Math.round(hz)} Hz`;
}

export function derivePlan(th, freqs = FREQS, deadDb = 90) {
  const score = speechScore(th, freqs);
  const core = [500, 1000, 2000].map((f) => interpThresh(f, freqs, th));
  const coreSevere = core.filter((d) => d >= 70).length;
  const coreProfound = core.filter((d) => d >= 90).length;
  const highs = [3000, 4000, 6000].map((f) => interpThresh(f, freqs, th));
  const highsBad = highs.filter((d) => d >= 55).length;
  const usable = freqs.filter((_, i) => th[i] < 55);
  const usableTop = usable.length ? Math.max(...usable) : 0;

  let srcLo = 3000;
  let srcHi = 7000;
  let found = false;
  for (let i = 0; i < freqs.length; i++) {
    const bad = th[i] >= 60;
    if (bad && freqs[i] >= 1500) {
      if (!found) {
        srcLo = i > 0 ? (freqs[i - 1] + freqs[i]) / 2 : freqs[i];
        found = true;
      }
      srcHi = freqs[i] < 8000 ? (freqs[i] + (freqs[i + 1] || 8000)) / 2 : 7800;
    } else if (found && th[i] < 50 && freqs[i] > 4000) {
      break;
    }
  }
  if (!found) {
    srcLo = 3500;
    srcHi = 7500;
  }
  srcLo = Math.max(1200, srcLo);
  srcHi = Math.max(srcLo + 800, srcHi);

  let dest = 1000;
  let best = 999;
  for (const cand of [1500, 1200, 1000, 2000, 800]) {
    if (cand >= srcLo - 80) continue;
    const d = interpThresh(cand, freqs, th);
    if (d < 55) {
      dest = cand;
      best = d;
      break;
    }
    if (d < best) {
      best = d;
      dest = cand;
    }
  }
  const destWidth = Math.min(1400, Math.max(600, dest * 0.7));
  const dstLo = Math.max(500, dest - destWidth * 0.2);
  const dstHi = Math.min(srcLo - 80, dstLo + destWidth);
  const start = Math.max(800, Math.min(srcLo, usableTop || srcLo));
  const ratio = Math.min(4, Math.max(1.6, (8000 - start) / Math.max(400, dstHi - start)));

  let kind = "lowering";
  let title = "Lowering territory";
  let summary =
    "There is still a receiving band. Worth trying frequency lowering — and captions for TV or groups.";

  if (score >= 0.62 && highsBad < 2) {
    kind = "ordinary";
    title = "Ordinary aid territory";
    summary =
      "Most of the speech range is still there. A normal hearing aid (or hearable) may be enough. Captions are optional, useful in noise.";
  } else if (coreProfound >= 2 || score < 0.25) {
    kind = "captions";
    title = "Caption territory";
    summary =
      "Too little of the speech code remains for remapping to land on. Use live captions now (TV, phone, groups). Ask an audiologist about a cochlear-implant assessment. An aid can still help with awareness and loudness.";
  } else if (coreSevere >= 2 || score < 0.45) {
    kind = "split";
    title = "Split: trial lowering + captions";
    summary =
      "A slice of hearing remains, so lowering is worth a proper trial. Captions should already be on for television, calls, and noisy rooms — not as a last resort.";
  } else if (highsBad >= 2) {
    kind = "lowering";
    title = "Lowering territory";
    summary =
      "The missing band is mostly the thin consonant sounds (s, f, th). Remapping them into the better band is the standard algorithmic move. Captions still help on the television.";
  }

  const landingOk = best < 70;
  if (!landingOk && kind === "lowering") {
    kind = "split";
    title = "Weak landing band";
    summary =
      "You can move the missing band, but the place it would land is already tired. Expect modest benefit. Lean on captions whenever the words matter.";
  }

  return {
    score,
    coreSevere,
    coreProfound,
    highsBad,
    usableTop,
    srcLo,
    srcHi,
    dstLo,
    dstHi,
    start,
    ratio,
    kind,
    title,
    summary,
    landingDb: best,
    blurb: `${fmtHz(srcLo)}–${fmtHz(srcHi)} → ${fmtHz(dstLo)}–${fmtHz(dstHi)}`,
  };
}
