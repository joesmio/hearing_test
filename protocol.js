import { SIBILANT_PLAN } from "./lowering.js";

export const WORDS = ["fee", "see"];
export { SIBILANT_PLAN };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function balancedWords(count, rand) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(i % 2 === 0 ? "fee" : "see");
  return shuffle(out, rand);
}

/** Live sister-speech session. No canned audio. */
export function buildLiveSession(seed = 1, perBlock = 6) {
  const rand = mulberry32(seed);
  const dry = balancedWords(perBlock, rand).map((word) => ({
    word,
    condition: "dry",
    live: true,
  }));
  const dsp = balancedWords(perBlock, rand).map((word) => ({
    word,
    condition: "dsp",
    live: true,
  }));
  return { dry, dsp, perBlock, seed };
}

export function emptyScore() {
  return {
    dry: { n: 0, correct: 0 },
    dsp: { n: 0, correct: 0 },
  };
}

export function markAnswer(score, condition, word, answer) {
  const bucket = condition === "dsp" ? score.dsp : score.dry;
  bucket.n += 1;
  if (answer === word) bucket.correct += 1;
  return score;
}

export function pct(bucket) {
  if (!bucket.n) return null;
  return bucket.correct / bucket.n;
}

export function resultCopy(score) {
  const dryP = pct(score.dry);
  const dspP = pct(score.dsp);
  const dryPct = dryP == null ? "—" : `${Math.round(dryP * 100)}%`;
  const dspPct = dspP == null ? "—" : `${Math.round(dspP * 100)}%`;
  const dryFrac = `${score.dry.correct} / ${score.dry.n}`;
  const dspFrac = `${score.dsp.correct} / ${score.dsp.n}`;
  let headline = "The computer moved the thin letters down.";
  let body =
    "She said fee and see live. F and S are high hisses. Without the trick they often vanish. With the trick, that hiss is copied into a lower band.";
  if (dryP != null && dspP != null && dspP > dryP + 0.08) {
    headline = "With the computer, her fee and see came apart.";
    body = `Her live voice, no trick: ${dryFrac} (${dryPct}). After the hiss was moved down: ${dspFrac} (${dspPct}).`;
  } else if (dryP != null && dspP != null && Math.abs(dspP - dryP) <= 0.08) {
    headline = "Those two scores were close.";
    body = `No trick: ${dryFrac}. With the trick: ${dspFrac}. If a normal ear took this test, both should be easy. For him, the first number is the one that usually drops.`;
  } else if (dryP != null && dspP != null && dspP < dryP) {
    headline = "The trick did not help this time.";
    body = `No trick: ${dryFrac}. With the trick: ${dspFrac}. Sit her closer to the lid mic and try again. A hearing aid may still do this more kindly.`;
  }
  return { headline, body, dryFrac, dspFrac, dryPct, dspPct };
}

/** Text allowed on the listener face. Must never name the trial word. */
export function listenerPrompt(phase) {
  if (phase === "welcome") return "She will talk. You tap the word.";
  if (phase === "practice") return "She will say the word on the screen. Listen for the hiss.";
  if (phase === "turnaway") return "Look at the person next to you for a moment.";
  if (phase === "listen") return "What did she say?";
  if (phase === "results") return "How you did with her voice.";
  return "Headphones on.";
}

export function sisterPrompt(word) {
  return word === "fee" ? "Say  FEE" : "Say  SEE";
}

export function workletForCondition(condition) {
  if (condition === "dsp" || condition === "practice") {
    return { mode: "transpose", listen: "aid", ...SIBILANT_PLAN };
  }
  return { mode: "original", listen: "aid", ...SIBILANT_PLAN };
}

export const PHASES = ["welcome", "practice", "dry", "dsp", "results"];

export function createModel(perBlock = 6, seed = 1) {
  return {
    view: "trial",
    step: "say",
    block: "dry",
    index: 0,
    session: buildLiveSession(seed, perBlock),
    score: emptyScore(),
    practiceWord: null,
    live: true,
    hissOn: false,
    seq: 1,
  };
}

export function currentTrial(model) {
  if (!model.session || model.view !== "trial") return null;
  return model.session[model.block][model.index] || null;
}

/** Pure step: sister confirmed she spoke. */
export function unlockButtons(model) {
  if (model.view !== "trial" || model.step !== "say" || !currentTrial(model)) return model;
  return { ...model, step: "listen", seq: model.seq + 1 };
}

/** Pure step: he tapped fee or see. */
export function applyAnswer(model, answer) {
  if (model.view !== "trial" || model.step !== "listen") return model;
  const t = currentTrial(model);
  if (!t) return model;
  const score = {
    dry: { ...model.score.dry },
    dsp: { ...model.score.dsp },
  };
  markAnswer(score, t.condition, t.word, answer);
  let block = model.block;
  let index = model.index + 1;
  let view = "trial";
  let step = "say";
  if (!model.session[block][index]) {
    if (block === "dry") {
      block = "dsp";
      index = 0;
    } else {
      view = "results";
      step = "done";
    }
  }
  return {
    ...model,
    score,
    block,
    index,
    view,
    step,
    practiceWord: null,
    seq: model.seq + 1,
  };
}
