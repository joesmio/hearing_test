import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT || 8767);
const CHROME = process.env.CHROME || "/usr/local/bin/google-chrome";

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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});

let failed = "";
try {
  await waitPort(PORT);
  const sister = await browser.newPage();
  const him = await browser.newPage();
  sister.on("pageerror", (e) => {
    failed += `sister pageerror ${e.message}\n`;
  });
  him.on("pageerror", (e) => {
    failed += `him pageerror ${e.message}\n`;
  });

  await sister.goto(`http://127.0.0.1:${PORT}/?ui=1&n=2`, { waitUntil: "networkidle0" });
  await him.goto(`http://127.0.0.1:${PORT}/him.html`, { waitUntil: "networkidle0" });

  const setup = await sister.$eval("[data-testid=setup]", (el) => el.textContent);
  assert(/Sidecar/i.test(setup), "sister setup must mention Sidecar / iPad");

  await sister.click("[data-testid=start-mic]");
  await sister.waitForSelector("[data-testid=view-practice]:not([hidden])");
  await sister.click("[data-testid=preview-fee]");
  await him.waitForFunction(() => {
    const el = document.querySelector("[data-testid=practice-word]");
    return el && !el.hidden && el.textContent === "FEE";
  });

  await sister.click("[data-testid=begin-test]");
  await sister.waitForSelector("[data-testid=view-trial]:not([hidden])");

  for (let i = 0; i < 4; i++) {
    await sister.waitForFunction(() => {
      const el = document.querySelector("[data-testid=sister-word]");
      return el && /FEE|SEE/.test(el.textContent || "");
    });
    const word = await sister.$eval("[data-testid=sister-word]", (el) =>
      /FEE/.test(el.textContent || "") ? "fee" : "see"
    );
    const leaked = await him.evaluate(() => document.body.innerText);
    assert(!/Say\s+FEE/i.test(leaked) && !/Say\s+SEE/i.test(leaked), `him leaked cue on trial ${i}`);
    await sister.click("[data-testid=said-it]");
    await him.waitForSelector("#answers:not([hidden])");
    await him.click(`[data-testid=answer-${word}]`);
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
} finally {
  await browser.close().catch(() => {});
  server.kill("SIGTERM");
  setTimeout(() => {
    try {
      server.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }, 500);
}

if (serverLog.includes("Traceback")) {
  console.error(serverLog);
}
