/** Clinic-shaped SVG of the kitchen beep map. Quiet at the top, like the paper. */

const BAND_COLOR = {
  still: "#0e6a72",
  loud: "#a06a0e",
  gone: "#8a8176",
};

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function logX(freq, x0, width, lo = 250, hi = 8000) {
  const t = (Math.log(freq) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
  return x0 + Math.min(1, Math.max(0, t)) * width;
}

function hlY(hl, y0, height, maxHl = 110) {
  return y0 + (Math.min(maxHl, Math.max(0, hl)) / maxHl) * height;
}

export function hearingChartSvg(spectrum) {
  const points = spectrum?.points || [];
  const W = 720;
  const H = 400;
  const pad = { l: 78, r: 22, t: 28, b: 52 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const xAt = (f) => logX(f, pad.l, innerW);
  const yAt = (hl) => hlY(hl, pad.t, innerH);

  const gridH = [0, 20, 40, 60, 80, 100]
    .map((db) => {
      const y = yAt(db);
      return `<line class="grid" x1="${pad.l}" y1="${y}" x2="${pad.l + innerW}" y2="${y}" stroke="#cec5b5" stroke-width="1"/>
        <text x="${pad.l - 10}" y="${y + 4}" text-anchor="end">${db}</text>`;
    })
    .join("");

  const ticks = [250, 500, 1000, 2000, 4000, 8000];
  const gridV = ticks
    .map((f) => {
      const x = xAt(f);
      const lab = f >= 1000 ? `${f / 1000}k` : String(f);
      return `<line class="grid" x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + innerH}" stroke="#e2dbd0" stroke-width="1"/>
        <text x="${x}" y="${pad.t + innerH + 22}" text-anchor="middle">${lab}</text>`;
    })
    .join("");

  let landing = "";
  if (spectrum?.landing && spectrum.landing.hi > spectrum.landing.lo) {
    const x = xAt(spectrum.landing.lo);
    const w = Math.max(10, xAt(spectrum.landing.hi) - x);
    landing = `<rect class="landing landing-band" x="${x}" y="${pad.t}" width="${w}" height="${innerH}" fill="rgba(14,106,114,0.14)" />
      <text x="${x + w / 2}" y="${pad.t - 8}" text-anchor="middle" fill="#0b4c53">hiss sits here</text>`;
  }

  const plotted = points.filter((p) => p.freq >= 250 && p.freq <= 8000);
  const path = plotted
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(p.freq).toFixed(1)} ${yAt(p.hl).toFixed(1)}`)
    .join(" ");

  const dots = plotted
    .map((p) => {
      const fill = BAND_COLOR[p.band] || "#1a1917";
      return `<circle class="${escapeXml(p.band)}" cx="${xAt(p.freq).toFixed(1)}" cy="${yAt(p.hl).toFixed(1)}" r="8" fill="${fill}" stroke="#fffdfa" stroke-width="2.5"/>`;
    })
    .join("");

  const title = escapeXml("Kitchen beeps through these headphones. Quiet at the top, like a clinic chart.");
  return `<svg class="hearing-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#fffdfa"/>
    ${landing}
    ${gridH}
    ${gridV}
    <text x="16" y="${pad.t + 8}" fill="#5e5951">Heard easily</text>
    <text x="16" y="${pad.t + innerH}" fill="#5e5951">Not heard</text>
    <path class="curve" d="${path}" fill="none" stroke="#1a1917" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
  </svg>`;
}

export function renderHearingChart(host, spectrum) {
  if (!host) return;
  host.innerHTML = hearingChartSvg(spectrum);
}

export function hearingPillsHtml(spectrum) {
  return (spectrum?.points || [])
    .map((p) => {
      const word = p.band === "still" ? "still there" : p.band === "loud" ? "only loud" : "gone";
      return `<li class="${escapeXml(p.band)}" data-freq="${p.freq}">${escapeXml(p.label)} · ${word}</li>`;
    })
    .join("");
}
