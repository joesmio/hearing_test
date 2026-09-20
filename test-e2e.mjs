import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT || 8767);
const CHROME = process.env.CHROME || "/opt/google/chrome/chrome";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function waitPort(port, ms = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => {
        sock.end();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - start > ms) reject(new Error(`port ${port} not up`));
        else setTimeout(tryOnce, 80);
      });
    };
    tryOnce();
  });
}

async function loadPuppeteer() {
  try {
    return (await import("puppeteer-core")).default;
  } catch {
    return null;
  }
}

const puppeteer = await loadPuppeteer();
if (!puppeteer) {
  console.log("e2e skipped — puppeteer-core not installed");
  process.exit(0);
}

const server = spawn("python3", ["server.py", "--port", String(PORT)], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => {
  serverLog += d.toString();
});
server.stderr.on("data", (d) => {
  serverLog += d.toString();
});

console.log("launching chrome", CHROME);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  timeout: 20000,
  userDataDir: `/tmp/fee-e2e-${PORT}-${Date.now()}`,
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--remote-debugging-port=${PORT + 1000}`,
  ],
});
console.log("chrome up");

let failed = "";
try {
  console.log("waiting for server", PORT);
  await waitPort(PORT);
  console.log("server ready", serverLog.trim());
  const sister = await browser.newPage();
  const him = await browser.newPage();
  sister.on("pageerror", (e) => {
    failed += `sister pageerror ${e.message}\n`;
  });
  him.on("pageerror", (e) => {
    failed += `him pageerror ${e.message}\n`;
  });

  console.log("opening pages");
  await sister.goto(`http://127.0.0.1:${PORT}/?ui=1&n=2`, { waitUntil: "load", timeout: 15000 });
  await him.goto(`http://127.0.0.1:${PORT}/him.html`, { waitUntil: "load", timeout: 15000 });
  console.log("pages loaded");

  const setup = await sister.$eval("[data-testid=setup]", (el) => el.textContent);
  assert(/Sidecar/i.test(setup), "sister setup must mention Sidecar / iPad");

  const workletMove = await sister.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    await ctx.audioWorklet.addModule("processor.js");
    const wav = await fetch("audio/see-a.wav");
    const srcBuf = await ctx.decodeAudioData(await wav.arrayBuffer());
    const node = new AudioWorkletNode(ctx, "hearing-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.port.postMessage({
      mode: "hiss",
      listen: "aid",
      srcLo: 3500,
      srcHi: 10000,
      dstLo: 1000,
      dstHi: 2200,
      mix: 0.85,
      gate: true,
    });
    const src = ctx.createBufferSource();
    src.buffer = srcBuf;
    src.connect(node);
    node.connect(ctx.destination);
    src.start();
    const out = await ctx.startRendering();
    const x = out.getChannelData(0);
    const n = 1 << Math.ceil(Math.log2(x.length));
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    re.set(x);
    const rev = new Uint32Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      rev[i] = j;
      let m = n >> 1;
      while (m >= 1 && j >= m) {
        j -= m;
        m >>= 1;
      }
      j += m;
    }
    for (let i = 0; i < n; i++) {
      if (rev[i] > i) {
        const t = re[i];
        re[i] = re[rev[i]];
        re[rev[i]] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size >> 1;
      const ang = (-2 * Math.PI) / size;
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
    const binHz = 44100 / n;
    let dest = 0;
    let hi = 0;
    for (let k = 1; k < n / 2; k++) {
      const f = k * binHz;
      const e = re[k] * re[k] + im[k] * im[k];
      if (f >= 1000 && f < 2200) dest += e;
      if (f >= 4200 && f < 8000) hi += e;
    }
    return { dest, hi, peak: Math.max(...x) };
  });
  console.log("worklet offline", workletMove);
  assert(workletMove.dest > 0, "worklet produced landing-band energy");
  assert(workletMove.peak < 0.95, `limiter held peak ${workletMove.peak}`);

  console.log("start ear");
  await sister.evaluate(() => document.querySelector("[data-testid=start-ear]").click());
  await sister.waitForSelector("[data-testid=view-ear]:not([hidden])", { timeout: 8000 });
  await him.waitForSelector("[data-testid=ear-answers]:not([hidden])", { timeout: 8000 });
  const earPrompt = await him.$eval("[data-testid=listener-prompt]", (el) => el.textContent);
  assert(/beep/i.test(earPrompt), earPrompt);
  const leakedHz = await him.evaluate(() => document.body.innerText);
  assert(!/\b1000\b|\bkHz\b/i.test(leakedHz), "him saw a frequency");
  await him.evaluate(() => {
    const btn = document.querySelector("[data-testid=answer-heard]");
    btn.click();
    btn.click();
  });
  await sister.waitForFunction(
    () => (document.querySelector("[data-testid=ear-freq]") || {}).textContent === "500 Hz",
    { timeout: 3000 }
  );
  const afterDup = await sister.$eval("[data-testid=ear-freq]", (el) => el.textContent);
  assert(afterDup === "500 Hz", `duplicate tap skipped a band: ${afterDup}`);

  console.log("finish kitchen beeps → hearing review");
  await sister.evaluate(() => window.feeSeeTest.completeEar([250, 500, 1000, 1500]));
  await sister.waitForSelector("[data-testid=view-review]:not([hidden])", { timeout: 8000 });
  await him.waitForSelector("[data-testid=hearing-review]:not([hidden])", { timeout: 8000 });
  const himReview = await him.$eval("[data-testid=hearing-review]", (el) => el.innerText);
  assert(/clinic/i.test(himReview), `him review copy ${himReview.slice(0, 80)}`);
  const himChart = await him.$eval("[data-testid=hearing-chart]", (el) => el.innerHTML);
  assert(/<svg/i.test(himChart), "him saw the hearing chart");
  const himPills = await him.$eval("[data-testid=hearing-pills]", (el) => el.textContent);
  assert(/1k|1000/.test(himPills), `him pills ${himPills}`);
  const leakedCue = await him.evaluate(() => document.body.innerText);
  assert(!/Say\s+FEE/i.test(leakedCue) && !/Say\s+SEE/i.test(leakedCue), "review leaked a sister cue");
  await him.evaluate(() => document.querySelector("[data-testid=answer-looks-right]").click());
  await sister.waitForSelector("[data-testid=view-practice]:not([hidden])", { timeout: 8000 });
  const reviewGone = await him.$eval("[data-testid=hearing-review]", (el) => el.hidden);
  assert(reviewGone, "review hides after he confirms");

  console.log("start mic");
  await sister.evaluate(() => document.querySelector("[data-testid=start-mic]").click());
  await sister.waitForSelector("[data-testid=view-practice]:not([hidden])", { timeout: 8000 });
  console.log("practice visible");
  await sister.evaluate(() => document.querySelector("[data-testid=practice-fee]").click());
  await him.waitForFunction(
    () => {
      const el = document.querySelector("[data-testid=practice-word]");
      return el && !el.hidden && el.textContent === "FEE";
    },
    { timeout: 8000 }
  );
  console.log("him saw FEE practice cue");

  console.log("begin test");
  await sister.evaluate(() => document.querySelector("[data-testid=begin-test]").click());
  await sister.waitForSelector("[data-testid=view-trial]:not([hidden])", { timeout: 8000 });
  console.log("trial visible");

  for (let i = 0; i < 4; i++) {
    await sister.waitForFunction(
      () => {
        const el = document.querySelector("[data-testid=sister-word]");
        return el && /FEE|SEE/.test(el.textContent || "");
      },
      { timeout: 8000 }
    );
    const word = await sister.$eval("[data-testid=sister-word]", (el) =>
      /FEE/.test(el.textContent || "") ? "fee" : "see"
    );
    console.log("trial", i, word);
    const leaked = await him.evaluate(() => document.body.innerText);
    assert(!/Say\s+FEE/i.test(leaked) && !/Say\s+SEE/i.test(leaked), `him leaked cue on trial ${i}`);
    await sister.evaluate(() => document.querySelector("[data-testid=said-it]").click());
    await him.waitForSelector("#answers:not([hidden])", { timeout: 8000 });
    await him.evaluate((w) => document.querySelector(`[data-testid=answer-${w}]`).click(), word);
  }

  await sister.waitForSelector("[data-testid=view-results]:not([hidden])");
  await him.waitForSelector("[data-testid=view-results]:not([hidden])");
  const sisterDry = await sister.$eval("[data-testid=score-dry]", (el) => el.textContent);
  const himDsp = await him.$eval("[data-testid=score-dsp]", (el) => el.textContent);
  assert(/2\s*\/\s*2/.test(sisterDry), `sister dry score ${sisterDry}`);
  assert(/2\s*\/\s*2/.test(himDsp), `him dsp score ${himDsp}`);
  const himHeadline = await him.$eval("[data-testid=result-headline]", (el) => el.textContent);
  assert(himHeadline && himHeadline.length > 4, "him results headline");
  const linked = await him.$eval("[data-testid=link-lamp]", (el) => el.textContent);
  assert(/linked/i.test(linked), `link lamp ${linked}`);
  assert(!failed, failed);

  console.log("e2e two-screen passed", { sisterDry, himDsp, himHeadline });
} catch (err) {
  failed += String(err && err.stack ? err.stack : err);
  throw err;
} finally {
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2000))]).catch(() => {});
  server.kill("SIGTERM");
}

if (serverLog.includes("Traceback")) {
  console.error(serverLog);
}
