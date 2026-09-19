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
