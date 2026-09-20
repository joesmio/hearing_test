import { listenerPrompt, resultCopy } from "./protocol.js";

const CHANNEL = "fee-see-sync";
const STORE = "fee-see-state";

export function toListenerSnapshot(model) {
  const view = model.view;
  const step = model.step;
  let himView = view;
  if (view === "trial") {
    himView = step === "listen" ? "listen" : "wait";
  }
  let phase = view;
  if (view === "trial") phase = step === "listen" ? "listen" : "turnaway";
  if (view === "cal" && model.cal && model.cal.phase === "comfort") phase = "cal-comfort";
  const snap = {
    himView,
    prompt: listenerPrompt(phase),
    answersOn: view === "trial" && step === "listen",
    earOn: view === "ear",
    calOn: view === "cal",
    calComfort: Boolean(model.cal && model.cal.phase === "comfort"),
    practiceWord: view === "practice" ? model.practiceWord : null,
    blockLabel:
      view === "trial"
        ? model.block === "dry"
          ? "Her voice as it is"
          : "Computer trick on"
        : view === "ear"
          ? "Beeps through these headphones"
          : view === "cal"
            ? "Hiss loudness"
            : "",
    progress: model.progress || { n: 0, i: 0 },
    results: view === "results" ? resultCopy(model.score) : null,
    hissOn: Boolean(model.hissOn),
    live: Boolean(model.live),
    seq: model.seq || 0,
  };
  return snap;
}

export function listenerSnapshotIsSafe(snap) {
  if (!snap) return false;
  if (snap.targetWord || snap.sisterPrompt || snap.word) return false;
  if (snap.himView === "listen" || snap.himView === "wait") {
    if (snap.practiceWord) return false;
    const blob = JSON.stringify(snap);
    if (/Say\s+F/i.test(blob) || /Say\s+S/i.test(blob)) return false;
  }
  return true;
}

export function createSync({ role, onListener, onAnswer }) {
  const bus = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
  let poll = null;

  function publish(full) {
    const listener = toListenerSnapshot(full);
    const envelope = { listener, seq: full.seq || Date.now() };
    try {
      localStorage.setItem(STORE, JSON.stringify(envelope));
    } catch {
      /* private mode */
    }
    if (bus) bus.postMessage({ type: "state", ...envelope });
    fetch("/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
    }).catch(() => {});
  }

  function sendAnswer(word) {
    const msg = { type: "answer", word, at: Date.now() };
    if (bus) bus.postMessage(msg);
    fetch("/sync/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    }).catch(() => {});
  }

  if (bus) {
    bus.onmessage = (e) => {
      const data = e.data || {};
      if (data.type === "state" && data.listener && onListener) onListener(data.listener);
      if (data.type === "answer" && data.word && onAnswer) onAnswer(data.word);
    };
  }

  window.addEventListener("storage", (e) => {
    if (e.key !== STORE || !e.newValue || !onListener) return;
    try {
      const env = JSON.parse(e.newValue);
      if (env.listener) onListener(env.listener);
    } catch {
      /* ignore */
    }
  });

  if (role === "him" && onListener) {
    poll = setInterval(async () => {
      try {
        const res = await fetch("/sync");
        const env = await res.json();
        if (env.listener) onListener(env.listener);
      } catch {
        /* offline file:// */
      }
    }, 250);
  }

  if (role === "sister" && onAnswer) {
    poll = setInterval(async () => {
      try {
        const res = await fetch("/sync?takeAnswers=1");
        const env = await res.json();
        for (const word of env.answers || []) onAnswer(word);
      } catch {
        /* ignore */
      }
    }, 250);
  }

  return {
    publish,
    sendAnswer,
    close() {
      if (poll) clearInterval(poll);
      if (bus) bus.close();
    },
  };
}
