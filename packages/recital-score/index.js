/* recital-score, the public surface.
 *
 * Everything below is re-exported from `src/`, which is a verbatim extraction
 * from the app this was written for (see README, and the LICENSE's attribution).
 * That is why the comments in those files talk about verses, members and a
 * microphone: they are the original reasoning, kept because it is the best
 * documentation the algorithm has, and kept *byte-identical* so that the app and
 * this package cannot quietly drift apart. Nothing about the API is specific to
 * that app, a "passage" is any text you know in advance and expect somebody to
 * produce from memory, and a "transcript" is whatever a recognizer heard.
 *
 * The tuning constants are exported rather than hidden because they are the
 * whole of the design: every one of them is a judgement somebody made about what
 * a mistake is worth, and a caller scoring something other than scripture recital
 *, a language drill, a reading tutor, a voice-agent eval, will want to argue
 * with at least one of them. Each is annotated with what moving it does.
 */

export {
  /* The whole thing: `scoreRecital({ text }, transcript, options?)` aligns the
   * transcript against the expected text and reports how much of it came back.
   * The first argument is an object with a `text` string, not a bare string. */
  scoreRecital,
  /* Needleman–Wunsch on its own, over `(refWords, heardTokens, options?)`.
   * Reach for it when you want the operation list without a score on top, a
   * custom metric, a diff view, or a test of the recurrence itself. */
  alignWords,
  /* The transcript as the aligner wants it: normalized tokens, contractions
   * expanded, numerals spelled out, disfluencies dropped. Call it yourself if
   * you need to know how many tokens a transcript is really worth. */
  transcriptTokens,
  /* Which word types in a text are proper nouns, by capitalization away from a
   * sentence start. This is the gate on the phonetic tier, and nothing else
   * reads it. Pass your own set to `alignWords` if your text does not carry the
   * signal, a language whose nouns are all capitalized, say. */
  properNouns,
  /* Reference words that belong to an embedded citation and so are words nobody
   * recites: free to omit, and out of the denominator. Domain-specific and
   * narrow, exported because a corpus with the same fetch-time leak in it will
   * want the same tolerance. */
  optionalRefWords,
  /* The scoring matrix, and the reason the thing works. Raise `INS` and
   * disfluencies stop being free; lower `OMIT` and a forgotten clause stops
   * costing what it should. `INS + OMIT > SUB` must keep holding, see the
   * README's cost table and the test that pins it. */
  COST,
  /* Below this fraction of the expected length, a transcript is not scored at
   * all. Raise it to abstain more readily on a bad microphone, lower it to
   * insist on a number from a fragment. */
  MIN_SIGNAL_RATIO,
  /* The absolute floor under that ratio, so a single stray token cannot score a
   * two-word text. Capped by the text's own length. */
  MIN_SIGNAL_TOKENS,
  /* `(n) => n * 4 + 32`: past this many tokens the transcript is a radio, a
   * passenger, or the app's own voice, and nothing is aligned. It is also the
   * only allocation guard the O(n·m) matrix needs. */
  MAX_SIGNAL_TOKENS,
  /* A transcript this much longer than the text is flagged `verbose` rather
   * than adjusted, it is the caller's business to decide that a recitation
   * carrying half again as many tokens as the text has words is not evidence. */
  VERBOSE_RATIO,
  /* The three reasons a result can carry instead of a score: `empty`,
   * `too-short`, `flood`. Compare against these rather than against strings. */
  ABSTAIN,
} from "./src/recital.js";

export {
  /* When two words are the same word: returns the strongest tier that applies
   * ("exact" | "homophone" | "edit" | "phonetic") or null. The aligner asks this
   * O(n·m) times per recital, and it is the only loose comparison here. */
  wordMatch,
  /* The curated, bidirectional homophone table. Add a pair when a recognizer in
   * your domain reliably picks the other spelling; every entry should be one a
   * human confirmed, since this tier earns full credit including in the strict
   * score. */
  HOMOPHONES,
  /* The phonetic tier's known false-positive surface, refused in both
   * directions. Recompute it over your own corpus, the surface belongs to the
   * vocabulary, so changing the corpus grows it. */
  PHONETIC_BLOCK,
  /* The edit tier's two dials: how far apart two spellings may be (1), and the
   * shortest word that may be forgiven at all (3, because one edit is most of a
   * two-letter word). Widen either and near neighbours start being credited. */
  MAX_EDITS,
  MIN_FUZZY_LEN,
  /* The phonetic tier's gate: five letters, two edits. At one edit the tier is
   * a measured no-op, and below five letters a key is a claim about almost
   * nothing. */
  MIN_PHONETIC_LEN,
  MAX_PHONETIC_EDITS,
  /* The predicates the edit tier is built from, exported so a caller can reuse
   * exactly the app's notion of "the same word said out loud" elsewhere,
   * fitting heard words back onto expected text, say. */
  same,
  stem,
  withinOneEdit,
  /* The Double Metaphone port itself, keys untruncated. Useful on its own, and
   * the thing to pin in your own tests if you retune the phonetic tier. */
  doubleMetaphone,
} from "./src/wordmatch.js";

/* The normalization every comparison here runs through: lowercase, letters and
 * digits only. Exported so a caller tokenizing its own text cannot come to
 * disagree with the scorer about what a word is. */
export { norm } from "./src/text.js";
