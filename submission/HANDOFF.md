# Verse Mastery, AssemblyAI Voice Agent Challenge: state of play

Written 2026-09-03. Everything below is verified unless it says otherwise.

## Live

**https://verse-mastery.verse-mastery.workers.dev**

Cloudflare Workers free tier, Kentaro's own account (`kentarovadney@berkeley.edu`,
account `12278462f7fbd1f84fcd356483424960`). Worker name is `verse-mastery`,
deliberately not `verse-memory`, which is the church's app upstream.

Branch is `public-kjv`, committed but **not pushed**, in five commits:

```
ed24f5c  Correct the handoff: the 401 was ours, not AssemblyAI's
0849dec  Name the missing key instead of letting the provider guess
4e465c8  Give the app a real voice, and stop asking a stranger for their gender
5dcc2e7  Add AssemblyAI as a third transcription provider
82fad9f  Replace every em-dash, and guard against the next one
```

Which remote it is pushed to is an open question and Kentaro's: this branch sits
on the church's `verse-memory` remote, and lablab will want a repository a judge
can open.

Node 22 is required for wrangler and is not the default on this machine:

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
```

Build and deploy:

```bash
ALLOW_LOCAL_ONLY_BUILD=1 npm run build && npx wrangler deploy
```

`ALLOW_LOCAL_ONLY_BUILD=1` is required and deliberate: the public edition sets
`window.__FIREBASE_CONFIG__ = null`, and `scripts/build.mjs` refuses that
configuration unless it is stated on purpose. Without it a judge would meet a
Google sign-in gate restricted to church domains.

## The one thing blocking the submission

**The AssemblyAI key was never bound under the name the code reads.** This was
found on 2026-09-03 and it is not any of the three causes the previous version
of this file listed. Those were guesses against AssemblyAI's error table; the
fault never left this account.

`wrangler secret list` and `wrangler versions view` both say the same thing:

```
Secrets:
Secret Name:  430b0f795fbd4865ac882f536fa706bd
```

That hex string is the secret's **name**, not an id. There is no secret named
`ASSEMBLYAI_API_KEY` on this Worker, so `env.ASSEMBLYAI_API_KEY` was
`undefined`, the string `undefined` went up in the `authorization` header, and
AssemblyAI answered 401. A 401 for a key that was never sent looks exactly like
a 401 for a revoked key or an unpaid account, which is why it read as an
account problem for a day.

### Two things to do, both Kentaro's

**1. Treat that key as exposed and rotate it.** `430b0f795fbd4865ac882f536fa706bd`
is 32 lowercase hex characters, which is the shape of an AssemblyAI key. The
likely slip is `wrangler secret put <the key>`, which takes the first argument
as the name and then prompts for a value. Secret _names_ are not secret: they
show in `wrangler secret list`, in `wrangler versions view`, and on the
Cloudflare dashboard. Rotating is cheap and this is not worth being wrong
about, so rotate first and bind the new key, not that one.

**2. Bind it under the right name, and clear the wrong one.**

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
npx wrangler secret put ASSEMBLYAI_API_KEY
npx wrangler secret delete 430b0f795fbd4865ac882f536fa706bd
npx wrangler secret list
```

The last command should print one secret, named `ASSEMBLYAI_API_KEY`.

### Then the pass condition

There is no `sample.wav` in this repository and none is needed. The app can
speak its own test audio, so real speech can be produced and transcribed
without a sound ever leaving the machine. This round trip is verified working
against the live URL as of 2026-09-03, through Workers AI:

```bash
B=https://verse-mastery.verse-mastery.workers.dev
curl -s --max-time 120 -X POST -H "Content-Type: application/json" \
  -d '{"text":"The Lord is my shepherd, I shall not want."}' \
  $B/api/speak -o probe.mp3
curl -s --max-time 120 -X POST -H "Content-Type: audio/mpeg" \
  --data-binary @probe.mp3 $B/api/transcribe
```

It returns the sentence back verbatim. `/api/transcribe` admits anything whose
Content-Type starts with `audio/` (`worker/transcribe.js:329`), and AssemblyAI
accepts MP3, so the same `probe.mp3` is the input for the real test:

```bash
ALLOW_LOCAL_ONLY_BUILD=1 npm run build
npx wrangler deploy --var TRANSCRIBE_PROVIDER:assemblyai
curl -s --max-time 120 -X POST -H "Content-Type: audio/mpeg" \
  --data-binary @probe.mp3 $B/api/transcribe
```

A transcript coming back is the pass condition for the whole submission.
**Nothing goes to lablab before that.** Until then the live URL transcribes
through Workers AI (Whisper), which works and is verified, but is not what the
challenge is judging.

### The provider is already committed, which changes the order of the above

`wrangler.jsonc` now carries `"vars": { "TRANSCRIBE_PROVIDER": "assemblyai" }`.
`--var` lasts exactly one deploy, and `providerFor` prefers Workers AI whenever
the `AI` binding is present (`test/transcribe.test.mjs:31` pins this), so a
correctly bound key on its own would never have selected AssemblyAI and any
later `npx wrangler deploy` typed without the flag would have quietly returned
the submission URL to Whisper. A judge opening the URL after an unrelated deploy
would then have been judging the wrong provider, which is the whole submission.

The consequence is the thing to be careful about: **the next deploy of this
repository puts the live URL on AssemblyAI whether or not the key is bound**,
and until it is, `/api/transcribe` will answer 502 for everybody. So the secret
comes first. The `--var` on the deploy above is now redundant rather than wrong,
and either form does the same thing.

To put the live URL back on Workers AI at any point, delete the `vars` block and
deploy. That is the rollback, and it is one line.

### If it still fails

The log line now names the fault instead of describing the
symptom. `transcribe assemblyai: no ASSEMBLYAI_API_KEY binding` means the
secret still is not bound. Anything else is genuinely upstream, and only then
is the error table worth opening: an EU account must use
`api.eu.assemblyai.com`, which means changing `ASSEMBLYAI_UPLOAD_URL` and
`ASSEMBLYAI_TRANSCRIPT_URL` in `worker/transcribe.js`, and a new account with
no payment method has no balance to spend. The header format is not a
candidate: a bare `authorization` whose whole value is the key, no `Bearer`,
is what the current docs specify and what the code sends.

### Two operational notes, both learned the slow way

`wrangler tail` does **not** see traffic to a version preview URL, with or
without `--version-id`. It prints nothing at all, not even its own banner, so
it reads like a working tail on a silent Worker. Logs only arrive for the
version that is actually deployed. `wrangler versions upload` is still the
right way to try something without moving production, but read the result from
the HTTP response, not the log.

Test audio does not have to be spoken. A silent WAV built in a few lines of
Python is enough to exercise the route and the provider boundary end to end,
and Workers AI answers it with `{"text":""}`, correctly. Nothing has to be
played to anybody. See "Never make sound on this machine" below.

## What is verified working

- `/api/transcribe` returns `{"text":"the Lord is my shepherd, I shall not want,
he maketh me to lie down in green pastures."}` for a real WAV, via Workers AI.
- `/api/speak` returns real MP3 from `@cf/deepgram/aura-2-en`, 24 kHz mono.
- 405 on GET, 415 on a non-audio content type, 400 on an empty speak body.
- 1,041 unit tests, 102 browser tests, lint, format and the prose guard all pass
  as of 2026-09-03, on `0849dec`.
- Both keyed providers refuse before their first upstream call when the key is
  not bound, naming the binding. Pinned in `test/transcribe.test.mjs`.

## What is NOT verified

- **The AssemblyAI provider has still never successfully run.** The cause of
  the 401 is now known and proven (no such binding), but nothing has been
  transcribed through AssemblyAI, and no second fault behind the first can be
  ruled out until a correctly named key is bound. See above.
- **How the new voice sounds inside a live Speak session.** The route returns
  valid audio and the fallback path is byte-for-byte the old one, and all 34
  pre-existing speaker tests pass, but no one has run a hands-free session end
  to end. The thing to watch for is a line finishing and the microphone not
  reopening; that would be the `onDone` path in `src/tts.js`.
- Which of the four sampled voices is wanted. Samples were sent for
  `asteria`, `athena`, `orion`, `zeus`. The default is `asteria`
  (`SPEAK_VOICE_DEFAULT` in `worker/transcribe.js`); override per deploy with
  `--var SPEAK_VOICE:<name>`, or set `SPEAK_VOICE` in `wrangler.jsonc`.
  There are 39 voices; `@cf/deepgram/aura-2-en` on Workers AI.

## Never make sound on this machine

On 2026-09-02 something started reading text aloud on Kentaro's machine during
this work and he had to shut Claude down to stop it. **The cause was never
identified.** `say` was not running, the browser tab reported
`speechSynthesis` idle, and the tab was closed, yet it continued.

So, regardless of cause: no `say`, no `afplay`, no TTS, and never drive the app
into Speak mode or Run mode in a browser. `playwright.config.mjs` now launches
with `--mute-audio`. To test audio, synthesize a WAV in code or ask him for one.
Verify shipped behaviour by curling the deployed source, not by clicking through
a talking app.

## What changed

`82fad9f`, **the em-dash sweep and the prose guard**, 152 files. 2,151
occurrences replaced, three kept as codepoints or an en-dash because they are
functional rather than prose. `scripts/check-prose.mjs` is wired in as
`npm run lint:prose` and as a CI step so it cannot come back. The generic
`ministryGroups` default rides along, since it is the same kind of change.

`5dcc2e7`, **the AssemblyAI provider**, 3 files. The current API:
`speech_models: ["universal-3-5-pro", "universal-2"]` and `keyterms_prompt`,
replacing the legacy `word_boost` / `boost_param`. `prompt` is deliberately
never set: vocabulary biasing is permitted, sequence biasing is a validity bug
in a scoring app.

**The voice, the profile and the queue**, `4e465c8`, 19 files. `src/tts.js` and
`test/tts.test.mjs` are new; `src/speaker.js`, `src/beat.js`, `src/config.js`,
`src/App.js`, `src/profile.js`, `src/viewmodel/speak.js` and
`playwright.config.mjs` change.

Each commit passes lint, format, the prose guard, the unit tests and 102
browser tests on its own.

`0849dec`, **the missing-key guard**, 2 files. `worker/transcribe.js` and
`test/transcribe.test.mjs`. This is the commit that closes the 401.

## Submission assets

In `submission/`: `SUBMISSION.md` (the long description),
`verse-mastery-cover.png` (1920x1080), `deck.html` and `verse-mastery-deck.pdf`
(9 slides). Slide 9 is a marked placeholder for a demo screenshot and is the
only one that needs the deploy.

Judging is four criteria: Application of Technology, Presentation, Business
Value, Originality. The deck is mapped to them explicitly.

## Standing rules that bit during this work

- **No em-dashes anywhere**, including code comments. Enforced now by
  `npm run lint:prose`.
- **Never sign work as Claude.** No trailers, no bylines.
- **Never merge to prod.** Stop at the PR.
- Claude cannot create accounts or handle API keys. The AssemblyAI key and the
  Cloudflare login are Kentaro's to do.
