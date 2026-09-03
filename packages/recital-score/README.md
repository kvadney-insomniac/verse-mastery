# recital-score

Score a **spoken recitation** against text you already know, a verse, a poem, a
line of dialogue, a sentence in a language somebody is learning, and get back a
figure that means _how much of it did they actually produce, in order_.

Zero dependencies. Pure ES modules. Node 18+, and it runs in a browser unchanged.

## The problem it exists for

The obvious way to grade a recitation is to walk the expected text with a cursor
into the transcript, advance the cursor on a match, and look a few tokens ahead
when you miss. It works on clean input and it falls off a cliff on real speech.

Any run of tokens the recognizer emitted that the text did not want
desynchronizes the cursor permanently: it falls behind, every later word looks
for itself further ahead than the lookahead reaches, misses, and so fails to
advance the cursor, which guarantees the next word misses too. The failure is a
cliff at exactly the lookahead length, not a slope, and it is not tunable.

Measured in the app this was extracted from: a **word-perfect** recitation of
Proverbs 3:5–6, preceded by the three-word false start _"trust in the…"_, which
is simply what recitation sounds like, scored **14%**. The same recitation
through `scoreRecital` scores **100**, while a genuinely half-remembered one
still scores about **55**.

The fix is not a longer lookahead or a filler-word list. It is to stop comparing
and start **aligning**.

## Install

```sh
npm install recital-score
```

## Usage

```js
import { scoreRecital } from "recital-score";

const passage = { text: "The quick brown fox jumps over the lazy dog." };

// What a recognizer actually hands you: lowercase, no punctuation, and a
// false start, a filler and a self-correction in the middle of it.
const transcript = "the quick the quick brown um fox jumps over the the lazy dog";

const result = scoreRecital(passage, transcript);

result.pct; // 100, every one of the nine words credited exactly once
result.counts.ins; // 3 , the repeats absorbed; "um" never became a token at all
result.abstained; // false

// A genuinely incomplete one is not rescued:
scoreRecital(passage, "the quick brown fox jumps").pct; // 56

// And a transcript with no signal in it gets no number at all:
scoreRecital(passage, "the quick").score; // null
scoreRecital(passage, "the quick").reason; // "too-short"
```

The first argument is an **object with a `text` string**, not a bare string,
`{ text }` is the shape, and anything else on the object is ignored.

## What comes back

`scoreRecital(passage, transcript, options?)` always returns the same shape,
including when it abstains.

| field                      | type                                      | what it is                                                                                                                                                                                                        |
| -------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `score`                    | `number \| null`                          | credited reference words ÷ countable reference words, in `0…1`. **`null` when abstained**, never `0`.                                                                                                             |
| `pct`                      | `number \| null`                          | `score` rounded to a percentage, for display.                                                                                                                                                                     |
| `strictScore`, `strictPct` | `number \| null`                          | the same figures with the phonetic tier excluded. **This is the one to read for any decision with a consequence.**                                                                                                |
| `total`                    | `number`                                  | countable reference words, the denominator. Always reported, even on abstention.                                                                                                                                  |
| `credited`                 | `number`                                  | how many of them were matched at any tier.                                                                                                                                                                        |
| `heardCount`               | `number`                                  | transcript tokens after normalization, contraction expansion and the disfluency strip.                                                                                                                            |
| `abstained`                | `boolean`                                 | whether the transcript carried enough signal to say anything at all.                                                                                                                                              |
| `reason`                   | `"" \| "empty" \| "too-short" \| "flood"` | why, when it did. Compare against the exported `ABSTAIN` rather than against strings.                                                                                                                             |
| `verbose`                  | `boolean`                                 | the transcript ran more than `VERBOSE_RATIO` × the text's length. Flagged, never adjusted, it is the caller's business what to do.                                                                                |
| `diff`                     | `Entry[]`                                 | **exactly one entry per `passage.text.split(" ")` word**, in order, for any transcript at all. This invariant is what lets you index other per-word data (highlights, keyword sets, verse boundaries) against it. |
| `counts`                   | `Record<string, number>`                  | one tally per operation, `exact`, `homophone`, `edit`, `phonetic`, `sub`, `omit`, `ins`, `merge`, `split`. They sum to `ops.length`.                                                                              |
| `ops`                      | `Op[]`                                    | the raw alignment: `{ op, kind, ri, hi }`, reference index and heard index, `-1` where an operation has no counterpart.                                                                                           |

A `diff` entry is `{ word, hit, kind, heard, optional }`, `word` as the text
writes it, punctuation included; `kind` the tier or operation that settled it;
`heard` what was said instead. Insertions never appear in the `diff`, only in
`ops` and `counts`, because there is no reference word for them to attach to.

`options.sawSpeech: false` forces an `empty` abstention. It is for the one thing
the caller knows and the transcript does not: whether the recognizer ever
reported anything at all.

### Abstention: on insufficient signal, never on a low score

A full-length transcript scoring 30% is a real, honest failure and is reported as
one. A three-token transcript scoring 3% is a microphone that cut out. The two
are indistinguishable from the transcript alone, so the only question is which
way to be wrong, and the harms are not symmetric. Telling somebody who recited
well "I didn't catch that" costs them one retry; telling somebody who recited
perfectly "23%" is what makes them stop using the feature.

`score` comes back `null` rather than `0`, because a zero can be averaged,
displayed and compared, and nothing downstream should be able to treat a failed
recognition as a bad recitation.

| reason      | when                                                    | dial                                    |
| ----------- | ------------------------------------------------------- | --------------------------------------- |
| `empty`     | no tokens at all, or `sawSpeech: false`                 | ,                                       |
| `too-short` | fewer than `max(3, ceil(total × 0.3))` tokens           | `MIN_SIGNAL_RATIO`, `MIN_SIGNAL_TOKENS` |
| `flood`     | more than `total × 4 + 32` tokens, a radio, a passenger | `MAX_SIGNAL_TOKENS`                     |

The floor of three is capped by the text itself, since a two-word sentence has no
partial recitation to speak of. The flood ceiling is checked before the matrix is
sized, so it doubles as the only allocation guard the aligner needs.

## How it works: Needleman–Wunsch with asymmetric gap costs

Global alignment over two normalized word sequences. The asymmetry of the gap
costs **is** the design.

| operation                                      | cost            | why                                                                                      |
| ---------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| `sub` exact                                    | **0**           | the same word                                                                            |
| `sub` homophone (curated table)                | **0**           | the right _sound_; the recognizer picked a spelling                                      |
| `sub` within one edit                          | **0.15**        | almost certainly a transcription error, but not free, so a tie prefers the exact reading |
| `sub` phonetic (gated)                         | **0.30**        | plausible, and deliberately the most expensive match there is                            |
| `sub` mismatch                                 | **1.00**        | a different word                                                                         |
| `omit`, a reference word not produced          | **1.00**        | the thing actually being measured                                                        |
| `ins`, a heard token nothing wanted            | **0.20**        | cheap on purpose                                                                         |
| `merge`, one reference word ← two heard tokens | **0.10** + tier | `steadfast` heard as "stead fast"; a hyphenated word; one the source data fused          |
| `split`, two reference words ← one heard token | **0.10** + tier | `do not` heard as "don't"                                                                |

**Why the asymmetry.** A word the recognizer added is not evidence anybody forgot
anything. Making insertion cheap means the aligner _prefers_ to explain
unexpected tokens by absorbing them rather than by shifting the alignment or
paying full-price substitutions. Run the false start through it: three repeated
tokens absorbed cost 3 × 0.20 = **0.60**, against 3 × 1.00 = **3.00** for the
alternative of substituting them and then shifting back. The cheap path wins by a
factor of five, and it wins for a disfluency of any length. False starts,
repetitions, self-corrections, doubled words and the recognizer's own noise are
free **by construction**, no filler word-list is doing that work.

**Why insertion is not free.** A zero would make the aligner indifferent between
many equal-cost paths, which makes the traceback, and so the diff you show
somebody, arbitrary. It would remove the tie-break that keeps matched runs
contiguous, which is what makes a diff readable. And it would let a transcript
grow without bound at no cost.

**One inequality has to hold, and the test suite pins it:** `INS + OMIT > SUB`,
i.e. `1.20 > 1.00`. Both readings of a genuine one-for-one word swap cost the
same in the _score_, one uncredited reference word either way, but only the
substitution reading lets the feedback say "you said _hard_ where the text says
_heart_". It holds narrowly and on purpose; a retune must not quietly break it.

**Global, not local.** Smith–Waterman would find the best-matching _substring_,
which is precisely the wrong question: somebody who recites the first third of a
psalm beautifully and then stops must not score 100 on a well-aligned fragment.
The denominator is the whole text, so the alignment has to span the whole text.

**Not Word Error Rate.** The figure is word accuracy against a known reference,
`1 − (S + D) / N`. WER counts insertions and is therefore unbounded above; it is
the right measure for judging a _recognizer_ against an unknown utterance and the
wrong one for telling somebody how much of a passage they gave back. Keep the
alignment, discard the metric.

**Transposition costs one word, not two,** and falls out of the gap costs rather
than needing a Damerau term: `omit + match + insert` at 1.20 beats two
substitutions at 2.00.

## When two words are the same word

Four tiers, strongest first, each narrower than it looks. `wordMatch()` returns
the strongest that applies, or `null`.

1. **exact**, the same word once case and punctuation are off.
2. **homophone**, a curated, hand-audited, bidirectional table. Not a recall
   error at all: the right sound was produced and the recognizer picked a
   spelling. `no`/`know` is the argument for having a table, since both words are
   too short for any other tier to reach them. Earns credit in the strict score.
3. **edit**, within one edit, ignoring a plural ending on either side, and never
   on a word short enough for one edit to be most of it ("us" and "as" are two
   words; "Jews" and "Jew" are one word twice).
4. **phonetic**, Double Metaphone key equality, **gated to proper nouns**, and
   excluded from the strict score.

### Why the phonetic tier is gated to proper nouns

This is the part worth reading before you loosen anything.

Crediting any two words whose phonetic keys agree has an unacceptable
false-positive rate on ordinary vocabulary. Measured over the source app's own
vocabulary, key equality plus a two-edit gate admits **194 pairs** beyond what
the edit tier already catches, `love`/`life`, `holy`/`whole`,
`blessed`/`pleased`, `hand`/`want`, `still`/`steal`. Every one of those is a word
somebody could genuinely have got wrong, and crediting it is the scorer marking
its own homework. (At one edit the tier is a measured **no-op**: everything
within one edit is already caught above it. So a general phonetic tier is either
useless or dangerous.)

Names are where >1-edit transcription errors genuinely happen _and_ where there
is no competing vocabulary for a false positive to land on. When the reference
word is `Naphtali`, the speaker either has the name or does not, so
`naftali`/`Naphtali` and `pharoah`/`Pharaoh` are rescued, `life`/`love` is not.

The gate is a conjunction and every conjunct is load-bearing: five letters
minimum, within two edits, keys agree, key at least two codes long, the pair not
on `PHONETIC_BLOCK`, **and the reference word is a proper noun**. `properNouns()`
finds those by capitalization away from a sentence start, per word _type_ rather
than per position, so a name that happens to open a sentence somewhere is still
known to be a name.

`PHONETIC_BLOCK` is the residual collision surface, listed by name rather than
described by a rule. **The surface belongs to the corpus**, so if you point this
at your own text, recompute it: cross your proper nouns against your vocabulary,
assert nothing reaches the phonetic tier, and add what does.

## Two warnings

### 1. Never bias the recognizer toward the text you are grading against

Chrome's `SpeechRecognition.phrases`, Whisper's `initial_prompt`, and every other
contextual-biasing hook will happily make the recognizer hear what you expect. In
a **scoring** application that is not a tuning knob, it is a **validity bug**:
you are grading the speaker against your own expectations rather than against
what they said, and a member who mumbled something else gets the text handed back
to them as their own words. The score stops measuring recall and starts measuring
the strength of your prior.

The safe form is **re-ranking**: ask for several hypotheses
(`maxAlternatives`), score each against the expected text with this package, and
keep the best. Every reading you are choosing among is one the recognizer
produced on its own, so choosing between them cannot invent a word nobody spoke.
Same intent, no validity cost, about ten lines.

### 2. `O(n·m)` is genuinely fine, do not optimize it

Time and space are both `O(n·m)` in reference words by heard tokens, and the
temptation to reach for banded alignment or Hirschberg's linear-space variant
should be resisted. The worst case in the source app, a **243-word** passage
against a 283-token transcript, 68,769 cells, measures about **42 ms**, and the
median card is well under one. It is called after a couple of seconds of silence
have already elapsed, which makes even the worst case some sixty times faster
than the pause preceding it. Banding would buy milliseconds nobody can perceive
and cost the clarity of a textbook recurrence.

The one guard worth having is about correctness rather than speed, and it is
already here: if the transcript is absurd relative to the text, the `flood`
abstention fires **before** the matrix is allocated.

## API

```js
import {
  scoreRecital, // the whole thing
  alignWords, // Needleman–Wunsch on its own, if you want the ops without a score
  wordMatch, // the four tiers: "exact" | "homophone" | "edit" | "phonetic" | null
  transcriptTokens, // the normalization pass, on its own
  properNouns, // the phonetic tier's gate, derived from the text
  optionalRefWords, // words that are free to omit and out of the denominator
  norm, // the normalization every comparison runs through
  COST, // the scoring matrix
  MIN_SIGNAL_RATIO,
  MIN_SIGNAL_TOKENS,
  MAX_SIGNAL_TOKENS,
  VERBOSE_RATIO, // the abstention dials
  ABSTAIN, // { EMPTY, SHORT, FLOOD }
  MAX_EDITS,
  MIN_FUZZY_LEN, // the edit tier's dials
  MIN_PHONETIC_LEN,
  MAX_PHONETIC_EDITS, // the phonetic tier's dials
  HOMOPHONES,
  PHONETIC_BLOCK, // the two hand-curated tables
  doubleMetaphone,
  same,
  stem,
  withinOneEdit, // the predicates the tiers are built from
} from "recital-score";
```

Every constant is exported because every one of them is a judgement somebody made
about what a mistake is worth, and a caller scoring something other than a
recitation of scripture will want to argue with at least one. `index.js`
annotates each with what moving it does.

## Provenance

Extracted from **Verse Mastery** by Acts 2 Network - Berkeley, where it grades
hands-free recitation in a car. `src/recital.js` and `src/wordmatch.js` are kept
**byte-identical** to the app's copies, a test in that repo fails if they drift,
which is why their comments talk about verses, members and a microphone. That
is the original reasoning, kept deliberately: it is the best documentation the
algorithm has. Nothing in the API is specific to scripture.

The measurements quoted above (14%, 194 collision pairs, 42 ms on 243 words) were
taken in that app against its own corpus. They are cited as what was measured
there, not as benchmarks of this package, your corpus will differ, and the
phonetic tier's collision surface especially so.

## Licence

MIT, Copyright (c) 2026 Acts 2 Network - Berkeley. See `LICENSE`.
