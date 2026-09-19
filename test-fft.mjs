/** Offline STFT/OLA reconstruction check (mirrors processor.js). */

const FFT_SIZE = 1024;
const HOP = 256;

class FFT {
  constructor(n) {
    this.n = n;
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      this.rev[i] = j;
      let m = n >> 1;
      while (m >= 1 && j >= m) {
        j -= m;
        m >>= 1;
      }
      j += m;
    }
  }

  transform(re, im, inverse) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const r = this.rev[i];
      if (r > i) {
        let t = re[i];
        re[i] = re[r];
        re[r] = t;
        t = im[i];
        im[i] = im[r];
        im[r] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size >> 1;
      const tableStep = n / size;
      for (let i = 0; i < n; i += size) {
        let k = 0;
        for (let j = 0; j < half; j++) {
          const wr = this.cos[k];
          const wi = inverse ? -this.sin[k] : this.sin[k];
          const ur = re[i + j + half];
          const ui = im[i + j + half];
          const tre = wr * ur - wi * ui;
          const tim = wr * ui + wi * ur;
          re[i + j + half] = re[i + j] - tre;
          im[i + j + half] = im[i + j] - tim;
          re[i + j] += tre;
          im[i + j] += tim;
          k += tableStep;
        }
      }
    }
    if (inverse) {
      const s = 1 / n;
      for (let i = 0; i < n; i++) {
        re[i] *= s;
        im[i] *= s;
      }
    }
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const fft = new FFT(8);
const re = new Float32Array([1, 0.5, 0.2, 0.1, 0, 0.1, 0.2, 0.5]);
const im = new Float32Array(8);
const orig = Float32Array.from(re);
fft.transform(re, im, false);
fft.transform(re, im, true);
for (let i = 0; i < 8; i++) {
  assert(Math.abs(re[i] - orig[i]) < 1e-6, `roundtrip ${i}: ${re[i]} vs ${orig[i]}`);
}

const sr = 44100;
const n = sr * 1;
const freq = 1000;
const input = new Float32Array(n);
for (let i = 0; i < n; i++) input[i] = 0.25 * Math.sin((2 * Math.PI * freq * i) / sr);

const win = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / FFT_SIZE));
const ola = new Float32Array(input.length + FFT_SIZE);
const f = new FFT(FFT_SIZE);
const makeup = 2 / 3;
for (let pos = 0; pos + FFT_SIZE <= input.length; pos += HOP) {
  const xr = new Float32Array(FFT_SIZE);
  const xi = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) xr[i] = input[pos + i] * win[i];
  f.transform(xr, xi, false);
  f.transform(xr, xi, true);
  for (let i = 0; i < FFT_SIZE; i++) ola[pos + i] += xr[i] * win[i] * makeup;
}

let peakIn = 0;
let peakOut = 0;
let err = 0;
let count = 0;
for (let i = FFT_SIZE; i < input.length - FFT_SIZE; i++) {
  peakIn = Math.max(peakIn, Math.abs(input[i]));
  peakOut = Math.max(peakOut, Math.abs(ola[i]));
  err += (ola[i] - input[i]) ** 2;
  count++;
}
const rms = Math.sqrt(err / count);
console.log({ peakIn, peakOut, rms });
assert(peakOut > 0.2 && peakOut < 0.3, `peak ${peakOut}`);
assert(rms < 0.005, `reconstruction rms ${rms} too high`);
console.log("fft/ola tests passed");
