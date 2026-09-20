/* Hearing-demo AudioWorklet: STFT lowering + ear-filter simulation. */

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

function mirrorHermitian(re, im) {
  const n = re.length;
  im[0] = 0;
  im[n / 2] = 0;
  for (let k = 1; k < n / 2; k++) {
    re[n - k] = re[k];
    im[n - k] = -im[k];
  }
}

function interpThresh(f, freqs, th) {
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

function addInterp(re, im, bin, r, i) {
  const n2 = re.length / 2;
  if (bin <= 0 || bin >= n2) return;
  const k0 = Math.floor(bin);
  const frac = bin - k0;
  const k1 = k0 + 1;
  const a = 1 - frac;
  re[k0] += r * a;
  im[k0] += i * a;
  if (k1 < n2) {
    re[k1] += r * frac;
    im[k1] += i * frac;
  }
}

function packLog(re, im, sr, out, fMin, fMax) {
  const n = re.length;
  const binHz = sr / n;
  const nOut = out.length;
  for (let i = 0; i < nOut; i++) {
    const f0 = fMin * Math.pow(fMax / fMin, i / nOut);
    const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / nOut);
    const k0 = Math.max(1, Math.floor(f0 / binHz));
    const k1 = Math.min(n / 2, Math.ceil(f1 / binHz));
    let mx = 1e-18;
    for (let k = k0; k < k1; k++) {
      const m = re[k] * re[k] + im[k] * im[k];
      if (m > mx) mx = m;
    }
    out[i] = 10 * Math.log10(mx);
  }
}

class HearingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fft = new FFT(FFT_SIZE);
    this.re = new Float32Array(FFT_SIZE);
    this.im = new Float32Array(FFT_SIZE);
    this.aidRe = new Float32Array(FFT_SIZE);
    this.aidIm = new Float32Array(FFT_SIZE);
    this.earRe = new Float32Array(FFT_SIZE);
    this.earIm = new Float32Array(FFT_SIZE);
    this.win = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      this.win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / FFT_SIZE));
    }
    this.input = new Float32Array(FFT_SIZE * 2);
    this.inputFill = 0;
    this.ola = new Float32Array(FFT_SIZE);
    this.outBuf = new Float32Array(8192);
    this.outW = 0;
    this.outR = 0;
    this.outCount = 0;
    this.aidPack = new Float32Array(160);
    this.earPack = new Float32Array(160);
    this.micPack = new Float32Array(160);
    this.frame = 0;
    this.gateEnv = 0;
    this.limitEnv = 0;
    this.rng = 123456789;
    this.cfg = {
      mode: "loss",
      freqs: [250, 500, 1000, 2000, 3000, 4000, 6000, 8000],
      thresh: [20, 20, 25, 35, 50, 65, 70, 75],
      deadDb: 90,
      srcLo: 3500,
      srcHi: 10000,
      dstLo: 1000,
      dstHi: 2200,
      ratio: 2.2,
      start: 1600,
      listen: "ear",
      mix: 0.85,
      makeup: 2 / 3,
      gate: true,
      gateRatio: 2.5,
      gateFloor: 1e-6,
      limitCeil: 0.89,
    };
    this.port.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.thresh) this.cfg.thresh = msg.thresh;
      if (msg.freqs) this.cfg.freqs = msg.freqs;
      Object.assign(this.cfg, msg);
    };
    this.port.postMessage({ type: "ready" });
  }

  nextRand() {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) | 0;
    return (this.rng >>> 0) / 4294967296;
  }

  applyAid() {
    const { re, im, aidRe, aidIm, cfg } = this;
    const n = FFT_SIZE;
    const binHz = sampleRate / n;
    const n2 = n / 2;
    const mode = cfg.mode;

    aidRe.fill(0);
    aidIm.fill(0);

    if (mode === "original" || mode === "loss") {
      aidRe.set(re);
      aidIm.set(im);
      return;
    }

    if (mode === "boost") {
      for (let k = 1; k < n2; k++) {
        const f = k * binHz;
        const th = interpThresh(f, cfg.freqs, cfg.thresh);
        const insert = Math.min(42, Math.max(0, (th - 20) * 0.6));
        const g = Math.pow(10, insert / 20);
        aidRe[k] = re[k] * g;
        aidIm[k] = im[k] * g;
      }
      mirrorHermitian(aidRe, aidIm);
      return;
    }

    if (mode === "transpose" || mode === "hiss") {
      aidRe.set(re);
      aidIm.set(im);
      let srcE = 0;
      let lfE = 0;
      let nSrc = 0;
      for (let k = 1; k < n2; k++) {
        const f = k * binHz;
        const mag = re[k] * re[k] + im[k] * im[k];
        if (f >= 250 && f < Math.min(cfg.srcLo, 2500)) lfE += mag;
        if (f >= cfg.srcLo && f < cfg.srcHi) {
          srcE += mag;
          nSrc += 1;
        }
      }
      const ratio = srcE / (lfE + 1e-18);
      const want =
        !cfg.gate || (ratio >= (cfg.gateRatio || 2.5) && srcE >= (cfg.gateFloor || 1e-6));
      const target = want ? 1 : 0;
      const coeff = target > this.gateEnv ? 0.62 : 0.11;
      this.gateEnv += (target - this.gateEnv) * coeff;
      const g = this.gateEnv * (cfg.mix ?? 0.85);
      if (g > 0.04 && mode === "transpose") {
        const spanSrc = cfg.srcHi - cfg.srcLo;
        const spanDst = cfg.dstHi - cfg.dstLo;
        if (spanSrc > 0 && spanDst > 0) {
          for (let k = 1; k < n2; k++) {
            const f = k * binHz;
            if (f < cfg.srcLo || f >= cfg.srcHi) continue;
            const t = (f - cfg.srcLo) / spanSrc;
            const fd = cfg.dstLo + t * spanDst;
            if (fd < 80 || fd >= sampleRate / 2) continue;
            addInterp(aidRe, aidIm, fd / binHz, re[k] * g, im[k] * g);
          }
        }
      }
      if (g > 0.04 && mode === "hiss") {
        const env = Math.sqrt(srcE / Math.max(1, nSrc)) * g * 0.55;
        const k0 = Math.max(1, Math.floor(cfg.dstLo / binHz));
        const k1 = Math.min(n2, Math.ceil(cfg.dstHi / binHz));
        for (let k = k0; k < k1; k++) {
          aidRe[k] += (this.nextRand() * 2 - 1) * env;
          aidIm[k] += (this.nextRand() * 2 - 1) * env;
        }
      }
      mirrorHermitian(aidRe, aidIm);
      return;
    }

    if (mode === "compress") {
      const start = cfg.start;
      const ratio = Math.max(1.1, cfg.ratio);
      for (let k = 1; k < n2; k++) {
        const f = k * binHz;
        const fOut = f <= start ? f : start + (f - start) / ratio;
        if (fOut <= 0 || fOut >= sampleRate / 2) continue;
        const g = f <= start ? 1 : cfg.mix;
        addInterp(aidRe, aidIm, fOut / binHz, re[k] * g, im[k] * g);
      }
      mirrorHermitian(aidRe, aidIm);
    }
  }

  applyEar() {
    const { aidRe, aidIm, earRe, earIm, cfg } = this;
    const n2 = FFT_SIZE / 2;
    const binHz = sampleRate / FFT_SIZE;
    earRe.fill(0);
    earIm.fill(0);
    for (let k = 1; k < n2; k++) {
      const f = k * binHz;
      const th = interpThresh(f, cfg.freqs, cfg.thresh);
      const dead = th >= cfg.deadDb;
      const att = dead ? 82 : Math.max(0, th - 12);
      const g = Math.pow(10, -att / 20);
      earRe[k] = aidRe[k] * g;
      earIm[k] = aidIm[k] * g;
    }
    mirrorHermitian(earRe, earIm);
  }

  processFrame() {
    const { re, im, win, fft, ola, cfg } = this;
    im.fill(0);
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = this.input[i] * win[i];
    }
    fft.transform(re, im, false);
    packLog(re, im, sampleRate, this.micPack, 80, 8000);
    this.applyAid();
    this.applyEar();

    let useRe = this.earRe;
    let useIm = this.earIm;
    if (cfg.listen === "dry") {
      useRe = re;
      useIm = im;
    } else if (cfg.listen === "aid") {
      useRe = this.aidRe;
      useIm = this.aidIm;
    }

    // Copy chosen spectrum into re/im for inverse (don't destroy packs).
    this.re.set(useRe);
    this.im.set(useIm);
    fft.transform(this.re, this.im, true);

    const makeup = cfg.makeup || 2 / 3;
    for (let i = 0; i < FFT_SIZE; i++) {
      ola[i] += this.re[i] * win[i] * makeup;
    }

    const ceil = cfg.limitCeil || 0.89;
    for (let i = 0; i < HOP; i++) {
      let s = ola[i];
      this.limitEnv = Math.max(Math.abs(s), this.limitEnv * 0.995);
      if (this.limitEnv > ceil) s *= ceil / this.limitEnv;
      this.outBuf[this.outW] = s;
      this.outW = (this.outW + 1) % this.outBuf.length;
      this.outCount++;
    }
    ola.copyWithin(0, HOP);
    ola.fill(0, FFT_SIZE - HOP);

    this.input.copyWithin(0, HOP);
    this.inputFill -= HOP;

    this.frame++;
    if (this.frame % 2 === 0) {
      packLog(this.aidRe, this.aidIm, sampleRate, this.aidPack, 80, 8000);
      packLog(this.earRe, this.earIm, sampleRate, this.earPack, 80, 8000);
      this.port.postMessage({
        type: "fft",
        mic: this.micPack.slice(),
        aid: this.aidPack.slice(),
        ear: this.earPack.slice(),
      });
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const outCh = output[0];
    const inCh = input && input[0];
    const n = outCh.length;

    for (let i = 0; i < n; i++) {
      this.input[this.inputFill++] = inCh ? inCh[i] : 0;
      if (this.inputFill >= FFT_SIZE) this.processFrame();
    }

    for (let i = 0; i < n; i++) {
      if (this.outCount > 0) {
        outCh[i] = this.outBuf[this.outR];
        this.outR = (this.outR + 1) % this.outBuf.length;
        this.outCount--;
      } else {
        outCh[i] = 0;
      }
    }
    return true;
  }
}

registerProcessor("hearing-processor", HearingProcessor);
