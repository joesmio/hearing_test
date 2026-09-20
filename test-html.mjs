import { readFileSync } from "node:fs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sister = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const him = readFileSync(new URL("./him.html", import.meta.url), "utf8");

for (const id of [
  "sister-face",
  "open-him",
  "start-mic",
  "start-ear",
  "start-cal",
  "play-cue",
  "sister-word",
  "said-it",
  "practice-fee",
  "preview-fee",
  "preview-see",
  "her-file",
  "run-length",
  "begin-test",
  "score-dry",
  "score-dsp",
  "app-error",
  "out-device",
]) {
  assert(sister.includes(`data-testid="${id}"`), `sister missing ${id}`);
}

for (const id of [
  "listener-face",
  "listener-prompt",
  "answer-fee",
  "answer-see",
  "result-headline",
  "link-lamp",
  "ear-answers",
  "answer-heard",
]) {
  assert(him.includes(`data-testid="${id}"`), `him missing ${id}`);
}

assert(sister.includes("sister.js"), "sister app");
assert(him.includes("him.js"), "him app");
assert(/Sidecar/i.test(sister), "sister must explain the iPad extended screen");
assert(/hearing aids/i.test(sister), "aids-off warning");
assert(/mouth/i.test(sister), "lipreading warning");
assert(/clinic audiogram/i.test(sister), "kitchen vs clinic");
assert(/him\.html/.test(sister), "sister must point at his page");
assert(!him.includes("sister-word"), "his page must not include the sister cue id");
assert(!him.toLowerCase().includes("say  fee"), "his html must not hard-code the cue");
console.log("html contract passed");
