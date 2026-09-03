import test from "node:test";
import assert from "node:assert/strict";

import { networkSpeechSupported, sayOverNetwork } from "../src/tts.js";

/* A window with just enough of a browser in it to drive the seam: fetch, Audio,
 * URL and timers. Timers are real but the waits asserted here are zero, so
 * nothing in this file sits waiting on a clock. */
function world({ fetchImpl } = {}) {
  const played = [];
  let lastAudio = null;
  const win = {
    fetch: fetchImpl,
    URL: { createObjectURL: () => "blob:clip", revokeObjectURL: () => {} },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
    AbortController: globalThis.AbortController,
    Audio: function Audio(url) {
      played.push(url);
      lastAudio = this;
      this.duration = 1;
      this.play = () => Promise.resolve();
      this.pause = () => {};
    },
  };
  return { win, played, audio: () => lastAudio };
}

const blobOf = (size) => ({ size });
const okFetch = () => Promise.resolve({ ok: true, blob: () => Promise.resolve(blobOf(2048)) });

test("with nothing configured there is no network voice", () => {
  const { win } = world({ fetchImpl: okFetch });
  assert.equal(networkSpeechSupported("", win), false, "no endpoint");
  assert.equal(networkSpeechSupported("/api/speak", null), false, "no window");
  assert.equal(networkSpeechSupported("/api/speak", win), true);
});

test("a clip that plays to the end reports it was spoken", async () => {
  const { win, played, audio } = world({ fetchImpl: okFetch });
  const spoken = await new Promise((resolve) => {
    sayOverNetwork(win, "/api/speak", "Trust in the LORD", resolve);
    setTimeout(() => audio() && audio().onended(), 5);
  });
  assert.equal(spoken, true);
  assert.deepEqual(played, ["blob:clip"]);
});

/* The rule the whole file is shaped by: a failure is never fatal, it is the
 * caller being told to say the line some other way. */
test("a refused request settles false rather than hanging", async () => {
  const { win } = world({ fetchImpl: () => Promise.resolve({ ok: false }) });
  assert.equal(await new Promise((r) => sayOverNetwork(win, "/api/speak", "x", r)), false);
});

test("a network error settles false rather than hanging", async () => {
  const { win } = world({ fetchImpl: () => Promise.reject(new Error("offline")) });
  assert.equal(await new Promise((r) => sayOverNetwork(win, "/api/speak", "x", r)), false);
});

test("an empty body settles false rather than playing silence", async () => {
  const { win } = world({ fetchImpl: () => Promise.resolve({ ok: true, blob: () => Promise.resolve(blobOf(0)) }) });
  assert.equal(await new Promise((r) => sayOverNetwork(win, "/api/speak", "x", r)), false);
});

test("an element that errors mid-clip settles false", async () => {
  const { win, audio } = world({ fetchImpl: okFetch });
  const spoken = await new Promise((resolve) => {
    sayOverNetwork(win, "/api/speak", "x", resolve);
    setTimeout(() => audio() && audio().onerror(), 5);
  });
  assert.equal(spoken, false);
});

/* Stopping means stopping: after it, the callback never fires. This is the
 * same contract speaker.js's generation token keeps, and the reason a Stop
 * press cannot reopen a microphone for a session nobody is in. */
test("a stopped clip never calls back, however it would have ended", async () => {
  const { win, audio } = world({ fetchImpl: okFetch });
  let calls = 0;
  const stop = sayOverNetwork(win, "/api/speak", "x", () => (calls += 1));
  await new Promise((r) => setTimeout(r, 5));
  stop();
  if (audio()) {
    assert.equal(audio().onended, null, "handlers are released");
  }
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 0);
});
