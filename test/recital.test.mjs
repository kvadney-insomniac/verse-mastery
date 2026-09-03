import test from "node:test";
import assert from "node:assert/strict";

import {
  ABSTAIN,
  COST,
  MAX_SIGNAL_TOKENS,
  MIN_SIGNAL_RATIO,
  VERBOSE_RATIO,
  alignWords,
  optionalRefWords,
  properNouns,
  scoreRecital,
  transcriptTokens,
} from "../src/recital.js";
import { gradeWritten } from "../src/grading.js";
import { norm } from "../src/text.js";
import { mulberry32 } from "../src/review.js";
import { HOMOPHONES, MIN_FUZZY_LEN, MIN_PHONETIC_LEN, wordMatch } from "../src/wordmatch.js";
import { passages } from "../data/passages.js";

/* The fixtures below are all real passage text, the whole point of the design
 * document is that it was measured against the shipped data rather than reasoned
 * about in the abstract, and a fixture that invents a passage would be a test
 * protecting nothing. */
const of = (ref) => {
  const passage = passages.find((p) => p.ref === ref);
  assert.ok(passage, `no passage ${ref}`);
  return passage;
};

/* What a recognizer actually emits: a flat lowercase stream, no punctuation. */
const spoken = (passage) => passage.text.split(" ").map(norm).filter(Boolean).join(" ");

const PROVERBS = of("Proverbs 3:5-6");
const PSALM23 = of("Psalm 23");

/* The commit bar, quoted from srs.js's own constant in spirit but written here
 * as the figure the fixtures are aimed at. */
const COMMIT = 0.95;

/* ── deriving a fixture from whatever translation is shipped ──────────────── */

/* The scoring rules are facts about alignment, not about a wording, and these
 * fixtures now have to be the same: the app's text is pluggable, this branch
 * ships a public-domain translation so the repo can be handed to strangers, and
 * the very same test files ship beside the ESV set the congregation uses. So
 * nothing below quotes a word of scripture. A false start is built from the
 * passage's own opening words, a dropped word is a word the passage actually
 * has, and a misremembered word is manufactured out of the spelling in hand,
 * which is a better test than a quoted string ever was, because what is being
 * asserted is the mechanism rather than one publisher's phrasing.
 *
 * Where a fixture needs a *feature* the shipped text may genuinely not have,
 * a contraction the recognizer can write, a fused word left by the fetcher, a
 * proper noun only the phonetic tier can reach, it searches the shipped set
 * for one and skips itself with a reason rather than quietly asserting
 * nothing. Every derivation below also asserts that it found what it went
 * looking for, because a mangle that silently failed to apply is a fixture
 * that passes while testing air. */

/* The passage's words as the recognizer would hand them back. */
const heard = (passage) => spoken(passage).split(" ");

/* How many words the passage is scored out of. */
const length = (passage) => passage.text.split(" ").length;

/* A passage word with its punctuation still on, found by what it normalizes
 * to, which is how a fixture names the diff entry it expects without quoting
 * anything. */
const raw = (passage, key) => passage.text.split(" ").find((w) => norm(w) === key);

/* The words a passage uses exactly once, as `[index, word]`. A fixture that
 * mangles one of these is mangling something the aligner cannot confuse with
 * another copy of itself further along, whatever the translation. */
const uniqueWords = (passage) => {
  const words = heard(passage);
  const seen = {};
  for (const word of words) seen[word] = (seen[word] || 0) + 1;
  return words.map((word, i) => [i, word]).filter(([, word]) => seen[word] === 1);
};

/* Words the member might have said that this passage will not credit against
 * anything. They are picked by asking `wordMatch` rather than by being
 * obviously silly, so no translation can undermine a fixture by happening to
 * use one of them, and the caller is told outright if the passage leaves it
 * short. */
const NONSENSE = ["trombone", "penguin", "zucchini", "asteroid", "bicycle", "umbrella"];
const foreignTo = (passage, n) => {
  const words = heard(passage);
  const usable = NONSENSE.filter((candidate) => words.every((word) => wordMatch(candidate, word) === null));
  assert.ok(usable.length >= n, `${passage.ref} leaves fewer than ${n} words nothing in it can match`);
  return usable.slice(0, n);
};

/* One vowel swapped is one edit and two is two, which is past every tier there
 * is. That is how a fixture manufactures a misremembered word out of whatever
 * spelling the shipped text uses; `null` back means the word had too few
 * vowels to mangle that far, and the caller looks for another. */
const vowelSwap = (word, count) => {
  const letters = [...word];
  let done = 0;
  for (let i = 1; i < letters.length - 1 && done < count; i++) {
    if ("aeiou".includes(letters[i])) {
      letters[i] = letters[i] === "a" ? "e" : "a";
      done++;
    }
  }
  return done === count ? letters.join("") : null;
};

/* Substituting `swaps` (a map from the passage's word to what was said
 * instead) into the transcript, asserting that every one of them applied. */
const misspeak = (passage, swaps) => {
  const words = heard(passage);
  for (const key of Object.keys(swaps)) assert.ok(words.includes(key), `${passage.ref} does not say "${key}"`);
  return words.map((word) => swaps[word] ?? word).join(" ");
};

/* ── the cost matrix's one invariant ──────────────────────────────────────── */

/* One line, and it is the line that stops a retune from silently turning every
 * substitution into a delete-plus-insert. Both readings cost the same in the
 * score, one uncredited reference word either way, but only the substitution
 * reading lets the feedback say "you said *hard* where the verse says *heart*",
 * which is the feedback worth giving. It holds narrowly and deliberately. */
test("INS + OMIT > SUB, so a one-for-one swap is reported as a substitution", () => {
  assert.ok(COST.INS + COST.OMIT > COST.SUB, `${COST.INS} + ${COST.OMIT} must exceed ${COST.SUB}`);

  /* One word of the passage, said as something the passage cannot credit,
   * whichever word that turns out to be in the translation in hand. */
  const [, word] = uniqueWords(PROVERBS).findLast(([, w]) => w.length >= MIN_FUZZY_LEN);
  const [instead] = foreignTo(PROVERBS, 1);
  const graded = scoreRecital(PROVERBS, misspeak(PROVERBS, { [word]: instead }));
  assert.equal(graded.counts.sub, 1, "reported as one substitution");
  assert.equal(graded.counts.omit, 0, "not as an omission");
  assert.equal(graded.counts.ins, 0, "plus an insertion");
  const entry = graded.diff.find((d) => d.word === raw(PROVERBS, word));
  assert.equal(entry.kind, "sub");
  assert.equal(entry.heard, instead, "and the diff can name what was said instead");
});

test("the graded tiers are priced apart, so a tie prefers the exact reading", () => {
  assert.equal(COST.EXACT, 0);
  assert.equal(COST.HOMOPHONE, 0, "the member said the right sound; nothing was got wrong");
  assert.ok(COST.EDIT > COST.EXACT && COST.PHONETIC > COST.EDIT, "and the phonetic tier is the dearest match");
  assert.ok(COST.PHONETIC < COST.SUB, "but still cheaper than calling it a different word");
});

/* ── §6, the twenty fixtures ──────────────────────────────────────────────── */

/* Each case names what the member did, what today's grader says about it, and
 * where the new scorer must land. The `today` figures are measured here rather
 * than quoted, so the regression they describe is demonstrated by the suite
 * rather than asserted by a comment, and they are compared against a bound
 * rather than pinned to a percentage, since how badly the positional grader
 * collapses depends on the wording it collapsed on. Where the mark itself can
 * be stated as arithmetic over the words the member did not recall, it is:
 * `(total − missed) / total` says what the score *is*, where a hand-measured
 * range only ever said what it was on one translation. */
const today = (passage, transcript) => gradeWritten(passage.text.split(" "), transcript).score;

test("1. a word-perfect recital scores exactly 1.00", () => {
  const graded = scoreRecital(PROVERBS, spoken(PROVERBS));
  assert.equal(graded.score, 1);
  assert.equal(graded.strictScore, 1);
  assert.equal(graded.pct, 100);
  assert.equal(graded.abstained, false);
  assert.equal(graded.verbose, false);
});

test("2. a leading filler is free", () => {
  const graded = scoreRecital(PROVERBS, `um ${spoken(PROVERBS)}`);
  assert.equal(graded.score, 1);
  assert.equal(graded.heardCount, transcriptTokens(spoken(PROVERBS)).length, "the disfluency is not even a token");
});

test("3. ★ a three-word false start no longer stalls the grader", () => {
  /* The regression test this whole module exists for, and the one fixture that
   * has to keep both halves: a member runs at the verse, stops, and starts
   * again. Measured on the ESV set the failure was 14%; on the public-domain
   * set it is 15%. The figure is not the point and is not pinned, what is
   * pinned is that the positional grader still collapses on a word-perfect
   * recital and that this one does not. */
  const opening = heard(PROVERBS).slice(0, 3).join(" ");
  const transcript = `${opening} ${spoken(PROVERBS)}`;
  const before = today(PROVERBS, transcript);
  assert.ok(before < 0.25, `the failure this module exists to fix, the old grader says ${Math.round(before * 100)}%`);

  const graded = scoreRecital(PROVERBS, transcript);
  assert.ok(graded.score >= 0.98, `scored ${graded.pct}%`);
  assert.ok(graded.score >= COMMIT, "and clears the commit bar");
  assert.ok(graded.score > before + 0.7, "which is the whole distance between the two graders");
  assert.equal(graded.counts.ins, 3, "the false start is absorbed as three insertions");
  assert.equal(graded.credited, graded.total, "each reference word is credited exactly once");
});

test("4. a self-correction is one production, credited once and penalized never", () => {
  /* The member says a word the verse does not want, hears themselves do it,
   * and runs at the clause again from three words back. Everything in that
   * repair is a token the passage never asked for, so every one of them should
   * be absorbed and every reference word credited once. */
  const words = heard(PROVERBS);
  const at = Math.floor(words.length / 3);
  const [wrong, hesitation] = foreignTo(PROVERBS, 2);
  const repair = [...words.slice(0, at), wrong, hesitation, ...words.slice(at - 3)];
  const transcript = repair.join(" ");

  const before = today(PROVERBS, transcript);
  assert.ok(before < 0.5, `today a repaired clause costs most of the verse, ${Math.round(before * 100)}%`);
  const graded = scoreRecital(PROVERBS, transcript);
  assert.equal(graded.score, 1);
  assert.equal(graded.counts.ins, repair.length - words.length, "every repeated and every wrong word absorbed");
  assert.equal(graded.counts.omit + graded.counts.sub, 0, "and nothing charged for the repair");
});

/* The recognizer writes contractions the passage does not have, and it costs a
 * word under a positional grader. Whether the shipped text offers the case at
 * all is a translation's business, so the set is searched for a passage with a
 * contractible pair rather than one being quoted. */
const CONTRACTIBLE = {
  "do not": "don't",
  "does not": "doesn't",
  "is not": "isn't",
  "are not": "aren't",
  "was not": "wasn't",
  "will not": "won't",
  "it is": "it's",
  "that is": "that's",
  "there is": "there's",
  "he is": "he's",
  "she is": "she's",
  "what is": "what's",
  "let us": "let's",
  "i will": "i'll",
  "you will": "you'll",
  "we will": "we'll",
  "they will": "they'll",
  "i am": "i'm",
  "you are": "you're",
  "we are": "we're",
  "they have": "they've",
  "i have": "i've",
};

const contraction = (() => {
  for (const passage of passages) {
    const words = heard(passage);
    for (let i = 0; i < words.length - 1; i++) {
      const form = CONTRACTIBLE[`${words[i]} ${words[i + 1]}`];
      if (form) return { passage, transcript: [...words.slice(0, i), form, ...words.slice(i + 2)].join(" "), form };
    }
  }
  return null;
})();

test(
  "5. a contraction the recognizer wrote is not a word the member dropped",
  { skip: contraction ? false : "no shipped passage contains a pair this translation could contract" },
  () => {
    const { passage, transcript, form } = contraction;
    assert.ok(today(passage, transcript) < 1, `today "${form}" costs a word of ${passage.ref}`);
    assert.equal(scoreRecital(passage, transcript).score, 1);
  },
);

test("6. ★ the negative control, wrong words stay wrong", () => {
  /* Enough words said wrong that the commit bar's 5% margin cannot cover them,
   * and said as words nothing in the passage will credit, the phonetic tier
   * included, since these are not proper nouns. Forgiveness has a floor and
   * this is where it is. */
  const wrong = Math.floor(length(PROVERBS) * 0.05) + 1;
  const targets = uniqueWords(PROVERBS)
    .filter(([, w]) => w.length >= MIN_FUZZY_LEN)
    .slice(-wrong);
  assert.equal(targets.length, wrong, `${PROVERBS.ref} has too few distinctive words to mangle`);
  const instead = foreignTo(PROVERBS, wrong);
  const swaps = Object.fromEntries(targets.map(([, word], i) => [word, instead[i]]));
  for (const [word, said] of Object.entries(swaps)) {
    assert.equal(wordMatch(said, word, { proper: true }), null, `${said}/${word} must not be creditable at all`);
  }

  const graded = scoreRecital(PROVERBS, misspeak(PROVERBS, swaps));
  assert.equal(graded.counts.sub, wrong, `scored ${graded.pct}%`);
  assert.equal(graded.score, (graded.total - wrong) / graded.total, "exactly the words that were not recalled");
  assert.ok(graded.score < COMMIT, "and does not clear the commit bar");
  assert.equal(graded.strictScore, graded.score, "no phonetic credit was involved either way");
});

test("7. a single dropped conjunction still clears the commit bar", () => {
  /* One word gone, a word the passage says only once, so the omission cannot
   * be papered over by another copy of it further along. */
  assert.ok(length(PROVERBS) >= 20, "a passage this short would fail the bar on one word, which is not the case");
  const [, dropped] = uniqueWords(PROVERBS).find(([, w]) => w.length <= 4);
  const graded = scoreRecital(
    PROVERBS,
    heard(PROVERBS)
      .filter((word) => word !== dropped)
      .join(" "),
  );
  assert.equal(graded.counts.omit, 1, `dropped "${dropped}", scored ${graded.pct}%`);
  assert.equal(graded.score, (graded.total - 1) / graded.total);
  assert.ok(graded.score >= COMMIT, "which is exactly what COMMIT_SCORE's 5% margin is for");
});

test("8. genuine recall errors score below commit", () => {
  /* Not nonsense this time but near neighbours, the passage's own words with
   * two vowels wrong, which is what half-remembering sounds like. Two edits is
   * past the edit tier, and these are ordinary words rather than names, so the
   * phonetic tier is gated shut over them however alike they sound. That gate
   * is the assertion underneath this one: several of these variants *would* be
   * credited if the reference word were a proper noun, and are not. */
  const wrong = Math.floor(length(PROVERBS) * 0.05) + 1;
  const names = properNouns(PROVERBS.text);
  const swaps = {};
  for (const [, word] of uniqueWords(PROVERBS)) {
    if (Object.keys(swaps).length === wrong) break;
    const near = word.length >= MIN_FUZZY_LEN && !names.has(word) ? vowelSwap(word, 2) : null;
    if (near && wordMatch(near, word) === null) swaps[word] = near;
  }
  assert.equal(Object.keys(swaps).length, wrong, `${PROVERBS.ref} offers too few words to half-remember`);
  const wouldPass = Object.entries(swaps).filter(([word, near]) => wordMatch(near, word, { proper: true }));
  assert.ok(wouldPass.length > 0, "and at least one of them is refused only because the word is not a name");

  const graded = scoreRecital(PROVERBS, misspeak(PROVERBS, swaps));
  assert.equal(graded.counts.sub, wrong, `scored ${graded.pct}%`);
  assert.equal(graded.score, (graded.total - wrong) / graded.total);
  assert.ok(graded.score < COMMIT);
});

test("9. ★ a transcript that cut out abstains rather than asserting a number", () => {
  const clipped = heard(PROVERBS).slice(0, 2).join(" ");
  const before = today(PROVERBS, clipped);
  assert.ok(before < 0.2, `today it says ${Math.round(before * 100)} percent about two tokens`);

  const graded = scoreRecital(PROVERBS, clipped);
  assert.equal(graded.abstained, true);
  assert.equal(graded.reason, ABSTAIN.SHORT);
  assert.equal(graded.score, null, "null rather than 0, so nothing downstream can average it");
  assert.equal(graded.pct, null);
  assert.equal(graded.strictScore, null);
  assert.equal(graded.total, length(PROVERBS), "the passage is still described");
  assert.equal(graded.heardCount, 2);
});

test("10. an empty transcript abstains", () => {
  const graded = scoreRecital(PROVERBS, "");
  assert.equal(graded.abstained, true);
  assert.equal(graded.reason, ABSTAIN.EMPTY);
  assert.equal(graded.score, null);
});

test(`11. length is not the problem, all ${length(PSALM23)} words of Psalm 23`, () => {
  assert.equal(scoreRecital(PSALM23, spoken(PSALM23)).score, 1);
});

test("12. ★ a genuinely forgotten verse is not rescued", () => {
  /* A whole verse gone out of the middle, taken from the passage's own `verses`
   * array so the fixture drops exactly what one verse is in whatever
   * translation is shipped. */
  assert.ok(Array.isArray(PSALM23.verses) && PSALM23.verses.length >= 3, "Psalm 23 ships as verses");
  const gone = PSALM23.verses[2].split(" ").map(norm).filter(Boolean).join(" ");
  const transcript = spoken(PSALM23).replace(`${gone} `, "");
  assert.notEqual(transcript, spoken(PSALM23), "the verse really came out");

  const graded = scoreRecital(PSALM23, transcript);
  const missing = gone.split(" ").length;
  assert.equal(graded.counts.omit, missing);
  assert.equal(graded.score, (graded.total - missing) / graded.total, `${missing} of ${graded.total} words gone`);
  assert.ok(graded.score < COMMIT, "the whole point: forgiveness has a floor");
});

test("13. ★ the stall, on a long passage", () => {
  const transcript = `${heard(PSALM23).slice(0, 6).join(" ")} ${spoken(PSALM23)}`;
  const before = today(PSALM23, transcript);
  assert.ok(before < 0.2, `today: six words in, restarted, and scored ${Math.round(before * 100)} percent`);
  assert.ok(scoreRecital(PSALM23, transcript).score >= 0.98);
});

/* A curated homophone the shipped text actually offers: a word the passage says
 * once whose partner it never says, so swapping the two is unambiguous. Which
 * pair that is belongs to the translation, not to this file. */
const homophonePair = (() => {
  for (const passage of passages) {
    const words = heard(passage);
    for (const [i, word] of uniqueWords(passage)) {
      for (const pair of HOMOPHONES) {
        if (!pair.includes(word)) continue;
        const said = pair[0] === word ? pair[1] : pair[0];
        if (!words.includes(said)) return { passage, index: i, word, said };
      }
    }
  }
  return null;
})();

test(
  "14. a curated homophone is credited, and credited strictly",
  { skip: homophonePair ? false : "no shipped passage says a word the homophone table has a partner for" },
  () => {
    const { passage, index, word, said } = homophonePair;
    const transcript = misspeak(passage, { [word]: said });
    assert.ok(today(passage, transcript) < 1, `today "${said}" for "${word}" costs a word`);

    const graded = scoreRecital(passage, transcript);
    assert.equal(graded.score, 1);
    assert.equal(graded.strictScore, 1, "a homophone earns full credit in the strict figure too");
    assert.equal(graded.counts.homophone, 1);
    assert.equal(
      graded.diff[index].kind,
      "homophone",
      `and "${raw(passage, word)}" carries its punctuation, which norm() settles`,
    );
  },
);

/* The one-edit tier, exercised on a word the passage repeats, the case
 * voice.js documents, where the recognizer spells one word wrong and spells it
 * wrong every time. */
const misspelling = (() => {
  const passage = of("Galatians 6:7-9");
  const words = heard(passage);
  const seen = {};
  for (const word of words) seen[word] = (seen[word] || 0) + 1;
  const repeated = Object.entries(seen)
    .filter(([word, n]) => n >= 2 && word.length > MIN_FUZZY_LEN)
    .sort((a, b) => b[1] - a[1]);
  for (const [word, times] of repeated) {
    const said = vowelSwap(word, 1);
    if (said && !words.includes(said) && wordMatch(said, word) === "edit") return { passage, word, said, times };
  }
  return null;
})();

test(
  "15. the one-edit tier, a repeated word the engine spelled wrong every time",
  { skip: misspelling ? false : "the shipped passage repeats no word long enough for the edit tier" },
  () => {
    const { passage, word, said, times } = misspelling;
    const transcript = misspeak(passage, { [word]: said });
    assert.ok(today(passage, transcript) < 1, `today "${said}" for "${word}" costs ${times} words`);

    const graded = scoreRecital(passage, transcript);
    assert.equal(graded.score, 1);
    assert.equal(graded.counts.edit, times, `${times} occurrences of "${word}", all heard as "${said}"`);
  },
);

/* A word the fetcher left fused, the ESV set carries `eagles;they`, the
 * public-domain sets carry a hyphenated compound, and the recogniser hands
 * back the two halves it hears. `merge` is what puts them back together, so
 * the fixture goes looking for whatever fused word the shipped text has rather
 * than naming one. */
const FUSED = /^([A-Za-z]+)[^A-Za-z0-9\s'’]([A-Za-z]+)/;
const fusedWord = (() => {
  for (const passage of passages) {
    for (const word of passage.text.split(" ")) {
      const parts = word.match(FUSED);
      if (parts) return { passage, word, said: `${parts[1].toLowerCase()} ${parts[2].toLowerCase()}` };
    }
  }
  return null;
})();

test(
  "16. the merge op absorbs a fused word the fetcher left behind",
  { skip: fusedWord ? false : "the shipped set carries no fused word for the merge op to absorb" },
  () => {
    const { passage, word, said } = fusedWord;
    const transcript = misspeak(passage, { [norm(word)]: said });
    assert.ok(today(passage, transcript) < 1, `today "${word}" is a guaranteed miss`);

    const graded = scoreRecital(passage, transcript);
    assert.equal(graded.score, 1);
    assert.equal(graded.counts.merge, 1);
    assert.equal(graded.diff.find((d) => d.word === word).heard, said);
  },
);

test("17. ★ a passage that once carried an embedded reference now scores whole", () => {
  /* This fixture was the sharpest example of the old grader's unfairness: Luke
   * 12:32 shipped with "Luke 12:48b" inside its own text, two words nobody
   * recites, so a word-perfect recital was capped at 95%, at the commit bar
   * rather than above it. The data has since been fixed upstream, and the
   * fixture is kept because the outcome it asserts is the one that matters:
   * saying the passage correctly scores 100. */
  const luke = of("Luke 12:32");
  const heard = spoken(luke);
  const graded = scoreRecital(luke, heard);
  assert.equal(graded.score, 1);
  assert.equal(graded.diff.length, luke.text.split(" ").length, "one entry per word of the passage");
  assert.equal(graded.total, graded.diff.length, "and every one of them countable");
});

test("18. an adjacent transposition costs one word, not two", () => {
  /* Two neighbouring words said the other way round, whichever pair the
   * translation puts next to each other, taken from words the passage says
   * only once so the swap cannot be read as anything else. */
  const philippians = of("Philippians 4:6-7");
  const words = heard(philippians);
  const once = new Set(uniqueWords(philippians).map(([i]) => i));
  const at = words.findIndex((word, i) => once.has(i) && once.has(i + 1) && word !== words[i + 1]);
  assert.ok(at >= 0, `${philippians.ref} has no adjacent pair of once-said words`);

  const graded = scoreRecital(
    philippians,
    [...words.slice(0, at), words[at + 1], words[at], ...words.slice(at + 2)].join(" "),
  );
  assert.equal(graded.counts.sub + graded.counts.omit, 1, `swapped "${words[at]}" and "${words[at + 1]}"`);
  assert.equal(graded.score, (graded.total - 1) / graded.total, `scored ${graded.pct}%`);
  assert.ok(graded.score >= COMMIT, "the gap asymmetry gets this for free, no Damerau term needed");
});

/* The two proper-noun tiers need a passage carrying two names: one the edit
 * tier reaches (which is strict-eligible) and one only the phonetic tier can
 * (which is not). The names a translation transliterates are its own, so the
 * set is searched for a passage that offers both. */
const propernouns = (() => {
  for (const passage of passages) {
    const words = heard(passage);
    const names = [...properNouns(passage.text)].filter(
      (name) => name.length >= MIN_PHONETIC_LEN && words.filter((w) => w === name).length === 1,
    );
    const sounded = names.find((name) => {
      const said = name.replace("ph", "f");
      return said !== name && !words.includes(said) && wordMatch(said, name, { proper: true }) === "phonetic";
    });
    const spelled = names.find((name) => {
      const said = vowelSwap(name, 1);
      return name !== sounded && said && !words.includes(said) && wordMatch(said, name, { proper: true }) === "edit";
    });
    if (sounded && spelled) {
      return {
        passage,
        sounded,
        spelled,
        heardSounded: sounded.replace("ph", "f"),
        heardSpelled: vowelSwap(spelled, 1),
      };
    }
  }
  return null;
})();

test(
  "19. ★ the proper-noun tiers, and the strict/friendly gap",
  { skip: propernouns ? false : "no shipped passage carries two names the two tiers can be told apart on" },
  () => {
    const { passage, sounded, spelled, heardSounded, heardSpelled } = propernouns;
    const graded = scoreRecital(passage, misspeak(passage, { [sounded]: heardSounded, [spelled]: heardSpelled }));

    assert.equal(graded.score, 1, "the friendly figure credits both");
    assert.equal(graded.counts.edit, 1, `"${heardSpelled}" for ${spelled} by edit, strict-eligible`);
    assert.equal(graded.counts.phonetic, 1, `"${heardSounded}" for ${sounded} by phonetics, not`);
    assert.ok(graded.strictScore < 1, `strict ${graded.strictScore.toFixed(3)}`);
    assert.equal(
      graded.strictScore,
      (graded.total - 1) / graded.total,
      "exactly the one phonetic credit's worth, and no more",
    );
  },
);

test("20. ★ reciting twice is flagged, not silently scored", () => {
  const words = spoken(PROVERBS).split(" ");
  const wrong = words.map((w, i) => (i % 3 ? w : "elsewhere")).join(" ");
  const graded = scoreRecital(PROVERBS, `${wrong} ${spoken(PROVERBS)}`);

  assert.equal(graded.score, 1, "they did recite it correctly, on the second pass");
  assert.equal(graded.verbose, true, "and the channel guard says so, for a commit gate to act on");
  assert.ok(graded.heardCount > VERBOSE_RATIO * graded.total);
});

/* ── the acceptance cases the brief names, stated as one test ─────────────── */

test("★ a half-forgotten passage lands near half, not near the commit bar", () => {
  const words = spoken(PROVERBS).split(" ");
  const graded = scoreRecital(PROVERBS, words.slice(0, Math.ceil(words.length / 2)).join(" "));
  assert.ok(graded.score > 0.45 && graded.score < 0.6, `scored ${graded.pct}%, forgiveness is not amnesty`);
  assert.ok(graded.score < COMMIT);

  const half = spoken(PSALM23).split(" ");
  const long = scoreRecital(PSALM23, half.slice(0, Math.floor(half.length / 2)).join(" "));
  assert.ok(long.score > 0.45 && long.score < 0.55, `Psalm 23 half-recited scored ${long.pct}%`);
});

test("★ garbage abstains rather than returning a number", () => {
  for (const junk of ["", "   ", "um uh hmm", "..."]) {
    const graded = scoreRecital(PROVERBS, junk);
    assert.equal(graded.abstained, true, JSON.stringify(junk));
    assert.equal(graded.score, null);
    assert.equal(graded.reason, ABSTAIN.EMPTY);
  }
});

test("a flood of tokens abstains before the aligner allocates anything", () => {
  const graded = scoreRecital(PROVERBS, "lord ".repeat(200));
  assert.equal(graded.abstained, true);
  assert.equal(graded.reason, ABSTAIN.FLOOD);
  assert.equal(graded.ops.length, 0, "nothing was aligned");
  assert.ok(graded.heardCount > MAX_SIGNAL_TOKENS(graded.total));
});

test("the browser's own signal can abstain even when tokens arrived", () => {
  // App.js owns the microphone and knows whether onText ever fired; the pure
  // module is given that rather than guessing at it.
  const graded = scoreRecital(PROVERBS, spoken(PROVERBS), { sawSpeech: false });
  assert.equal(graded.abstained, true);
  assert.equal(graded.reason, ABSTAIN.EMPTY);
});

test("abstention thresholds are the measured ones", () => {
  assert.equal(MIN_SIGNAL_RATIO, 0.3);
  assert.equal(MAX_SIGNAL_TOKENS(29), 148);
  // The floor of three is for short passages: there is no such thing as a
  // partial recital of a two-word verse.
  const short = { text: "Jesus wept." };
  assert.equal(scoreRecital(short, "jesus").reason, ABSTAIN.SHORT);
  assert.equal(scoreRecital(short, "jesus wept truly").abstained, false);
});

/* ── the transcript, before anything is aligned ───────────────────────────── */

test("contractions expand, but a possessive that only looks like one does not", () => {
  assert.deepEqual(transcriptTokens("don't"), ["do", "not"]);
  assert.deepEqual(transcriptTokens("I'll"), ["i", "will"]);
  assert.deepEqual(transcriptTokens("let’s"), ["let", "us"], "a curly apostrophe is the same apostrophe");
  // Isaiah 9 has "you have increased its joy", expanding that would cost a word.
  assert.deepEqual(transcriptTokens("its"), ["its"]);
});

test("numerals are spelled out, into tokens rather than into one token", () => {
  assert.deepEqual(transcriptTokens("1"), ["one"]);
  assert.deepEqual(transcriptTokens("32"), ["thirty", "two"]);
  assert.deepEqual(transcriptTokens("thirty-two"), ["thirty", "two"], "and a hyphen is a space");
  assert.deepEqual(transcriptTokens("2nd"), ["second"]);
  assert.deepEqual(transcriptTokens("1000"), ["one", "thousand"]);
  assert.deepEqual(transcriptTokens("21st"), ["twenty", "first"]);
});

test("disfluencies are dropped unless the passage itself wants the word", () => {
  assert.deepEqual(transcriptTokens("um uh the lord"), ["the", "lord"]);
  assert.deepEqual(transcriptTokens("oh taste and see"), ["taste", "and", "see"], "stripped by default");
  assert.deepEqual(transcriptTokens("oh taste and see", { keep: new Set(["oh"]) }), ["oh", "taste", "and", "see"]);
  // And the passage-aware path is what a real recital of Psalm 34:8 takes.
  const psalm34 = of("Psalm 34:8-9");
  assert.equal(scoreRecital(psalm34, spoken(psalm34)).score, 1, "'Oh, taste and see' is not a filler");
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
  const heard = ["give", "you", "the", "kingdom", "everyone"];
  assert.equal(alignWords(words, heard, { optional }).cost, 0);
  assert.ok(alignWords(words, heard).cost > 0, "and a full point each without the flag");
});

/* The split op has no fixture of its own, and the reason is worth pinning: the
 * contraction table expands `don't` before the aligner ever sees it, so
 * fixture 5 takes the other of the two paths §3e says should both ship. Split
 * is what catches the contractions nobody listed, and it is live code in the
 * COST table, so it needs a test that reaches it directly or a retune could
 * break it with nothing going red. */
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
  // The same recurrence term, the other way round: it is what puts a fused
  // `eagles;they` and a hyphenated `self-control` back together.
  const { ops, cost } = alignWords(["self-control"], ["self", "control"]);
  assert.deepEqual(
    ops.map((o) => o.op),
    ["merge"],
  );
  assert.equal(ops[0].kind, "exact");
  assert.equal(cost, COST.MERGE);
});

test("the phonetic tier is reachable only when the caller says the word is a name", () => {
  const words = ["of", "Naphtali,"];
  const heard = ["of", "naftali"];
  assert.ok(alignWords(words, heard, { proper: new Set([1]) }).cost < COST.SUB);
  assert.equal(alignWords(words, heard).cost, COST.SUB, "ungated, it is simply a different word");
});

/* ── what the passage says about its own words ────────────────────────────── */

test("proper nouns are the words capitalized away from a sentence start", () => {
  const found = properNouns("Trust in the Lord with all your heart. In all your ways acknowledge him.");
  assert.ok(found.has("lord"));
  assert.ok(!found.has("trust"), "capitalized only because it opens the passage");
  assert.ok(!found.has("in"), "nor because it opens the second sentence");
});

test("no shipped passage carries a scripture reference inside its own text", () => {
  /* Four of them once did, Isaiah 54:2-3 carried "Isaiah 55:1-3a", and Luke
   * 12:32 carried "Luke 12:48b", a fetch-time leak that capped a perfect
   * recital of Luke 12:32 at 95%, below the commit bar. The data was fixed
   * upstream (the trailing references became passages of their own), so this
   * now guards the fix rather than tolerating the bug: if the fetcher ever
   * reintroduces one, the scoring layer will quietly excuse it and nobody will
   * notice until a member is marked down. */
  const marked = {};
  for (const passage of passages) {
    const words = passage.text.split(" ");
    const optional = optionalRefWords(words);
    if (optional.size) marked[passage.ref] = [...optional].sort((a, b) => a - b).map((i) => words[i]);
  }
  assert.deepEqual(marked, {}, "the set is clean; see tools/fetch_passages.mjs if this ever fails again");
});

test("a passage that did carry one is scored whole, and reaches the commit bar", () => {
  const luke = of("Luke 12:32");
  const heard = spoken(luke);
  const graded = scoreRecital(luke, heard);
  assert.equal(graded.score, 1, "a perfect recital is perfect");
  assert.equal(
    graded.diff.filter((d) => d.optional).length,
    0,
    "with nothing excused, because there is nothing to excuse",
  );
  assert.ok(graded.score >= 0.95, "and it clears the commit bar it used to be capped at");
});

test("the optional-word mechanism still works, for the day the data slips again", () => {
  /* Driven off a passage built for the purpose rather than off the shipped set,
   * so this keeps testing the mechanism now that no real passage exercises it. */
  const leaky = {
    id: 9001,
    ref: "Made Up 1:1",
    text: "The word of the Lord came to me saying this. Jeremiah 2:2b",
  };
  const words = leaky.text.split(" ");
  const optional = optionalRefWords(words);
  assert.deepEqual(
    [...optional].sort((a, b) => a - b).map((i) => words[i]),
    ["Jeremiah", "2:2b"],
    "the trailing reference is spotted",
  );
  const graded = scoreRecital(leaky, "the word of the lord came to me saying this");
  assert.equal(graded.score, 1, "and reciting the passage without it is still a perfect recital");
});

/* ── the structural properties, which hold over the whole corpus ──────────── */

/* Worth more than any individual fixture, because they cannot be satisfied by
 * tuning the cost matrix. */

test("the diff has one entry per text.split(' ') word, for any transcript at all", () => {
  const transcripts = ["", "um uh", spoken(PSALM23), "lord ".repeat(500), "1 2 3 don't"];
  for (const passage of passages) {
    const want = passage.text.split(" ").length;
    for (const transcript of transcripts) {
      const graded = scoreRecital(passage, transcript);
      assert.equal(graded.diff.length, want, `${passage.ref} vs ${JSON.stringify(transcript.slice(0, 12))}`);
    }
    // Which is the invariant blanks.js, perVerseOf and data/keywords.js all index against.
    assert.ok(scoreRecital(passage, spoken(passage)).diff.every((d) => typeof d.word === "string"));
  }
});

test(`every one of the ${passages.length} passages recited perfectly scores exactly 1.00`, () => {
  const failures = passages.filter((p) => scoreRecital(p, spoken(p)).score !== 1).map((p) => p.ref);
  assert.deepEqual(failures, [], "including any the fetcher left a fused word or an embedded reference in");
});

test("insertions never appear in the diff, only in ops and counts", () => {
  const graded = scoreRecital(PROVERBS, `${heard(PROVERBS).slice(0, 3).join(" ")} ${spoken(PROVERBS)}`);
  assert.equal(graded.diff.length, length(PROVERBS));
  assert.equal(graded.ops.filter((o) => o.op === "ins").length, 3);
  assert.equal(graded.counts.ins, 3);
});

test("the counts are one tally per operation, so they sum to the operation list", () => {
  const [instead] = foreignTo(PROVERBS, 1);
  const [, swapped] = uniqueWords(PROVERBS).findLast(([, w]) => w.length >= MIN_FUZZY_LEN);
  const cases = [
    [PROVERBS, spoken(PROVERBS)],
    [PROVERBS, misspeak(PROVERBS, { [swapped]: instead })],
    [PROVERBS, `${heard(PROVERBS).slice(0, 3).join(" ")} ${spoken(PROVERBS)}`],
    [PSALM23, `um ${spoken(PSALM23)}`],
  ];
  if (fusedWord)
    cases.push([fusedWord.passage, misspeak(fusedWord.passage, { [norm(fusedWord.word)]: fusedWord.said })]);
  for (const [passage, transcript] of cases) {
    const graded = scoreRecital(passage, transcript);
    const total = Object.values(graded.counts).reduce((a, b) => a + b, 0);
    assert.equal(total, graded.ops.length);
  }
});

test("the diff is drop-in compatible with gradeWritten().diff", () => {
  const [instead] = foreignTo(PROVERBS, 1);
  const [, swapped] = uniqueWords(PROVERBS).findLast(([, w]) => w.length >= MIN_FUZZY_LEN);
  const graded = scoreRecital(PROVERBS, misspeak(PROVERBS, { [swapped]: instead }));
  const written = gradeWritten(PROVERBS.text.split(" "), spoken(PROVERBS));
  assert.deepEqual(
    graded.diff.map((d) => d.word),
    written.diff.map((d) => d.word),
    "same words, same order",
  );
  for (const entry of graded.diff) {
    assert.equal(typeof entry.hit, "boolean");
    assert.equal(entry.hit, entry.kind !== "sub" && entry.kind !== "omit");
    assert.ok(["exact", "homophone", "edit", "phonetic", "sub", "omit"].includes(entry.kind));
  }
});

test("credited words advance monotonically through the transcript", () => {
  const [instead, trailing] = foreignTo(PROVERBS, 2);
  const [, swapped] = uniqueWords(PROVERBS).findLast(([, w]) => w.length >= MIN_FUZZY_LEN);
  const opening = heard(PROVERBS).slice(0, 3).join(" ");
  const graded = scoreRecital(PROVERBS, `${opening} ${misspeak(PROVERBS, { [swapped]: instead })} ${trailing}`);
  let last = -1;
  for (const op of graded.ops) {
    if (op.hi < 0) continue;
    assert.ok(op.hi > last, `heard index ${op.hi} came after ${last}`);
    last = op.op === "merge" ? op.hi + 1 : op.hi;
  }
});

test("data/keywords.js indices stay valid against the diff", async () => {
  const { keywordIndices } = await import("../data/keywords.js");
  for (const passage of passages) {
    const indices = keywordIndices[passage.id];
    if (!indices) continue;
    const graded = scoreRecital(passage, spoken(passage));
    for (const i of indices) assert.ok(i >= 0 && i < graded.diff.length, `${passage.ref} index ${i}`);
  }
});

/* The cross-passage floor. Sampled with the app's own seeded PRNG rather than
 * exhaustively, because 183 × 182 alignments is thirty-three thousand of them,
 * and seeded rather than random so a failure is reproducible.
 *
 * This is what actually stops a scorer this forgiving from crediting the wrong
 * verse: not the cost matrix, but the two channel guards. Two short passages
 * sharing a lot of function words are the worst case. */
test("a passage fed a different passage's text scores low, abstains, or is flagged", () => {
  const random = mulberry32(20260822);
  let highest = 0;
  let worst = "";
  let sampled = 0;
  for (let k = 0; k < 250; k++) {
    const a = passages[Math.floor(random() * passages.length)];
    const b = passages[Math.floor(random() * passages.length)];
    if (a.id === b.id) continue;
    sampled++;
    const graded = scoreRecital(a, spoken(b));
    if (graded.abstained || graded.verbose) continue;
    if (graded.score > highest) {
      highest = graded.score;
      worst = `${a.ref} against ${b.ref}`;
    }
  }
  assert.ok(sampled > 200, "the sample really ran");
  assert.ok(highest < 0.5, `highest unflagged cross-passage score was ${Math.round(highest * 100)}%, ${worst}`);
});
