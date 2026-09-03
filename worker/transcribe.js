/* The transcription route, and the only server code this app has.
 *
 * Everything else about this deploy is static assets (see wrangler.jsonc): the
 * app is React and htm off a CDN with no bundler, and the one thing a browser
 * genuinely cannot do for itself is hold an API key. So `run_worker_first`
 * hands `/api/*` to this script and lets `env.ASSETS` serve the rest untouched,
 * which is both the cheapest routing and the smallest surface, a request that
 * is not `/api/transcribe` never reaches a line of provider code.
 *
 * ── THE RULE THAT IS NOT A STYLE PREFERENCE ─────────────────────────────────
 *
 * **The expected verse is never sent to the transcriber. Not ever, not in any
 * field, not "just for the proper nouns of this passage".**
 *
 * Every biasing mechanism a speech API offers, Whisper's `initial_prompt` and
 * `prefix`, Chrome's `phrases`, Deepgram's keyterms, makes the engine more
 * likely to return the text you gave it *whether or not the member actually
 * said it*. `prefix` is the extreme case: it literally forces the decoder to
 * begin with your text. For a dictation product that is free accuracy. For a
 * product that puts a score on a recitation it is a validity bug that eats the
 * whole feature, the app would be grading the member on its own expectations,
 * and a member who skipped verse 3 would be told they said it.
 * (docs/research/asr.md, "the one thing that matters most";
 * docs/research/audio-tools-2026.md, trap #1.)
 *
 * So: this route accepts **audio and nothing else**. There is no request field
 * a client can put text into, which is deliberate, a rule enforced by the
 * absence of a parameter cannot be forgotten by a caller in a hurry. The one
 * prompt that exists is `TRANSCRIBE_VOCAB`, a **server-side** environment
 * variable holding a fixed list of *words*, proper nouns and archaic forms the
 * corpus is full of and Whisper is not (`Melchizedek`, `Zerubbabel`, `thy`,
 * `steadfast`), with no ordering and no verse in it. That is biasing toward
 * the vocabulary rather than toward the word sequence, which fixes "the engine
 * cannot spell Habakkuk" without touching "did they say the whole psalm". If
 * you are ever tempted to pass a passage through it, the answer is no; keep two
 * transcripts or keep none.
 *
 * ── ABUSE ───────────────────────────────────────────────────────────────────
 *
 * A Worker proxy with no controls in front of a paid API is not "hiding the
 * key", it is publishing the key at a URL you own with your billing attached
 * and the provider's own rate limiting removed from the path
 * (docs/research/audio-tools-2026.md §6). The controls below are the ones that
 * are free and belong in the request path. What is still missing, and is
 * follow-up work rather than an oversight:
 *
 *   - **Cloudflare Turnstile.** Gate the first request of a session, mint a
 *     short-lived signed token, check it here. Free, and usually invisible.
 *   - **Per-IP rate limiting.** A WAF rate-limiting rule on `/api/*`, or the
 *     Workers rate-limiting binding. A human cannot recite more than about two
 *     verses a minute, so the ceiling can be aggressive.
 *   - **A provider-side spend cap** on the Groq key, for the Groq path only.
 *
 * Until those exist, the caps here are what stand between a scanner and the
 * bill, which is why they are checked before anything is proxied and why a
 * malformed request gets a 4xx from this file rather than a forwarded one from
 * somebody else's. */

/* One megabyte, matching MAX_UPLOAD_BYTES in src/transcriber.js. At the bitrate
 * the client records, that is minutes of speech, a body that reaches it is not
 * a long recitation, it is somebody else. */
const MAX_BODY_BYTES = 1000000;

/* How long the whole request gets, upstream call included. A Worker that hangs
 * on a provider is a Worker holding a connection open for free. */
const UPSTREAM_TIMEOUT_MS = 25000;

const ROUTE = "/api/transcribe";
const SPEAK_ROUTE = "/api/speak";

/* Cloudflare's own neural voice, reached through the same `AI` binding the
 * default transcriber uses, so it costs no second key and nothing extra to
 * configure. It exists because the browser's `speechSynthesis` is what this
 * app used to talk with, and on most machines that is a decades-old formant
 * voice reading scripture in a monotone. In a hands-free mode whose entire
 * output is a voice, the voice is the product. */
const SPEAK_MODEL = "@cf/deepgram/aura-2-en";

/* Which of the model's voices reads. An environment variable rather than a
 * request field for the same reason the transcriber's vocabulary is: a caller
 * who can choose the model's parameters is a caller who can run up the bill in
 * a shape the route did not intend. */
const SPEAK_VOICE_DEFAULT = "asteria";

/* A passage, not an essay. The longest passage the app ships is comfortably
 * under this, and the client sends sentence-sized chunks besides, so a body
 * that reaches the cap is not a verse. */
const MAX_SPEAK_CHARS = 800;

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";
const WORKERS_AI_MODEL = "@cf/openai/whisper-large-v3-turbo";
const ASSEMBLYAI_UPLOAD_URL = "https://api.assemblyai.com/v2/upload";
const ASSEMBLYAI_TRANSCRIPT_URL = "https://api.assemblyai.com/v2/transcript";
/* Ordered fallback, first available wins. The flagship handles 18 languages
 * with native code-switching and falls back to Universal-2 for the rest. */
const ASSEMBLYAI_MODELS = ["universal-3-5-pro", "universal-2"];
/* How long to wait between polls. Short enough that a forty-second recitation
 * is not sitting in a finished state waiting to be asked, long enough that a
 * queued one does not spend the request budget on round trips. */
const ASSEMBLYAI_POLL_MS = 700;

/* A refusal says what was wrong and nothing else.
 *
 * In particular it never echoes the upstream body: provider errors sometimes
 * quote request metadata back, and the one thing worse than a 500 is a 500 with
 * somebody's account details in it. */
const fail = (status, reason) =>
  new Response(JSON.stringify({ error: reason }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const ok = (text) =>
  new Response(JSON.stringify({ text }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/* ---------------------------------------------------------------- providers */

/* Both options the research names, behind one interface, because it was
 * explicit that this should be a one-line swap: "write the Worker route so the
 * provider is a one-line swap. Same /api/transcribe contract, same body."
 *
 * Each takes the audio and returns a transcript string. Neither is handed a
 * verse; the only text either can receive is `vocab`, which came from the
 * environment and not from the request. */
export const PROVIDERS = {
  /* Cloudflare Workers AI. Slightly cheaper than Groq (~$0.031 vs $0.04 per
   * audio hour) and, the reason it is the default, **there is no secret at
   * all**. The model is a binding, so there is no key in this repo, no key in a
   * Worker secret, no key to leak from a public endpoint and no provider
   * account for a scanner to run up a bill on. For a church tool run by one
   * person that is worth more than a few hundred milliseconds of latency. The
   * practitioner testimony for Groq is genuinely better (audio-tools-2026.md
   * §2) and the two are a near-tie on price, so measure and swap if the latency
   * disappoints, that is what TRANSCRIBE_PROVIDER is for. */
  async workersai(env, bytes, mime, vocab) {
    /* ⚠️ Unverified without a deploy: the turbo model's documented input is a
     * **base64 string**, where the older `@cf/openai/whisper` takes an array of
     * byte values. If a deploy returns a shape error here, that is the line to
     * look at first. Encoded in slices because `String.fromCharCode(...bytes)`
     * on a megabyte overflows the call stack. */
    const audio = base64(bytes);
    const input = { audio };
    if (vocab) input.prompt = vocab; // vocabulary only, see the head of this file
    const out = await env.AI.run(WORKERS_AI_MODEL, input);
    return textOf(out);
  },

  /* Groq's hosted whisper-large-v3-turbo: $0.04 per audio hour, 216× realtime,
   * and a free tier of 28,800 audio-seconds a day, which at forty seconds a
   * recitation is some seven hundred a day. Needs GROQ_API_KEY as a Worker
   * secret, `wrangler secret put GROQ_API_KEY`, and that key is the whole
   * reason this is not the default. */
  async groq(env, bytes, mime, vocab) {
    /* The same trap as the AssemblyAI branch below, for the same reason. */
    if (!env.GROQ_API_KEY) throw new Error("no GROQ_API_KEY binding");
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), "recitation" + extensionFor(mime));
    form.append("model", GROQ_MODEL);
    form.append("response_format", "json");
    if (vocab) form.append("prompt", vocab); // vocabulary only, see the head of this file
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + env.GROQ_API_KEY },
      body: form,
    });
    if (!res.ok) throw new Error("upstream " + res.status);
    return textOf(await res.json());
  },

  /* AssemblyAI's pre-recorded API. Three calls where the other two take one,
   * and the audio is the reason. Their single-request sync endpoint accepts WAV
   * or raw PCM only, and this client records Opus at 16 kbps precisely so that
   * a recitation on cellular costs tens of kilobytes instead of megabytes
   * (src/transcriber.js, AUDIO_BITS_PER_SECOND). Transcoding to WAV to save a
   * round trip would multiply the upload by an order of magnitude to save a few
   * hundred milliseconds, which is the wrong trade for a phone in a car. So the
   * bytes go up as they were recorded, and the wait is paid at the other end,
   * inside the gap Speak mode already leaves after every recital.
   *
   * Needs ASSEMBLYAI_API_KEY as a Worker secret, `wrangler secret put
   * ASSEMBLYAI_API_KEY`. Their header is a bare `authorization` whose whole
   * value is the key: sending "Bearer <key>" is a 401 that reads exactly like a
   * bad key, which is an afternoon nobody needs twice.
   *
   * `keyterms_prompt` is the only field here that carries text, and it carries
   * `vocab`, the server-side word list, unordered, no verse in it, which is
   * the vocabulary biasing the head of this file permits rather than the
   * sequence biasing it forbids. These are spellings the engine lacks
   * (Melchizedek, Zerubbabel), not words we want it to hear when they were not
   * said, and a scoring app pays for over-boosting in credit a member did not
   * earn. See the body below for why `prompt` is left unset. */
  async assemblyai(env, bytes, mime, vocab) {
    /* Three calls: upload the bytes, create the job, poll it. The sync
     * endpoint would be one call and is the wrong one here, it takes WAV or
     * PCM and the client records Opus (see MAX_BODY_BYTES), so using it would
     * mean transcoding audio in a Worker to save a round trip. */
    const key = env.ASSEMBLYAI_API_KEY;
    /* Say so here rather than letting the absence travel. `TRANSCRIBE_PROVIDER`
     * names a provider outright and is honoured whether or not its key was
     * bound, which is the right precedence (an operator who names one wants
     * that one, not a silent substitution), but it means a secret bound under
     * the wrong name reaches this line as `undefined`, goes up in the
     * `authorization` header, and comes back a 401 indistinguishable from a
     * revoked key or an unpaid account. That is a day of reading the wrong
     * error table. The message below is one this file wrote, so it lands in
     * the log under the rule the catch site keeps, and it names the binding
     * rather than the symptom. */
    if (!key) throw new Error("no ASSEMBLYAI_API_KEY binding");

    const up = await fetch(ASSEMBLYAI_UPLOAD_URL, {
      method: "POST",
      headers: { authorization: key, "content-type": "application/octet-stream" },
      body: bytes,
    });
    if (!up.ok) throw new Error("upload " + up.status);
    const uploaded = await up.json();
    if (!uploaded || !uploaded.upload_url) throw new Error("upstream no-upload-url");

    /* `speech_models` is an ordered fallback list rather than parallel
     * execution: the first available model wins and produces the transcript.
     * It is optional, and that is exactly why it is set here, omitted, the API
     * applies its own older default, so the current flagship has to be asked
     * for by name. Universal-2 sits behind it as the broadly available model.
     *
     * `keyterms_prompt` is the vocabulary bias and replaces the older
     * `word_boost` / `boost_param` pair. The distinction the head of this file
     * draws survives the rename intact and is worth restating against the
     * newer API, because the newer API makes breaking it easier: there is now
     * also a `prompt` field taking free natural-language guidance about the
     * audio, and **this route deliberately never sets it**. A word list biases
     * toward the vocabulary; a prompt carrying the expected verse would bias
     * toward the sequence, and an engine leaned on to hear what the app
     * expects is an engine grading the member on the app's expectations rather
     * than on what they said. In a scoring app that is a validity bug, not a
     * tuning one. Vocabulary yes, sequence never. */
    const body = {
      audio_url: uploaded.upload_url,
      language_code: "en",
      speech_models: ASSEMBLYAI_MODELS,
    };
    const terms = wordsOf(vocab);
    if (terms.length) body.keyterms_prompt = terms;
    const created = await fetch(ASSEMBLYAI_TRANSCRIPT_URL, {
      method: "POST",
      headers: { authorization: key, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!created.ok) throw new Error("create " + created.status);
    const job = await created.json();
    if (!job || !job.id) throw new Error("upstream no-id");

    /* Poll until it settles, with no deadline of its own. The caller already
     * races every provider against UPSTREAM_TIMEOUT_MS, so a queue that never
     * drains ends the same way a hung single-shot request does; a second clock
     * here would only give the two somewhere to disagree. */
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, ASSEMBLYAI_POLL_MS));
      const res = await fetch(ASSEMBLYAI_TRANSCRIPT_URL + "/" + job.id, { headers: { authorization: key } });
      if (!res.ok) throw new Error("poll " + res.status);
      const out = await res.json();
      if (out && out.status === "completed") return textOf(out);
      if (!out || out.status === "error") throw new Error("upstream transcript-error");
    }
  },
};

/* Which provider this deploy uses. `TRANSCRIBE_PROVIDER` decides where it is
 * set; otherwise Workers AI whenever the binding exists, for the no-secret
 * reason above, and Groq only when there is a key and no binding. */
export function providerFor(env) {
  const named = String((env && env.TRANSCRIBE_PROVIDER) || "").toLowerCase();
  if (named && PROVIDERS[named]) return named;
  if (env && env.AI) return "workersai";
  if (env && env.GROQ_API_KEY) return "groq";
  if (env && env.ASSEMBLYAI_API_KEY) return "assemblyai";
  return "";
}

/* `vocab` as AssemblyAI wants it. Same words and the same environment
 * variable the other two providers read; only the envelope differs, a list
 * where Whisper takes a string. Split on whitespace and commas so a vocab
 * written either way behaves the same. */
export const wordsOf = (vocab) =>
  String(vocab || "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 1000);

/* Whisper's own envelope, from any provider; AssemblyAI's completed transcript
 * puts `text` in the same place. */
const textOf = (out) => {
  if (!out) return "";
  if (typeof out.text === "string") return out.text.trim();
  if (out.result && typeof out.result.text === "string") return out.result.text.trim();
  return "";
};

const extensionFor = (mime) => {
  if (mime.startsWith("audio/ogg")) return ".ogg";
  if (mime.startsWith("audio/mp4")) return ".mp4";
  return ".webm";
};

/* Base64 in slices. A megabyte spread across the arguments of one call is how
 * `String.fromCharCode(...bytes)` blows the stack, and it does it at the size
 * where it matters rather than in testing. */
function base64(bytes) {
  const STEP = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(binary);
}

/* ------------------------------------------------------------------- route */

async function transcribe(request, env) {
  /* Only a POST, and only of audio. Both refusals are here so that a probe,
   * and this endpoint will be probed, because it exists, costs a string
   * comparison rather than a provider call. */
  if (request.method !== "POST") return fail(405, "method");

  const mime = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!mime.startsWith("audio/")) return fail(415, "content-type");

  /* Content-Length first, because refusing before reading is the cheap half,
   * but never only Content-Length, because a client is free to lie about it or
   * omit it entirely with a chunked body. The bytes are counted below. */
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_BODY_BYTES) return fail(413, "too-large");

  let bytes;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return fail(400, "body");
  }
  if (!bytes.length) return fail(400, "empty");
  if (bytes.length > MAX_BODY_BYTES) return fail(413, "too-large");

  const provider = providerFor(env);
  if (!provider) return fail(503, "not-configured");

  /* Vocabulary from the environment, never from the request. Trimmed to
   * Whisper's 224-token ceiling by character count, generously, this is a word
   * list, not prose. */
  const vocab = String((env && env.TRANSCRIBE_VOCAB) || "").slice(0, 800);

  /* The duration cap. A provider that hangs must not hold this request open
   * indefinitely: the client has its own timeout, but a Worker that keeps
   * running after the browser gave up is time nobody is waiting for. */
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), UPSTREAM_TIMEOUT_MS));
  try {
    const text = await Promise.race([PROVIDERS[provider](env, bytes, mime, vocab), timeout]);
    return ok(text || "");
  } catch (err) {
    /* Deliberately not the upstream message in the *response*. The client
     * treats any failure as an empty recital, which Speak mode already answers
     * by reading the verse out together, so there is nothing there worth
     * leaking to say.
     *
     * The log is the other half of that, and the route was missing it: an
     * opaque 502 with nothing behind it is a route nobody can operate. Every
     * message a provider throws here is one this file wrote (`upstream 401`,
     * `upstream no-id`, `timeout`), never an upstream body, so the two rules
     * do not collide. */
    console.error("transcribe " + provider + ": " + ((err && err.message) || "unknown"));
    return fail(502, "upstream");
  }
}

/* --------------------------------------------------------------- the voice */

/* Read a line aloud, in a voice that sounds like a person.
 *
 * ⚠️ Unverified without a deploy, in the same sense as the providers above:
 * the model's input field names and its ReadableStream return are read off the
 * model reference rather than off a response. If a deploy fails here, those
 * two are the assumptions.
 *
 * The route is deliberately narrow. It takes text and returns audio, it has no
 * field for choosing a voice or an encoding, and it caps what it will read.
 * `speaker` and `encoding` are fixed here rather than accepted from the caller
 * because every one of them is a lever on somebody else's bill, and the client
 * has no reason to want a different answer than the app's own voice. */
async function speak(request, env) {
  if (request.method !== "POST") return fail(405, "method");
  if (!env || !env.AI) return fail(503, "not-configured");

  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_SPEAK_CHARS * 4) return fail(413, "too-large");

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "body");
  }
  const text = String((body && body.text) || "").trim();
  if (!text) return fail(400, "empty");
  if (text.length > MAX_SPEAK_CHARS) return fail(413, "too-large");

  const voice = String((env && env.SPEAK_VOICE) || SPEAK_VOICE_DEFAULT);
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), UPSTREAM_TIMEOUT_MS));
  try {
    const audio = await Promise.race([env.AI.run(SPEAK_MODEL, { text, speaker: voice, encoding: "mp3" }), timeout]);
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        /* The same verse is read every time it comes round, and the text is
         * the cache key by way of the URL the client builds. A day is long
         * enough to make a session of repeats free and short enough that
         * changing the voice is visible the next morning. */
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    /* The client falls back to the browser's own voice on any failure, so the
     * status is all it needs; a hands-free session must never stop because a
     * synthesizer was busy. */
    return fail(502, "upstream");
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === ROUTE) return transcribe(request, env);
    if (pathname === SPEAK_ROUTE) return speak(request, env);
    /* `run_worker_first` in wrangler.jsonc means only `/api/*` arrives here at
     * all, so this is the fallthrough for an /api path that is not a route, and
     * the static site for anything that somehow is. */
    if (pathname.startsWith("/api/")) return fail(404, "no-route");
    return env.ASSETS.fetch(request);
  },
};
