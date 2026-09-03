import test from "node:test";
import assert from "node:assert/strict";

import {
  HOMOPHONES,
  MAX_EDITS,
  MAX_PHONETIC_EDITS,
  MIN_FUZZY_LEN,
  MIN_PHONETIC_LEN,
  PHONETIC_BLOCK,
  doubleMetaphone,
  same,
  stem,
  withinOneEdit,
  wordMatch,
} from "../index.js";

/* These are the cases from the source app's own suite that are facts about the
 * algorithm rather than about its corpus. Nothing here reads a data file: a tier
 * either credits two spellings or it does not, and that question is answerable
 * from the two strings alone. */

/* ── the edit tier ────────────────────────────────────────────────────────── */

test("withinOneEdit accepts one substitution, insertion or deletion and no more", () => {
  assert.equal(withinOneEdit("sows", "sews"), true, "one substitution");
  assert.equal(withinOneEdit("jew", "jews"), true, "one insertion");
  assert.equal(withinOneEdit("paths", "path"), true, "one deletion");
  assert.equal(withinOneEdit("heart", "heart"), true, "no edits at all");
  assert.equal(withinOneEdit("hard", "heart"), false, "two edits is two words");
  assert.equal(withinOneEdit("past", "paths"), false);
  assert.equal(MAX_EDITS, 1, "the tier is one edit, and the tests above assume it");
});

test("stem takes off one plural or third-person ending", () => {
  assert.equal(stem("sows"), "sow");
  assert.equal(stem("praises"), "prais");
  assert.equal(stem("heart"), "heart", "a word that does not end in one is untouched");
});

test("same() forgives a spelling, never a word", () => {
  assert.equal(same("sews", "sow"), true, "the case this exists for: a plural the recognizer invented");
  assert.equal(same("Jews", "Jew"), true);
  assert.equal(same("eagles'", "eagles"), true, "norm() drops the apostrophe");
  assert.equal(same("LORD", "Lord"), true, "and the case");
  assert.equal(same("us", "as"), false, `nothing under ${MIN_FUZZY_LEN} letters is forgiven`);
  assert.equal(same("he", "be"), false);
  assert.equal(same("", "heart"), false);
  assert.equal(same("heart", ""), false);
});

/* ── Double Metaphone ─────────────────────────────────────────────────────── */

/* The keys *this* port emits. The reduction is per-implementation, this
 * alphabet keeps B and P apart where Philips' own reference folds them, so a
 * change to any of these is a change to what the phonetic tier credits, which is
 * exactly why they are pinned rather than described. */
test("Double Metaphone keys are pinned", () => {
  const pins = {
    Naphtali: "NFTL",
    Zebulun: "SBLN",
    Jephthah: "JF0",
    Sheol: "XL",
    Christ: "KRST",
    Pharaoh: "FR",
    Jericho: "JRX",
    Rahab: "RHB",
    Abba: "AB",
    Midian: "MTN",
  };
  for (const [word, key] of Object.entries(pins)) {
    assert.equal(doubleMetaphone(word)[0], key, `${word} should key as ${key}`);
  }
});

test("the alternate key is the initial-J variant, and only that", () => {
  assert.deepEqual(doubleMetaphone("Jericho"), ["JRX", "ARX"]);
  assert.deepEqual(doubleMetaphone("Jephthah"), ["JF0", "AF0"]);
  assert.deepEqual(doubleMetaphone("Naphtali"), ["NFTL", "NFTL"], "no variant, so both keys agree");
});

test("Double Metaphone survives words it cannot key", () => {
  assert.deepEqual(doubleMetaphone(""), ["", ""]);
  assert.deepEqual(doubleMetaphone("123"), ["", ""]);
  assert.deepEqual(doubleMetaphone(null), ["", ""]);
});

test("the entry rules: a silent opening letter, and an initial X", () => {
  assert.equal(doubleMetaphone("gnat")[0], "NT");
  assert.equal(doubleMetaphone("knee")[0], "N");
  assert.equal(doubleMetaphone("wrath")[0], "R0");
  assert.equal(doubleMetaphone("psalm")[0], "SLM");
  assert.equal(doubleMetaphone("Xerxes")[0], "SRKSS", "only the *initial* X is an S; the later one is KS");
});

/* ── the phonetic tier, and what it is gated off ──────────────────────────── */

test("the phonetic tier rescues a misspelled name the edit tier cannot reach", () => {
  assert.equal(wordMatch("naftali", "Naphtali", { proper: true }), "phonetic", "PH → F, two edits apart");
  assert.equal(wordMatch("pharoah", "Pharaoh", { proper: true }), "phonetic");
  assert.equal(wordMatch("saira", "Sarah", { proper: true }), "phonetic");
});

test("names within one edit are caught by the edit tier first, which is strict-eligible", () => {
  assert.equal(wordMatch("zebulon", "Zebulun", { proper: true }), "edit");
  assert.equal(wordMatch("shiol", "Sheol", { proper: true }), "edit");
  assert.equal(wordMatch("midyan", "Midian", { proper: true }), "edit");
});

test("★ the phonetic tier never fires on an ordinary word, however alike it sounds", () => {
  /* The gate is the whole reason this tier is safe to ship. Measured over the
   * source app's own vocabulary, crediting on key equality alone admits 194
   * pairs at two edits; these are three of them, and every one is a word
   * somebody could genuinely have got wrong. */
  for (const [a, b] of [
    ["life", "love"],
    ["whole", "holy"],
    ["pleased", "blessed"],
  ]) {
    assert.equal(wordMatch(a, b, { proper: false }), null, `${a}/${b} must not be credited`);
    assert.equal(wordMatch(a, b, {}), null, "and the gate defaults to closed");
  }
});

test("the phonetic gate needs both words at least MIN_PHONETIC_LEN letters", () => {
  assert.ok(MIN_PHONETIC_LEN === 5 && MAX_PHONETIC_EDITS === 2);
  assert.equal(wordMatch("jews", "Jesus", { proper: true }), null, "jews is four letters");
});

test("the phonetic tier does not reach a genuinely different sound", () => {
  /* PH ≠ P and CH → X ≠ K are real distinctions in the algorithm rather than
   * defects in it. Two of the three are rescued anyway, one tier up, which is
   * the hybrid working as intended: edit distance asks whether these are two
   * transcriptions of one utterance, and on those two the answer is yes. */
  for (const [heard, name] of [
    ["jeptha", "Jephthah"],
    ["jerico", "Jericho"],
    ["enock", "Enoch"],
  ]) {
    const keys = doubleMetaphone(name);
    assert.ok(!doubleMetaphone(heard).some((k) => keys.includes(k)), `${heard} and ${name} must not share a key`);
  }
  assert.equal(wordMatch("jeptha", "Jephthah", { proper: true }), null, "and this one is an honest miss");
  assert.equal(wordMatch("jerico", "Jericho", { proper: true }), "edit", "while these two are one edit out");
  assert.equal(wordMatch("enock", "Enoch", { proper: true }), "edit");
});

test("every blocklisted pair is refused, in both directions", () => {
  for (const [a, b] of PHONETIC_BLOCK) {
    assert.equal(wordMatch(a, b, { proper: true }), null, `${a} → ${b} must not be credited`);
    assert.equal(wordMatch(b, a, { proper: true }), null, `${b} → ${a} must not be credited`);
  }
});

/* ── homophones ───────────────────────────────────────────────────────────── */

test("the curated homophone table is bidirectional", () => {
  for (const [a, b] of HOMOPHONES) {
    assert.equal(wordMatch(a, b), "homophone", `${a} → ${b}`);
    assert.equal(wordMatch(b, a), "homophone", `${b} → ${a}`);
  }
});

test("the table reaches the pairs no other tier can", () => {
  // Both are under MIN_FUZZY_LEN and under MIN_PHONETIC_LEN, so without an
  // explicit entry "no" is simply a miss.
  assert.equal(same("know", "no"), false, "the fuzzy tier is gated off by length");
  assert.equal(wordMatch("know", "no"), "homophone");
  // Two edits apart, so the fuzzy tier cannot reach these either.
  assert.equal(same("there", "their"), false);
  assert.equal(wordMatch("there", "their"), "homophone");
});

/* ── the predicate itself ─────────────────────────────────────────────────── */

test("wordMatch reports the strongest tier that applies", () => {
  assert.equal(wordMatch("Lord", "LORD"), "exact", "norm() settles case and punctuation");
  assert.equal(wordMatch("heart,", "heart"), "exact");
  assert.equal(wordMatch("here", "hear"), "homophone");
  assert.equal(wordMatch("sews", "sows"), "edit");
  assert.equal(wordMatch("hard", "heart"), null, "a genuinely different word is not a match");
  assert.equal(wordMatch("past", "paths"), null);
});

test("wordMatch says nothing about a word with nothing in it", () => {
  assert.equal(wordMatch("", "heart"), null);
  assert.equal(wordMatch("heart", ""), null);
  assert.equal(wordMatch("...", "heart"), null, "punctuation alone normalizes to nothing");
});
