/** Sister-laptop live view: waveform + two scrolling spectrograms. */

const FMIN = 80;
const FMAX = 8000;

export function freqAtY(y, h, fMin = FMIN, fMax = FMAX) {
  return fMin * Math.pow(fMax / fMin, 1 - y / Math.max(1, h));
}

export function packIndexForHz(hz, n = 160, fMin = FMIN, fMax = FMAX) {
  const t = Math.log(Math.max(hz, fMin) / fMin) / Math.log(fMax / fMin);
  return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
}

/** Synthetic SEE-like frames so UI tests can paint without a microphone. */
export function demoSeePacks() {
  const mic = new Float32Array(160);
  const aid = new Float32Array(160);
  mic.fill(-82);
  aid.fill(-82);
  const sLo = packIndexForHz(3500);
  const sHi = packIndexForHz(8000);
  const dLo = packIndexForHz(900);
  const dHi = packIndexForHz(1800);
  for (let i = sLo; i <= sHi; i++) mic[i] = -26 - (i - sLo) * 0.08;
  for (let i = 20; i < 55; i++) mic[i] = -48;
  aid.set(mic);
  for (let i = dLo; i <= dHi; i++) aid[i] = Math.max(aid[i], -30);
  return { mic, aid };
}

function bindCanvas(canvas, h = 168) {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  const w = canvas.width || 640;
  const height = canvas.height || h;
  ctx.fillStyle = "#14130f";
  ctx.fillRect(0, 0, w, height);
  return { canvas, ctx, w, h: height, image: ctx.getImageData(0, 0, w, height), frames: 0 };
}

function colour(t, which) {
  if (which === "mic") {
    return [24 + t * 220, 36 + t * 140, 28 + t * 70];
  }
  return [18 + t * 80, 36 + t * 190, 40 + t * 160];
}

export function paintSpectrogram(view, db, which, bands) {
  if (!view || !db || !db.length) return;
  const { ctx, w, h, image } = view;
  const data = image.data;
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    data.copyWithin(y * rowBytes, y * rowBytes + 8, (y + 1) * rowBytes);
  }
  view.frames += 1;
  for (let y = 0; y < h; y++) {
    const i = Math.max(0, Math.min(db.length - 1, Math.round((1 - y / h) * (db.length - 1))));
    const t = Math.min(1, Math.max(0, (db[i] + 80) / 55));
    let [r, g, b] = colour(t, which);
    const f = freqAtY(y, h);
    if (bands) {
      if (which === "mic" && f >= bands.srcLo && f <= bands.srcHi) r = Math.min(255, r + 46);
      if (which === "aid" && f >= bands.dstLo && f <= bands.dstHi) g = Math.min(255, g + 50);
    }
    for (const dx of [0, 1]) {
      const off = (y * w + (w - 1 - dx)) * 4;
      data[off] = r;
      data[off + 1] = g;
      data[off + 2] = b;
      data[off + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export function paintWaveform(view, bytes) {
  if (!view || !bytes) return;
  const { ctx, w, h } = view;
  ctx.fillStyle = "#14130f";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#c9e6e4";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const mid = h / 2;
  for (let x = 0; x < w; x++) {
    const i = Math.floor((x / w) * bytes.length);
    const y = mid + ((bytes[i] - 128) / 128) * (mid - 3);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export function createLiveSpectrum() {
  let wave = null;
  let mic = null;
  let aid = null;
  const waveBytes = new Uint8Array(1024);

  function attach({ wave: waveEl, mic: micEl, aid: aidEl } = {}) {
    wave = bindCanvas(waveEl, waveEl?.height || 64);
    mic = bindCanvas(micEl, 168);
    aid = bindCanvas(aidEl, 168);
  }

  function paintFft(msg, plan) {
    const bands = {
      srcLo: plan?.srcLo ?? 3500,
      srcHi: plan?.srcHi ?? 10000,
      dstLo: plan?.dstLo ?? 1000,
      dstHi: plan?.dstHi ?? 2200,
    };
    if (msg.mic) paintSpectrogram(mic, msg.mic, "mic", bands);
    if (msg.aid) paintSpectrogram(aid, msg.aid, "aid", bands);
  }

  function paintWave(analyser) {
    if (!wave || !analyser) return;
    analyser.getByteTimeDomainData(waveBytes);
    paintWaveform(wave, waveBytes);
  }

  function paintDemo(plan, frames = 1) {
    const packs = demoSeePacks();
    for (let i = 0; i < frames; i++) paintFft(packs, plan);
    if (wave) {
      const bytes = new Uint8Array(1024);
      for (let i = 0; i < bytes.length; i++) bytes[i] = 128 + Math.sin(i / 9) * 40;
      paintWaveform(wave, bytes);
    }
  }

  return { attach, paintFft, paintWave, paintDemo };
}
