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
  "view-review",
  "hearing-chart",
  "accept-hearing",
  "saved-map",
  "saved-map-because",
  "live-scope",
  "live-wave",
  "spec-mic",
  "spec-aid",
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
  "hearing-review",
  "hearing-chart",
  "using-chart",
  "answer-looks-right",
  "answer-redo-beeps",
]) {
  assert(him.includes(`data-testid="${id}"`), `him missing ${id}`);
}

assert(sister.includes("sister.js"), "sister app");
assert(him.includes("him.js"), "him app");
assert(/Sidecar/i.test(sister), "sister must explain the iPad extended screen");
assert(/hearing aids/i.test(sister), "aids-off warning");
assert(/mouth/i.test(sister), "lipreading warning");
assert(/clinic audiogram/i.test(sister), "kitchen vs clinic");
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
assert(/g-answers\[hidden\]/.test(css), "hidden answer rows must beat display:grid");
assert(/#hearingReview\[hidden\]/.test(css), "hearing review hidden must beat display");
assert(him.includes("LOOKS RIGHT"), "him can confirm the kitchen map");
assert(!/Say\s+SEE/.test(him), "his review must not include her cue");
assert(/him\.html/.test(sister), "sister must point at his page");
assert(!him.includes("spec-mic"), "his page must not show her spectrogram");
assert(!him.includes("live-scope"), "his page must not show the live scope");
assert(!him.includes("sister-word"), "his page must not include the sister cue id");
assert(!him.toLowerCase().includes("say  fee"), "his html must not hard-code the cue");
console.log("html contract passed");
