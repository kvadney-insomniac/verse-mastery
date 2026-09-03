# AssemblyAI Voice Agent Challenge: submission copy

Draft 2026-09-01, revised against lablab's four criteria: Application of
Technology, Presentation, Business Value, Originality.

**DO NOT SUBMIT UNTIL THE DEPLOY IS LIVE.** The copy below states the
AssemblyAI integration as working. The code is written, linted and unit tested,
but the three API envelopes have never run against the real service. A demo that
fails on a judge's first try loses Application of Technology no matter how the
prose reads.

---

## Project title

Verse Mastery: the voice agent that scores what you said, not what it hoped

## Short description

Recite a verse perfectly, but restart after three words, the way people
actually speak. A naive scorer gives that 14%. Ours gives it 100%, and still
fails a genuinely incomplete recitation at 50%. A hands-free voice agent for
memorizing scripture, and an open scorer for anyone who needs to grade speech
honestly.

## Long description

**The moment this is built around.** Recite a passage word-perfectly, but with a
three-word false start at the front. Our first scorer gave that 14%, because it
walked transcript and text in step, desynchronized on word one, and never
recovered. False starts are the single most common thing a person does when
reciting from memory. The scorer was measuring the wrong thing.

Sequence alignment with asymmetric gap costs fixed it. Omissions expensive,
insertions nearly free. Same recitation, 100%. A genuinely incomplete one still
fails at around 50%. Disfluencies become free by construction instead of by
maintaining a filler-word list that is wrong in a new language the day you ship.

**What it is.** A hands-free voice agent for memorizing scripture. It speaks a
reference, listens while you recite, scores you, tells you how you did, and
moves on, with no screen interaction at all. Built for the car and the running
trail. Verse Mastery was originally written for Acts 2 Network Berkeley and much
of the application code is theirs, used under MIT; this edition swaps the
licensed translation for a public-domain one. My contribution, and what this
submission is about, is the scorer, the record-then-transcribe architecture, and
the AssemblyAI integration.

**Why this is worth money outside a church.** "Did they say the thing" is a
different question from "what did they say," and no ASR API answers it. Every
language-learning app, reading tutor, pronunciation trainer and voice-agent eval
harness has to answer it, and every one of them writes the same brittle
string-comparison we started with. So the scorer ships as a standalone MIT
package, `recital-score`, with Verse Mastery as its reference implementation
rather than the product. Duolingo-style speaking exercises, K-12 reading
fluency assessment, medical and legal dictation verification, and regression
testing for voice agents are all the same problem with different corpora.

**Using AssemblyAI correctly, not partially.** A scoring app has to use a speech
API differently from a dictation app, and the difference is the whole design.
`word_boost` toward a vocabulary is right: we pass a server-side list of proper
nouns and archaic forms the engine lacks, Melchizedek, Zerubbabel, thy,
steadfast, with `boost_param` set to `low`. That fixes "the engine cannot spell
Habakkuk." Biasing toward the expected sequence is wrong: it makes the engine
return the text you gave it whether or not the speaker said it, so someone who
skipped verse 3 would be told they said it. The route therefore accepts audio
and has no field a verse could be put into, because a rule enforced by a missing
parameter cannot be forgotten by a caller in a hurry.

**Why AssemblyAI at all.** The Web Speech API failed three ways nothing tunes
around: Chrome ends a `continuous` session silently near 60 seconds, exactly
where a long passage sits; on Chrome for Android `continuous` is a documented
no-op, and the car is a phone; restarts get rate limited permanently. Recording
once and transcribing once clears all three. We use the pre-recorded API rather
than the sync endpoint because sync takes WAV or PCM, and the client records
Opus at 16 kbps so a 40-second recitation costs about 80 KB instead of
megabytes.

**Engineering.** Static files, no bundler, one Cloudflare Worker with two
routes. Provider is a one-line swap behind `/api/transcribe`. The agent's own
voice is `/api/speak`, Deepgram Aura 2 on the same binding, because the
browser's `speechSynthesis` is a 1990s formant voice and in a mode whose only
output is a voice, the voice is the product. It falls back to the browser per
line, so a dropped request costs a sentence rather than the drive. 1,040 unit
tests.

## Links

- Repository: https://github.com/kvadney-insomniac/verse-mastery
- Scorer: `npm i recital-score`
- Demo: PENDING DEPLOY

## Still needed

1. `wrangler secret put ASSEMBLYAI_API_KEY`, set `TRANSCRIBE_PROVIDER=assemblyai`,
   `npm run deploy`. Verify a real recitation transcribes before anything else.
2. Record the MP4.
3. Deck to PDF, after the deploy works.

### Video shot list, about 2 minutes

1. Ten seconds to camera: what it is, who it is for.
2. The loop running hands-free. Never touch the screen.
3. **The entry.** Recite with a deliberate three-word false start. Show 100%.
   Say what the naive scorer gave the same recitation: 14%. This beat is the
   submission; everything else is context.
4. Twenty seconds: show the route has no field for the verse, and say why a
   scoring app cannot use sequence biasing the way a dictation app can.
5. Ten seconds: `recital-score` on npm. Stop.
