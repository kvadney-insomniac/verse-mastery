/* The one shared helper the scorer is built on.
 *
 * `recital.js` and `wordmatch.js` both compare through `norm`, and they compare
 * through the *same* `norm` deliberately: two graders that normalize differently
 * are two graders that will eventually disagree about whether a word was said.
 * This file is the part of the source app's `src/text.js` those two modules
 * import; the rest of that file is dates and display helpers a scorer has no use
 * for. The comment below is the original's, unchanged.
 */

/* Normalize a word for comparison: lowercase, keep only letters and digits.
 * Used to grade typed answers and fill-in blanks.
 *
 * Apostrophes go with the rest of the punctuation, so "eagles", "eagles'" and
 * "eagle's" are one word here. That is not a leniency so much as the only
 * defensible reading: a member reciting a passage aloud does not pronounce an
 * apostrophe, and one typing it cannot tell from the sound of the verse where
 * it belongs. It also closes a straight-vs-curly trap, ESV text carries the
 * typographic ’ (already stripped), while a keyboard produces ', so "eagles’"
 * and "eagles'" used to grade as different words. */
export const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
