import { freqAtY, packIndexForHz, demoSeePacks } from "./live-spectrum.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(freqAtY(0, 100) > 6000, "top of the picture is the highs");
assert(freqAtY(100, 100) < 200, "bottom of the picture is the lows");
assert(packIndexForHz(8000) > packIndexForHz(1000), "log pack rises with frequency");

const { mic, aid } = demoSeePacks();
const hi = mic.slice(packIndexForHz(4000));
const land = aid.slice(packIndexForHz(900), packIndexForHz(1800) + 1);
assert(Math.max(...hi) > -40, "demo SEE lights the highs on her side");
assert(Math.max(...land) > -40, "demo SEE parks energy in the landing band");

console.log("live-spectrum tests passed");
