import { readFileSync } from "node:fs";
import {
  mapTransposeHz,
  SIBILANT_PLAN,
  bandEnergy,
  transposeLikeProcessor,
  spectrumBandEnergy,
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
assert(landed > 1500 && landed < 2000, `6 kHz → ${landed}`);

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
const feeDest = spectrumBandEnergy(feeMap.aidRe, feeMap.aidIm, fee.sr, SIBILANT_PLAN.dstLo, SIBILANT_PLAN.dstHi);
assert(destAfter > feeDest, "after remap, see should still out-hiss fee in the landing band");

console.log("lowering tests passed", {
  landed: Math.round(landed),
  seeHi: Math.round(seeHi),
  feeHi: Math.round(feeHi),
  destBefore: Math.round(destBefore),
  destAfter: Math.round(destAfter),
});
