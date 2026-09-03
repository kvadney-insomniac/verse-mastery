import test from "node:test";
import assert from "node:assert/strict";

import {
  ABSTAIN,
  COST,
  MAX_SIGNAL_TOKENS,
  MIN_SIGNAL_RATIO,
  VERBOSE_RATIO,
  alignWords,
  norm,
  properNouns,
  scoreRecital,
  transcriptTokens,
  wordMatch,
} from "../index.js";

/* The fixtures are two short public-domain passages (KJV, Psalm 23:1-4 and the
 * close of Isaiah 9:1) and a couple of invented sentences. The source app's own
 * suite runs these properties over its whole shipped corpus, which is the right
 * test to have there and the wrong thing to ship here: a scoring package that
 * carried somebody's data files would be shipping a licence problem and a
 * hundred kilobytes nobody installed it for. Everything asserted below is a
 * property of the alignment rather than of the wording it aligned, which is why
 * a handful of sentences is enough to hold it.
 *
 * `spoken()` is what a recognizer actually emits: a flat lowercase stream with
 * no punctuation at all. */
const SHEPHERD = {
  text:
    "The LORD is my shepherd; I shall not want. He maketh me to lie down in green pastures: " +
    "he leadeth me beside the still waters. He restoreth my soul: he leadeth me in the paths " +
    "of righteousness for his name's sake. Yea, though I walk through the valley of the shadow " +
    "of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.",
};

/* Carries four proper nouns capitalized away from a sentence start, which is
 * what the phonetic tier's gate is looking for. */
const NAMES = {
  text: "The land of Zebulun and the land of Naphtali, by the way of the sea, beyond Jordan, in Galilee of the nations.",
};

/* Two words, so the abstention floor has something to be capped by. */
const SHORT = { text: "Water freezes." };

const spoken = (passage) => passage.text.split(" ").map(norm).filter(Boolean).join(" ");
const heard = (passage) => spoken(passage).split(" ");
const length = (passage) => passage.text.split(" ").length;

/* The bar the source app commits a passage at, written here as the figure the
 * fixtures are aimed at: forgiving enough that one dropped article does not deny
 * somebody a passage they plainly know. */
const COMMIT = 0.95;

/* Words nothing in either passage will credit, checked rather than assumed. */
const NONSENSE = ["trombone", "penguin", "zucchini", "asteroid", "bicycle"];

/* Substituting a map of said-instead words into the transcript, asserting that
 * every one of them applied, a mangle that silently failed to apply is a
 * fixture that passes while testing air. */
const misspeak = (passage, swaps) => {
  const words = heard(passage);
  for (const key of Object.keys(swaps)) assert.ok(words.includes(key), `the fixture does not say "${key}"`);
  return words.map((word) => swaps[word] ?? word).join(" ");
};

/* ── the cost matrix's one invariant ──────────────────────────────────────── */

/* One line, and it is the line that stops a retune from silently turning every
 * substitution into a delete-plus-insert. Both readings cost the same in the
 * score, one uncredited reference word either way, but only the substitution
 * reading lets the feedback say "you said *hard* where the text says *heart*",
 * which is the feedback worth giving. It holds narrowly and deliberately. */
test("★ INS + OMIT > SUB, so a one-for-one swap is reported as a substitution", () => {
  assert.ok(COST.INS + COST.OMIT > COST.SUB, `${COST.INS} + ${COST.OMIT} must exceed ${COST.SUB}`);

  const graded = scoreRecital(SHEPHERD, misspeak(SHEPHERD, { shepherd: "trombone" }));
  assert.equal(graded.counts.sub, 1, "reported as one substitution");
  assert.equal(graded.counts.omit, 0, "not as an omission");
  assert.equal(graded.counts.ins, 0, "plus an insertion");
  const entry = graded.diff.find((d) => norm(d.word) === "shepherd");
  assert.equal(entry.kind, "sub");
  assert.equal(entry.hit, false);
  assert.equal(entry.heard, "trombone", "and the diff can name what was said instead");
});

test("the graded tiers are priced apart, so a tie prefers the exact reading", () => {
  assert.equal(COST.EXACT, 0);
  assert.equal(COST.HOMOPHONE, 0, "the speaker said the right sound; nothing was got wrong");
  assert.ok(COST.EDIT > COST.EXACT && COST.PHONETIC > COST.EDIT, "and the phonetic tier is the dearest match");
  assert.ok(COST.PHONETIC < COST.SUB, "but still cheaper than calling it a different word");
});

/* ── what the aligner is for ──────────────────────────────────────────────── */

test("a word-perfect recitation scores exactly 1.00", () => {
  const graded = scoreRecital(SHEPHERD, spoken(SHEPHERD));
  assert.equal(graded.score, 1);
  assert.equal(graded.strictScore, 1);
  assert.equal(graded.pct, 100);
  assert.equal(graded.abstained, false);
  assert.equal(graded.verbose, false);
  assert.equal(graded.credited, graded.total);
});

test("★ a three-word false start no longer stalls the grader", () => {
  /* The regression the whole module exists for: somebody runs at the text,
   * stops, and starts again. A positional grader whose cursor only advances on a
   * match desynchronizes permanently here and scores a word-perfect recitation
   * at 14% (measured in the source app). The gap asymmetry absorbs the three
   * repeated tokens for 3 × 0.20 against 3 × 1.00 to substitute them and shift
   * back, so the cheap path wins by a factor of five. */
  const opening = heard(SHEPHERD).slice(0, 3).join(" ");
  const graded = scoreRecital(SHEPHERD, `${opening} ${spoken(SHEPHERD)}`);
  assert.equal(graded.score, 1, `scored ${graded.pct}%`);
  assert.ok(graded.score >= COMMIT, "and clears the commit bar");
  assert.equal(graded.counts.ins, 3, "the false start is absorbed as three insertions");
  assert.equal(graded.credited, graded.total, "each reference word is credited exactly once");
  assert.equal(graded.ops.filter((o) => o.op === "ins").length, 3);
  assert.equal(graded.diff.length, length(SHEPHERD), "insertions never appear in the diff");
});

test("★ a self-correction is one production, credited once and penalized never", () => {
  /* A word the text does not want, heard by the speaker themselves, and a run
   * at the clause again from three words back. Everything in that repair is a
   * token the text never asked for, so every one of them should be absorbed and
   * every reference word credited once. */
  const words = heard(SHEPHERD);
  const at = Math.floor(words.length / 3);
  const repair = [...words.slice(0, at), "trombone", "penguin", ...words.slice(at - 3)];

  const graded = scoreRecital(SHEPHERD, repair.join(" "));
  assert.equal(graded.score, 1);
  assert.equal(graded.counts.ins, repair.length - words.length, "every repeated and every wrong word absorbed");
  assert.equal(graded.counts.omit + graded.counts.sub, 0, "and nothing charged for the repair");
});

test("a leading filler is free, and it is the gap costs doing it, not the word list", () => {
  const graded = scoreRecital(SHEPHERD, `um uh ${spoken(SHEPHERD)}`);
  assert.equal(graded.score, 1);
  assert.equal(graded.heardCount, heard(SHEPHERD).length, "the disfluency is not even a token");

  /* The list only stops "um" accidentally *matching*. A filler it has never
   * heard of is still free, because absorbing an unwanted token is cheap. */
  const unlisted = scoreRecital(SHEPHERD, `like y'know basically ${spoken(SHEPHERD)}`);
  assert.equal(unlisted.score, 1, "no filler word-list is doing this work");
  assert.ok(unlisted.counts.ins > 0, "they were absorbed as insertions instead");
});

test("★ a genuinely half-remembered recitation lands near half, not near the bar", () => {
  const words = heard(SHEPHERD);
  const graded = scoreRecital(SHEPHERD, words.slice(0, Math.ceil(words.length / 2)).join(" "));
  assert.ok(graded.score > 0.45 && graded.score < 0.6, `scored ${graded.pct}%, forgiveness is not amnesty`);
  assert.ok(graded.score < COMMIT);
});

test("★ a forgotten clause costs exactly the words that were forgotten", () => {
  const clause = "through the valley of the shadow of death";
  const transcript = spoken(SHEPHERD).replace(`${clause} `, "");
  assert.notEqual(transcript, spoken(SHEPHERD), "the clause really came out");

  const missing = clause.split(" ").length;
  const graded = scoreRecital(SHEPHERD, transcript);
  assert.equal(graded.counts.omit, missing);
  assert.equal(graded.score, (graded.total - missing) / graded.total, `${missing} of ${graded.total} words gone`);
  assert.ok(graded.score < COMMIT, "the whole point: forgiveness has a floor");
});

test("★ the negative control, wrong words stay wrong", () => {
  /* Enough words said wrong that the commit bar's 5% margin cannot cover them,
   * and said as words nothing in the text will credit, the phonetic tier
   * included, since none of these are proper nouns. */
  const targets = ["shepherd", "pastures", "waters", "righteousness"];
  const swaps = Object.fromEntries(targets.map((word, i) => [word, NONSENSE[i]]));
  for (const [word, said] of Object.entries(swaps)) {
    assert.equal(wordMatch(said, word, { proper: true }), null, `${said}/${word} must not be creditable at all`);
  }

  const graded = scoreRecital(SHEPHERD, misspeak(SHEPHERD, swaps));
  assert.equal(graded.counts.sub, targets.length, `scored ${graded.pct}%`);
  assert.equal(graded.score, (graded.total - targets.length) / graded.total, "exactly the words not recalled");
  assert.ok(graded.score < COMMIT, "and does not clear the commit bar");
  assert.equal(graded.strictScore, graded.score, "no phonetic credit was involved either way");
});

test("a single dropped word still clears the bar", () => {
  const graded = scoreRecital(
    SHEPHERD,
    heard(SHEPHERD)
      .filter((word) => word !== "yea")
      .join(" "),
  );
  assert.equal(graded.counts.omit, 1, `scored ${graded.pct}%`);
  assert.equal(graded.score, (graded.total - 1) / graded.total);
  assert.ok(graded.score >= COMMIT, "which is what a 5% margin is for");
});

test("an adjacent transposition costs one word, not two", () => {
  /* No Damerau term and none needed: the aligner prefers omit + match + insert
   * at 1.20 over two substitutions at 2.00, so the swap costs one word. */
  const words = heard(SHEPHERD);
  const at = words.indexOf("rod");
  assert.ok(at > 0 && words[at + 1] === "and");
  const graded = scoreRecital(
    SHEPHERD,
    [...words.slice(0, at), words[at + 1], words[at], ...words.slice(at + 2)].join(" "),
  );
  assert.equal(graded.counts.sub + graded.counts.omit, 1, "one word, not two");
  assert.equal(graded.score, (graded.total - 1) / graded.total, `scored ${graded.pct}%`);
  assert.ok(graded.score >= COMMIT, "the gap asymmetry gets this for free");
});

test("a curated homophone is credited, and credited strictly", () => {
  const graded = scoreRecital(SHEPHERD, misspeak(SHEPHERD, { no: "know" }));
  assert.equal(graded.score, 1);
  assert.equal(graded.strictScore, 1, "nothing was got wrong: the right sound, the recognizer's spelling");
  assert.equal(graded.counts.homophone, 1);
});

/* ── the proper-noun gate on the phonetic tier ────────────────────────────── */

test("★ the phonetic tier is reachable only when the reference word is a name", () => {
  /* Ungated, key equality at two edits credits `love` for `life`, 194 such
   * pairs, measured over the source app's vocabulary. Gated to proper nouns
   * there is no near neighbour for a false positive to land on: the speaker
   * either has the name or does not. */
  const words = ["of", "Naphtali,"];
  const tokens = ["of", "naftali"];
  assert.ok(alignWords(words, tokens, { proper: new Set([1]) }).cost < COST.SUB, "gated open for a name");
  assert.equal(alignWords(words, tokens).cost, COST.SUB, "ungated, it is simply a different word");
});

test("★ the strict figure fences the phonetic tier off", () => {
  const graded = scoreRecital(NAMES, misspeak(NAMES, { naphtali: "naftali" }));
  assert.equal(graded.score, 1, "the friendly figure credits it");
  assert.equal(graded.counts.phonetic, 1);
  assert.equal(graded.strictScore, (graded.total - 1) / graded.total, "the strict one does not, and by exactly that");
  assert.ok(graded.strictScore < graded.score, "which is the only figure a gate with a consequence should read");
});

test("proper nouns are the words capitalized away from a sentence start", () => {
  const found = properNouns("Trust in the Lord with all your heart. In all your ways acknowledge him.");
  assert.ok(found.has("lord"));
  assert.ok(!found.has("trust"), "capitalized only because it opens the passage");
  assert.ok(!found.has("in"), "nor because it opens the second sentence");
  assert.deepEqual([...properNouns(NAMES.text)].sort(), ["galilee", "jordan", "naphtali", "zebulun"]);
});

/* ── abstention ───────────────────────────────────────────────────────────── */

test("★ a transcript that cut out abstains rather than asserting a number", () => {
  const graded = scoreRecital(SHEPHERD, heard(SHEPHERD).slice(0, 2).join(" "));
  assert.equal(graded.abstained, true);
  assert.equal(graded.reason, ABSTAIN.SHORT);
  assert.equal(graded.score, null, "null rather than 0, so nothing downstream can average it");
  assert.equal(graded.pct, null);
  assert.equal(graded.strictScore, null);
  assert.equal(graded.total, length(SHEPHERD), "the text is still described");
  assert.equal(graded.heardCount, 2);
  assert.equal(graded.diff.length, length(SHEPHERD), "and the diff invariant holds even here");
});

test("★ garbage abstains rather than returning a number", () => {
  for (const junk of ["", "   ", "um uh hmm", "..."]) {
    const graded = scoreRecital(SHEPHERD, junk);
    assert.equal(graded.abstained, true, JSON.stringify(junk));
    assert.equal(graded.score, null);
    assert.equal(graded.reason, ABSTAIN.EMPTY);
  }
});

test("a flood of tokens abstains before the aligner allocates anything", () => {
  const graded = scoreRecital(SHEPHERD, "lord ".repeat(400));
  assert.equal(graded.abstained, true);
  assert.equal(graded.reason, ABSTAIN.FLOOD);
  assert.equal(graded.ops.length, 0, "nothing was aligned");
  assert.ok(graded.heardCount > MAX_SIGNAL_TOKENS(graded.total));
});

test("the caller's own signal can abstain even when tokens arrived", () => {
  // Whoever owns the microphone knows whether the recognizer ever reported
  // anything; the pure module is given that rather than guessing at it.
  const graded = scoreRecital(SHEPHERD, spoken(SHEPHERD), { sawSpeech: false });
  assert.equal(graded.abstained, true);
  assert.equal(graded.reason, ABSTAIN.EMPTY);
});

test("the abstention thresholds are the measured ones, and the floor is capped by the text", () => {
  assert.equal(MIN_SIGNAL_RATIO, 0.3);
  assert.equal(MAX_SIGNAL_TOKENS(29), 148);
  // There is no such thing as a partial recitation of a two-word sentence, so
  // the floor of three must not abstain on the whole of one.
  assert.equal(scoreRecital(SHORT, "water").reason, ABSTAIN.SHORT);
  assert.equal(scoreRecital(SHORT, "water freezes solid").abstained, false);
});

test("★ reciting twice is flagged, not silently scored", () => {
  const words = heard(SHEPHERD);
  const wrong = words.map((w, i) => (i % 3 ? w : "elsewhere")).join(" ");
  const graded = scoreRecital(SHEPHERD, `${wrong} ${spoken(SHEPHERD)}`);
  assert.equal(graded.score, 1, "they did recite it correctly, on the second pass");
  assert.equal(graded.verbose, true, "and the channel guard says so, for the caller to act on");
  assert.ok(graded.heardCount > VERBOSE_RATIO * graded.total);
});

/* ── the transcript, before anything is aligned ───────────────────────────── */

test("contractions expand, but a possessive that only looks like one does not", () => {
  assert.deepEqual(transcriptTokens("don't"), ["do", "not"]);
  assert.deepEqual(transcriptTokens("I'll"), ["i", "will"]);
  assert.deepEqual(transcriptTokens("let’s"), ["let", "us"], "a curly apostrophe is the same apostrophe");
  assert.deepEqual(transcriptTokens("its"), ["its"], "expanding this one would cost a word");
});

test("numerals are spelled out, into tokens rather than into one token", () => {
  assert.deepEqual(transcriptTokens("1"), ["one"]);
  assert.deepEqual(transcriptTokens("32"), ["thirty", "two"]);
  assert.deepEqual(transcriptTokens("thirty-two"), ["thirty", "two"], "and a hyphen is a space");
  assert.deepEqual(transcriptTokens("2nd"), ["second"]);
  assert.deepEqual(transcriptTokens("1000"), ["one", "thousand"]);
  assert.deepEqual(transcriptTokens("21st"), ["twenty", "first"]);
});

test("disfluencies are dropped unless the text itself wants the word", () => {
  assert.deepEqual(transcriptTokens("um uh the lord"), ["the", "lord"]);
  assert.deepEqual(transcriptTokens("oh taste and see"), ["taste", "and", "see"], "stripped by default");
  assert.deepEqual(transcriptTokens("oh taste and see", { keep: new Set(["oh"]) }), ["oh", "taste", "and", "see"]);
  // And the passage-aware path is the one a real recitation takes: a word the
  // text itself contains is never an accident.
  const psalm34 = { text: "Oh, taste and see that the LORD is good." };
  assert.equal(scoreRecital(psalm34, "oh taste and see that the lord is good").score, 1);
});

/* ── the aligner on its own ───────────────────────────────────────────────── */

test("alignWords reports the operations, not just a cost", () => {
  const { ops, cost } = alignWords(["trust", "in", "the", "Lord"], ["trust", "in", "the", "lord"]);
  assert.equal(cost, 0);
  assert.deepEqual(
    ops.map((o) => o.op),
    ["sub", "sub", "sub", "sub"],
  );
  assert.ok(ops.every((o) => o.kind === "exact"));
});

test("an insertion is absorbed rather than shifting the alignment", () => {
  const { ops } = alignWords(["Lord", "with", "all"], ["lord", "erm", "with", "all"]);
  assert.deepEqual(
    ops.map((o) => o.op),
    ["sub", "ins", "sub", "sub"],
  );
});

test("optional reference words cost nothing to omit", () => {
  const words = ["give", "you", "the", "kingdom.", "Luke", "12:48b", "Everyone"];
  const optional = new Set([4, 5]);
  const tokens = ["give", "you", "the", "kingdom", "everyone"];
  assert.equal(alignWords(words, tokens, { optional }).cost, 0);
  assert.ok(alignWords(words, tokens).cost > 0, "and a full point each without the flag");
});

test("the split op credits two reference words against one heard token", () => {
  const { ops, cost } = alignWords(["do", "not"], ["dont"]);
  assert.deepEqual(
    ops.map((o) => o.op),
    ["split"],
  );
  assert.equal(ops[0].kind, "edit", "'donot' and 'dont' are one edit apart");
  assert.equal(ops[0].ri, 0, "ri is the first of the two reference words");
  assert.equal(cost, COST.SPLIT + COST.EDIT);
  assert.ok(cost < COST.OMIT, "and it beats dropping one of them outright");
});

test("the merge op credits one reference word against two heard tokens", () => {
  // The same recurrence term the other way round: what puts a hyphenated word,
  // or one the source data fused, back together.
  const { ops, cost } = alignWords(["self-control"], ["self", "control"]);
  assert.deepEqual(
    ops.map((o) => o.op),
    ["merge"],
  );
  assert.equal(ops[0].kind, "exact");
  assert.equal(cost, COST.MERGE);
});

/* ── the structural properties ────────────────────────────────────────────── */

test("the diff has one entry per text.split(' ') word, for any transcript at all", () => {
  const transcripts = ["", "um uh", spoken(SHEPHERD), "lord ".repeat(500), "1 2 3 don't"];
  for (const passage of [SHEPHERD, NAMES, SHORT]) {
    const want = passage.text.split(" ").length;
    for (const transcript of transcripts) {
      const graded = scoreRecital(passage, transcript);
      assert.equal(graded.diff.length, want, JSON.stringify(transcript.slice(0, 12)));
      assert.ok(graded.diff.every((d) => typeof d.word === "string"));
    }
  }
});

test("the counts are one tally per operation, so they sum to the operation list", () => {
  const cases = [
    [SHEPHERD, spoken(SHEPHERD)],
    [SHEPHERD, misspeak(SHEPHERD, { shepherd: "trombone" })],
    [SHEPHERD, `${heard(SHEPHERD).slice(0, 3).join(" ")} ${spoken(SHEPHERD)}`],
    [NAMES, `um ${spoken(NAMES)}`],
  ];
  for (const [passage, transcript] of cases) {
    const graded = scoreRecital(passage, transcript);
    const total = Object.values(graded.counts).reduce((a, b) => a + b, 0);
    assert.equal(total, graded.ops.length);
  }
});

test("the diff entry shape is stable, and hit follows the tier", () => {
  const graded = scoreRecital(SHEPHERD, misspeak(SHEPHERD, { shepherd: "trombone", no: "know" }));
  for (const entry of graded.diff) {
    assert.equal(typeof entry.hit, "boolean");
    assert.equal(typeof entry.optional, "boolean");
    assert.equal(entry.hit, entry.kind !== "sub" && entry.kind !== "omit");
    assert.ok(["exact", "homophone", "edit", "phonetic", "sub", "omit"].includes(entry.kind));
  }
});

test("credited words advance monotonically through the transcript", () => {
  const opening = heard(SHEPHERD).slice(0, 3).join(" ");
  const graded = scoreRecital(SHEPHERD, `${opening} ${misspeak(SHEPHERD, { shepherd: "trombone" })} penguin`);
  let last = -1;
  for (const op of graded.ops) {
    if (op.hi < 0) continue;
    assert.ok(op.hi > last, `heard index ${op.hi} came after ${last}`);
    last = op.op === "merge" ? op.hi + 1 : op.hi;
  }
});

test("no amount of extra talking can inflate the score past what was produced", () => {
  const graded = scoreRecital(SHEPHERD, `${spoken(SHEPHERD)} ${heard(SHEPHERD).slice(0, 20).join(" ")}`);
  assert.equal(graded.credited, graded.total, "each reference word is credited at most once");
  assert.ok(graded.score <= 1);
});
