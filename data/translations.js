/* The translations this app knows how to ship, and what each one obliges us to
 * say when we show it.
 *
 * This is the one file in data/ that is written by hand rather than generated,
 * and that is deliberate: it is a table of facts about texts and their licences
 * rather than anything a fetch could work out, and `notice` in particular is a
 * legal string that must survive every regeneration byte for byte. Its
 * generated counterpart is `data/translation.js`, which records which of these
 * entries the shipped `data/passages.js` actually holds, the table says what
 * is possible, that file says what is true of this build.
 *
 * Why the app is pluggable at all: it began as one church's tool and shipped
 * ESV under Crossway's API terms, which cap how much of their text may be
 * stored and displayed (test/passages.test.mjs asserts both caps over the
 * shipped set). That is fine for the congregation the key was issued to and
 * wrong for anything a stranger clones, a fork cannot lawfully redistribute
 * ESV at will and has no API key to fetch it with either. A public-domain
 * default is what makes the repo runnable by somebody who is not us.
 *
 * **Choosing a translation is a product decision, not a data-source one, and
 * it is worth saying so plainly.** This app asks a member to reproduce a
 * passage word for word, so the wording *is* the thing being learned: a set
 * regenerated in another translation is a different set of verses to memorize,
 * not the same verses fetched from somewhere cheaper. The sharpest instance is
 * the divine name, the WEB prints "Yahweh" where the ESV and the KJV print
 * "the LORD", so Proverbs 3:5 comes back as "Trust in Yahweh with all your
 * heart", and a congregation that recites the older wording aloud together
 * will notice on the first card. Neither rendering is the better one; a
 * deployer simply needs to know the difference exists before picking, which is
 * what this comment is for and what tools/fetch_passages.mjs prints before it
 * starts.
 *
 * Each entry is { id, name, abbrev, publicDomain, notice, source }:
 *
 *   id           what --translation / $TRANSLATION is matched against, and, for
 *                everything but ESV, the `translation=` parameter bible-api.com
 *                is asked for;
 *   name         the full name, as the text's own publisher writes it;
 *   abbrev       the short form, for anywhere a line has no room for the name;
 *   publicDomain whether a fork may redistribute the fetched text freely, which
 *                is what decides whether test/passages.test.mjs applies
 *                Crossway's storage caps to the shipped set;
 *   notice       what the footer prints under every signed-in screen. For ESV
 *                this is a licence requirement and is reproduced verbatim; for
 *                the public-domain texts it is ordinary honest attribution,
 *                which nobody compels but which costs a line and tells a member
 *                what they are reading;
 *   source       where the text came from, for anybody auditing the set later.
 */

export const translations = [
  {
    id: "esv",
    name: "English Standard Version",
    abbrev: "ESV",
    publicDomain: false,
    /* Crossway's required wording, copied character for character out of
     * src/copy.js where it lived before the footer read it from the data. Do
     * not reword, re-punctuate, or "tidy" the registered marks: the permission
     * to show their text is conditional on this sentence appearing wherever the
     * text does. */
    notice:
      "Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), " +
      "© 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.",
    source: "https://api.esv.org/v3/passage/text/",
  },
  {
    /* The default for anyone deploying their own copy. A modern-English
     * revision of the ASV released into the public domain outright, so a fork
     * may ship it, edit it, and hand it on without asking anybody, which is
     * the whole point of having a default that is not ESV. Prints "Yahweh" for
     * the divine name (see above). */
    id: "web",
    name: "World English Bible",
    abbrev: "WEB",
    publicDomain: true,
    notice: "Scripture quotations are from the World English Bible, which is in the public domain.",
    source: "https://bible-api.com",
  },
  {
    /* The familiar one. Its English is four centuries old, which cuts both
     * ways for memorization, the cadence is what half of these passages are
     * already carried in, and the second-person verbs are a real obstacle for a
     * member who has never recited any of it before.
     *
     * One honest wrinkle behind `publicDomain: true`: the KJV is in the public
     * domain in the United States and almost everywhere else, but in the United
     * Kingdom it remains under perpetual Crown letters patent administered by
     * Cambridge University Press. bible-api.com serves it as public domain and
     * that is the basis on which we fetch it; a deployer publishing from the UK
     * should satisfy themselves separately rather than take this flag for an
     * answer. */
    id: "kjv",
    name: "King James Version",
    abbrev: "KJV",
    publicDomain: true,
    notice: "Scripture quotations are from the King James Version, which is in the public domain.",
    source: "https://bible-api.com",
  },
  {
    /* The 1901 revision the WEB was later made from, and the middle road
     * between the two: older diction than the WEB, plainer than the KJV. It
     * renders the divine name as "Jehovah", so it differs from both of the
     * others on exactly the words a member says most often. */
    id: "asv",
    name: "American Standard Version (1901)",
    abbrev: "ASV",
    publicDomain: true,
    notice: "Scripture quotations are from the American Standard Version (1901), which is in the public domain.",
    source: "https://bible-api.com",
  },
];

/* Everything that is not ESV is fetched from bible-api.com, which needs no key
 * and takes the id straight through as its `translation=` parameter. Written as
 * a property of the source rather than a list of ids so that adding a
 * public-domain text above is a one-entry change. */
export const BIBLE_API = "https://bible-api.com";

export const translationById = (id) => translations.find((t) => t.id === id) || null;
