/* The app's own voice, fetched rather than synthesized in the browser.
 *
 * Written like `recognizer.js` and `firebase.js`: an optional overlay over a
 * platform feature, and `networkSpeechSupported()` coming back false just means
 * the caller uses what it used before. Nothing in here decides anything; it
 * fetches a clip and plays it, and the two callers keep their own loops.
 *
 * **Why this exists at all.** Speak mode and Run mode are modes whose entire
 * output is a voice, and the voice they had was `speechSynthesis`. That API
 * hands back whatever the machine has, and what most machines have is a
 * formant synthesizer from the 1990s: `speaker.js` already has to exclude
 * thirty-five of the forty-seven English voices a Mac exposes just to avoid
 * novelty ones, and the survivors are flat. A member hears a robot reciting
 * scripture at them, which is worse than no feature, and no amount of tuning
 * rate and pitch fixes a voice that is wrong at the source. So the app asks a
 * neural model instead, over a route it already has a Worker for.
 *
 * **A failure here is never fatal, and that rule shapes the whole file.** A
 * hands-free session at the wheel cannot stop because a synthesizer was busy
 * or a tunnel ate the request, so every path out of here reports settled and
 * lets the caller fall back to the browser's own voice for that line. It falls
 * back per utterance rather than per session, deliberately: one dropped
 * request on a bad mile of road should not sentence the rest of the drive to
 * the robot.
 *
 * The two failure modes browser speech does not have are both covered here,
 * because both of them look like silence to a caller waiting on a callback: a
 * fetch that never returns, and an `<audio>` element whose `ended` never
 * fires. */

/* Long enough for the model to synthesize a verse and the clip to come down a
 * phone connection, short enough that a member is not sitting in silence
 * wondering whether the app is broken. Past this the browser voice takes the
 * line, which is late but is not nothing. */
export const SPEECH_FETCH_TIMEOUT_MS = 12000;

/* The ceiling on playback itself, over the clip's own duration once the
 * browser has told us what that is. Same argument as the watchdog in
 * `speaker.js`: an element that goes quiet without firing `ended` has ended
 * without telling anybody, and the loop has to carry on regardless. */
export const PLAYBACK_GRACE_MS = 5000;

/* Whether there is a voice to fetch and something to play it with. `endpoint`
 * is `appConfig.speakUrl`; with nothing configured this is false, which is the
 * same answer a browser with no `Audio` gives, and the same fallback either
 * way. */
export function networkSpeechSupported(endpoint, win = typeof window === "undefined" ? null : window) {
  return !!endpoint && !!win && typeof win.fetch === "function" && typeof win.Audio === "function";
}

/* Say one line in the app's voice, and call back exactly once.
 *
 * `onSettled(spoken)` is true when the line was really read aloud and false
 * when the caller should say it some other way. Returns a stop function that
 * makes everything still in flight inert, in the sense `speaker.js`'s
 * generation token means: after calling it, `onSettled` never fires. */
export function sayOverNetwork(win, endpoint, text, onSettled) {
  let settled = false;
  let stopped = false;
  let audio = null;
  let url = "";
  const timers = [];

  const arm = (fn, ms) => {
    const t = win.setTimeout(fn, ms);
    timers.push(t);
    return t;
  };

  const release = () => {
    for (const t of timers) win.clearTimeout(t);
    timers.length = 0;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.oncanplay = null;
      try {
        audio.pause();
      } catch {
        /* an element the browser already tore down */
      }
      audio = null;
    }
    /* The object URL holds the clip in memory until it is revoked, and a
     * session that wraps forever would otherwise accumulate one per verse. */
    if (url && win.URL && win.URL.revokeObjectURL) {
      try {
        win.URL.revokeObjectURL(url);
      } catch {
        /* already revoked */
      }
      url = "";
    }
  };

  const settle = (spoken) => {
    if (settled || stopped) return;
    settled = true;
    release();
    onSettled(spoken);
  };

  const ctl = typeof win.AbortController === "function" ? new win.AbortController() : null;
  arm(() => {
    if (ctl) ctl.abort();
    settle(false);
  }, SPEECH_FETCH_TIMEOUT_MS);

  win
    .fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: ctl ? ctl.signal : undefined,
    })
    .then((res) => (res && res.ok ? res.blob() : null))
    .then((blob) => {
      if (stopped || settled) return;
      if (!blob || !blob.size) return settle(false);
      url = win.URL.createObjectURL(blob);
      audio = new win.Audio(url);
      audio.onended = () => settle(true);
      audio.onerror = () => settle(false);
      /* The playback ceiling is armed once the browser knows the duration,
       * because before that there is no figure to be generous about. */
      audio.oncanplay = () => {
        const ms = Number(audio && audio.duration) * 1000;
        arm(() => settle(true), (Number.isFinite(ms) && ms > 0 ? ms : SPEECH_FETCH_TIMEOUT_MS) + PLAYBACK_GRACE_MS);
      };
      const started = audio.play();
      /* Autoplay refusal rejects rather than throwing. It should not happen,
       * since every session starts on a user gesture, but a refused clip that
       * reported nothing would hang the loop. */
      if (started && typeof started.catch === "function") started.catch(() => settle(false));
    })
    .catch(() => settle(false));

  return () => {
    stopped = true;
    if (ctl) {
      try {
        ctl.abort();
      } catch {
        /* already aborted */
      }
    }
    release();
  };
}
