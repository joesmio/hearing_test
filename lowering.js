/** Frequency-lowering maps. Shared by tests and the grandad protocol. */

export const SIBILANT_PLAN = {
  srcLo: 3500,
  srcHi: 10000,
  dstLo: 1000,
  dstHi: 2200,
  start: 2000,
  ratio: 2.7,
  mix: 0.85,
  mode: "hiss",
  gate: true,
  gateRatio: 2.5,
  gateFloor: 1e-6,
};

/** Map one source Hertz value into the destination band. */
export function mapTransposeHz(f, srcLo, srcHi, dstLo, dstHi) {
  if (f < srcLo || f >= srcHi) return null;
  const span = srcHi - srcLo;
  if (span <= 0) return null;
  const t = (f - srcLo) / span;
  return dstLo + t * (dstHi - dstLo);
}

export function mapCompressHz(f, start, ratio) {
  if (f <= start) return f;
  return start + (f - start) / Math.max(1.1, ratio);
}

/** Same spectral copy the AudioWorklet uses for live speech. */
export function transposeLikeProcessor(samples, sr, plan = SIBILANT_PLAN) {
  const n = 1 << Math.ceil(Math.log2(Math.max(256, samples.length)));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const aidRe = new Float64Array(n);
  const aidIm = new Float64Array(n);
  for (let i = 0; i < samples.length; i++) re[i] = samples[i];
  fftRadix2(re, im, false);
  aidRe.set(re);
  aidIm.set(im);
  const binHz = sr / n;
  const n2 = n / 2;
  const spanSrc = plan.srcHi - plan.srcLo;
  const spanDst = plan.dstHi - plan.dstLo;
  const mix = plan.mix ?? 1;
  for (let k = 1; k < n2; k++) {
    const f = k * binHz;
    if (f < plan.srcLo || f >= plan.srcHi) continue;
    const t = (f - plan.srcLo) / spanSrc;
    const fd = plan.dstLo + t * spanDst;
    if (fd < 80 || fd >= sr / 2) continue;
    const bin = fd / binHz;
    const k0 = Math.floor(bin);
    const frac = bin - k0;
    if (k0 > 0 && k0 < n2) {
      aidRe[k0] += re[k] * mix * (1 - frac);
      aidIm[k0] += im[k] * mix * (1 - frac);
    }
    if (k0 + 1 > 0 && k0 + 1 < n2) {
      aidRe[k0 + 1] += re[k] * mix * frac;
      aidIm[k0 + 1] += im[k] * mix * frac;
    }
  }
  return { re, im, aidRe, aidIm, sr, n };
}

export function bandEnergyFromSpectrum(re, im, sr, lo, hi) {
  return spectrumBandEnergy(re, im, sr, lo, hi);
}

export function sibilantGate(srcE, lfE, plan = SIBILANT_PLAN) {
  const ratio = srcE / (lfE + 1e-18);
  return ratio >= (plan.gateRatio ?? 2.5) && srcE >= (plan.gateFloor ?? 1e-6);
}

/** Envelope-driven noise in the landing band — hiss stays a hiss. */
export function hissLikeProcessor(samples, sr, plan = SIBILANT_PLAN, rng = mulberry(7)) {
  const n = 1 << Math.ceil(Math.log2(Math.max(256, samples.length)));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const aidRe = new Float64Array(n);
  const aidIm = new Float64Array(n);
  for (let i = 0; i < samples.length; i++) re[i] = samples[i];
  fftRadix2(re, im, false);
  aidRe.set(re);
  aidIm.set(im);
  const srcE = spectrumBandEnergy(re, im, sr, plan.srcLo, plan.srcHi);
  const lfE = spectrumBandEnergy(re, im, sr, 250, Math.min(plan.srcLo, 2500));
  const open = !plan.gate || sibilantGate(srcE, lfE, plan);
  if (open) {
    const binHz = sr / n;
    const n2 = n / 2;
    const k0 = Math.max(1, Math.floor(plan.dstLo / binHz));
    const k1 = Math.min(n2, Math.ceil(plan.dstHi / binHz));
    const nSrc = Math.max(1, Math.ceil((plan.srcHi - plan.srcLo) / binHz));
    const env = Math.sqrt(srcE / nSrc) * (plan.mix ?? 0.85) * 0.55;
    for (let k = k0; k < k1; k++) {
      aidRe[k] += (rng() * 2 - 1) * env;
      aidIm[k] += (rng() * 2 - 1) * env;
    }
  }
  return { re, im, aidRe, aidIm, sr, n, open, srcE, lfE };
}

export function limitSample(s, env, ceil = 0.89, release = 0.995) {
  const next = Math.max(Math.abs(s), env * release);
  const out = next > ceil ? (s * ceil) / next : s;
  return { s: out, env: next };
}

function mulberry(seed) {
  let a = seed >>> 0;
  return function rand() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function spectrumBandEnergy(re, im, sr, lo, hi) {
  const n = re.length;
  const binHz = sr / n;
  let e = 0;
  const k0 = Math.max(1, Math.floor(lo / binHz));
  const k1 = Math.min(n / 2, Math.ceil(hi / binHz));
  for (let k = k0; k < k1; k++) e += re[k] * re[k] + im[k] * im[k];
  return e;
}

export function bandEnergy(samples, sr, lo, hi) {
  const n = samples.length;
  const nfft = 1 << Math.ceil(Math.log2(Math.max(256, n)));
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  for (let i = 0; i < n; i++) re[i] = samples[i];
  fftRadix2(re, im, false);
  const binHz = sr / nfft;
  let e = 0;
  const k0 = Math.max(1, Math.floor(lo / binHz));
  const k1 = Math.min(nfft / 2, Math.ceil(hi / binHz));
  for (let k = k0; k < k1; k++) e += re[k] * re[k] + im[k] * im[k];
  return e;
}

function fftRadix2(re, im, inverse) {
  const n = re.length;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size >> 1;
    const ang = ((inverse ? 2 : -2) * Math.PI) / size;
    const wr0 = Math.cos(ang);
    const wi0 = Math.sin(ang);
    for (let i = 0; i < n; i += size) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k + half];
        const ui = im[i + k + half];
        const tre = wr * ur - wi * ui;
        const tim = wr * ui + wi * ur;
        re[i + k + half] = re[i + k] - tre;
        im[i + k + half] = im[i + k] - tim;
        re[i + k] += tre;
        im[i + k] += tim;
        const nwr = wr * wr0 - wi * wi0;
        wi = wr * wi0 + wi * wr0;
        wr = nwr;
      }
    }
  }
}
