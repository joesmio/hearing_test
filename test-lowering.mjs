import { readFileSync } from "node:fs";
import {
  mapTransposeHz,
  SIBILANT_PLAN,
  bandEnergy,
  transposeLikeProcessor,
  spectrumBandEnergy,
  hissLikeProcessor,
  sibilantGate,
  limitSample,
} from "./lowering.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function readWavMono(path) {
  const buf = readFileSync(path);
  const sr = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  const data = buf.subarray(44);
  const n = Math.floor(data.length / 2);
  const samples = new Float64Array(n);
  for (let i = 0; i < n; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
  assert(bits === 16, "16-bit wav");
  return { sr, samples };
}

const landed = mapTransposeHz(
  6000,
  SIBILANT_PLAN.srcLo,
  SIBILANT_PLAN.srcHi,
  SIBILANT_PLAN.dstLo,
  SIBILANT_PLAN.dstHi
);
assert(landed > 1200 && landed < 2000, `6 kHz → ${landed}`);
assert(SIBILANT_PLAN.srcHi >= 9000, "female /s/ source extends past 8 kHz");

const see = readWavMono(new URL("./audio/see-a.wav", import.meta.url));
const fee = readWavMono(new URL("./audio/fee-a.wav", import.meta.url));
const seeHi = bandEnergy(see.samples, see.sr, 4200, 8000);
const feeHi = bandEnergy(fee.samples, fee.sr, 4200, 8000);
assert(seeHi > feeHi * 1.8, `see should carry more 4–8 kHz than fee (${seeHi} vs ${feeHi})`);

const mapped = transposeLikeProcessor(see.samples, see.sr, SIBILANT_PLAN);
const destBefore = spectrumBandEnergy(mapped.re, mapped.im, see.sr, SIBILANT_PLAN.dstLo, SIBILANT_PLAN.dstHi);
const destAfter = spectrumBandEnergy(mapped.aidRe, mapped.aidIm, see.sr, SIBILANT_PLAN.dstLo, SIBILANT_PLAN.dstHi);
assert(destAfter > destBefore * 1.5, `transpose must move s energy into 1–2 kHz (${destBefore} → ${destAfter})`);

const feeMap = transposeLikeProcessor(fee.samples, fee.sr, SIBILANT_PLAN);
const feeBefore = spectrumBandEnergy(feeMap.re, feeMap.im, fee.sr, SIBILANT_PLAN.dstLo, SIBILANT_PLAN.dstHi);
const feeDest = spectrumBandEnergy(feeMap.aidRe, feeMap.aidIm, fee.sr, SIBILANT_PLAN.dstLo, SIBILANT_PLAN.dstHi);
const seeDelta = destAfter - destBefore;
const feeDelta = feeDest - feeBefore;
assert(
  seeDelta > feeDelta * 4,
  `see should dump more 4–8 kHz into 1–2 kHz than fee (${seeDelta} vs ${feeDelta})`
);

const seeBurst = see.samples.subarray(Math.floor(0.12 * see.sr), Math.floor(0.26 * see.sr));
const feeBurst = fee.samples.subarray(Math.floor(0.12 * fee.sr), Math.floor(0.26 * fee.sr));
const hissSee = hissLikeProcessor(seeBurst, see.sr, SIBILANT_PLAN);
const hissFee = hissLikeProcessor(feeBurst, fee.sr, SIBILANT_PLAN);
const hissSeeDest = spectrumBandEnergy(hissSee.aidRe, hissSee.aidIm, see.sr, SIBILANT_PLAN.dstLo, SIBILANT_PLAN.dstHi);
const hissSeeBefore = spectrumBandEnergy(hissSee.re, hissSee.im, see.sr, SIBILANT_PLAN.dstLo, SIBILANT_PLAN.dstHi);
const hissFeeDest = spectrumBandEnergy(hissFee.aidRe, hissFee.aidIm, fee.sr, SIBILANT_PLAN.dstLo, SIBILANT_PLAN.dstHi);
const hissFeeBefore = spectrumBandEnergy(hissFee.re, hissFee.im, fee.sr, SIBILANT_PLAN.dstLo, SIBILANT_PLAN.dstHi);
assert(hissSee.open, "see must open the sibilant gate");
assert(hissSeeDest - hissSeeBefore > (hissFeeDest - hissFeeBefore) * 2, "hiss substitution prefers see");

const vowel = new Float64Array(see.sr);
for (let i = 0; i < vowel.length; i++) vowel[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / see.sr);
const vowelMap = hissLikeProcessor(vowel, see.sr, SIBILANT_PLAN);
assert(!vowelMap.open, "a low vowel must not open the gate");
assert(!sibilantGate(1e-8, 1, SIBILANT_PLAN), "tiny highs stay closed");

let env = 0;
let peak = 0;
for (let i = 0; i < 40; i++) {
  const lim = limitSample(1.4, env);
  env = lim.env;
  peak = Math.max(peak, Math.abs(lim.s));
}
assert(peak <= 0.9, `limiter must catch 1.4 peaks, got ${peak}`);

console.log("lowering tests passed", {
  landed: Math.round(landed),
  seeHi: Math.round(seeHi),
  feeHi: Math.round(feeHi),
  destBefore: Math.round(destBefore),
  destAfter: Math.round(destAfter),
  seeDelta: Math.round(seeDelta),
  feeDelta: Math.round(feeDelta),
});
