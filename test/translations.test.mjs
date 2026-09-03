/* The translation table: that it is well formed, and that the one entry a
 * lawyer cares about is byte-for-byte what the licence requires.
 *
 * data/translations.js is the only hand-written file in data/, which is why it
 * is worth a test file of its own, everything else in there is regenerated
 * from a source that will not accept a typo, and this one will. Two of its
 * fields carry more weight than they look like they do. `notice` is what
 * src/views/footer.js prints under every signed-in screen, so an entry with an
 * empty one is a build that shows scripture and says nothing about where it
 * came from. And `publicDomain` is what test/passages.test.mjs consults before
 * applying Crossway's storage caps, so a string "false", perfectly truthy,
 * would switch those caps off on an ESV build without anything failing.
 *
 * The ESV notice is asserted as a literal rather than compared against
 * src/copy.js or anything else that could drift with it. A test that checks a
 * string against a copy of itself proves nothing; this one is the licence text
 * written out a second time, on purpose, so that editing either half is a
 * visible disagreement rather than a quiet edit that carries the test along
 * with it. */

import test from "node:test";
import assert from "node:assert";

import { translations, translationById, BIBLE_API } from "../data/translations.js";

/* Copied out of Crossway's terms, not out of the table it checks. */
const ESV_NOTICE =
  "Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), " +
  "© 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.";

test("the table is a non-empty list of well-formed entries", () => {
  assert.ok(Array.isArray(translations) && translations.length > 0, "there are no translations to choose from");
  const ids = new Set();
  for (const t of translations) {
    assert.ok(t.id && typeof t.id === "string", "a translation has no id");
    assert.ok(!ids.has(t.id), `duplicate translation id ${t.id}`);
    ids.add(t.id);
    assert.equal(t.id, t.id.toLowerCase(), `${t.id} should be lower case, it is matched against a CLI flag`);
    assert.ok(t.name && typeof t.name === "string", `${t.id} has no name`);
    assert.ok(t.abbrev && typeof t.abbrev === "string", `${t.id} has no abbreviation`);
    assert.ok(/^https:\/\//.test(t.source || ""), `${t.id} has no https source`);
  }
});

test("every entry carries a notice that says something", () => {
  for (const t of translations) {
    assert.equal(typeof t.notice, "string", `${t.id}'s notice is not a string`);
    assert.ok(t.notice.trim().length > 20, `${t.id}'s notice is too short to attribute anything`);
    assert.equal(t.notice, t.notice.trim(), `${t.id}'s notice has stray whitespace around it`);
    assert.match(t.notice, /Scripture/i, `${t.id}'s notice does not read as an attribution line`);
  }
});

/* Not `assert.ok(t.publicDomain !== undefined)`: the point is the type. This
 * flag decides whether a licence is enforced, and every wrong-typed value that
 * could get in here, "false", 0, null, is one that answers the question
 * confidently and wrongly. */
test("publicDomain is a boolean on every entry", () => {
  for (const t of translations) {
    assert.equal(typeof t.publicDomain, "boolean", `${t.id}'s publicDomain is ${typeof t.publicDomain}, not a boolean`);
  }
});

test("the ESV entry is licensed and carries Crossway's exact wording", () => {
  const esv = translationById("esv");
  assert.ok(esv, "the table has lost its ESV entry");
  assert.equal(esv.publicDomain, false, "the ESV is not public domain");
  assert.equal(esv.notice, ESV_NOTICE, "the ESV notice no longer matches the wording the licence requires");
});

/* The reason this whole seam exists: a fork with no API key and no licence has
 * to have something to run on. */
test("at least one public-domain translation is offered, and the WEB is one of them", () => {
  const free = translations.filter((t) => t.publicDomain);
  assert.ok(free.length > 0, "there is no translation a fork could lawfully ship");
  const web = translationById("web");
  assert.ok(web, "the World English Bible is the documented default and is missing");
  assert.equal(web.publicDomain, true);
  assert.equal(web.source, BIBLE_API);
});

test("the public-domain entries are all fetched from bible-api.com", () => {
  for (const t of translations) {
    if (t.id === "esv") continue;
    assert.equal(t.source, BIBLE_API, `${t.id} claims a source tools/fetch_passages.mjs cannot fetch from`);
  }
});

test("translationById refuses an id the table does not hold", () => {
  assert.equal(translationById("niv"), null);
  assert.equal(translationById(""), null);
  assert.equal(translationById(undefined), null);
});
