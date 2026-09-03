/* Fetch passage text and fold it into data/passages.js, in whichever
 * translation this build is meant to ship.
 *
 * This runs ONCE, by hand, at authoring time -- it is an offline generator in
 * the same mould as tools/gen_keywords.py, not something the app ever calls.
 * The text it writes is committed and shipped as a static ES module, so a
 * member's browser never touches an API and there is no key in the build.
 *
 *   ESV_API_KEY=... node tools/fetch_passages.mjs [--dry-run]
 *   node tools/fetch_passages.mjs --translation web
 *   TRANSLATION=kjv node tools/fetch_passages.mjs
 *
 * The default is `esv`, so a run with no flag does exactly what this script has
 * always done. Everything the tool will accept is listed in
 * data/translations.js; an id that is not in that table is refused before a
 * single request goes out.
 *
 * WHAT GETS FETCHED depends on whether this run changes the translation.
 * Refreshing or extending the set in the translation it is already in fetches
 * tools/new-passages.json and nothing else, which is the behaviour this script
 * has always had -- a ref already present in data/passages.js is refreshed in
 * place rather than added twice, so it is safe to re-run. **Switching
 * translation re-fetches every ref in the set**, because half a set in one
 * translation and half in another is not a set anybody can memorize, and a
 * mixed file has no honest answer to put in data/translation.js.
 *
 * ESV API v3 terms this script is written to keep (see README):
 *   - the key comes from the environment and is never written to the repo;
 *   - one request per ref, spaced by THROTTLE_MS, well inside 60/min;
 *   - each request is a handful of verses, nowhere near the 500-verse cap.
 * The storage limits -- half a book, 500 consecutive verses -- are asserted
 * over the whole shipped set by test/passages.test.mjs, which is the honest
 * place for them: they are a property of what we ship, not of one fetch. Those
 * assertions are Crossway's and are gated on the shipped translation being
 * ESV, since a public-domain text is under no such cap.
 *
 * bible-api.com serves every public-domain translation in the table. It needs
 * no key and asks for no registration, which is precisely why it is the
 * default path: a fork can run this the minute it is cloned. It is also
 * somebody's free service, so requests are spaced (BIBLE_API_THROTTLE_MS) even
 * though nothing forces us to.
 *
 * Nothing is written until every fetch has come back. A run that dies halfway
 * leaves the committed set exactly as it found it, which matters more here than
 * usual: a partly-rewritten passages.js is a file where the translation is
 * whatever each record happened to be caught in.
 */

import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { translations, translationById, BIBLE_API } from "../data/translations.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PASSAGES_JS = join(ROOT, "data", "passages.js");
const TRANSLATION_JS = join(ROOT, "data", "translation.js");
const KEYWORDS_JS = join(ROOT, "data", "keywords.js");
const MANIFEST = join(ROOT, "tools", "new-passages.json");

/* Spacing between requests. The ESV published limit is 60 a minute; a second
 * apiece leaves the whole manifest comfortably inside it and finishes in
 * under a minute either way. bible-api.com publishes no limit at all, which is
 * a reason to be careful rather than a licence to hammer it -- a third of a
 * second still walks the whole 187-passage set in about a minute. */
const THROTTLE_MS = 1100;
const BIBLE_API_THROTTLE_MS = 1200;
/* How many times a rate-limited request is asked again before giving up, and
 * the first wait, doubling each time, so the last is around a minute. */
const RETRY_LIMIT = 6;
const RETRY_BASE_MS = 2000;

/* Everything off except the verse numbers, which are the only thing in the
 * response we actually read -- they are what cuts the passage into verses. */
const OPTIONS = {
  "include-verse-numbers": "true",
  "include-first-verse-numbers": "true",
  "include-headings": "false",
  "include-footnotes": "false",
  "include-passage-references": "false",
  "include-short-copyright": "false",
  "include-selahs": "false",
  "indent-poetry": "false",
  "indent-paragraphs": "0",
  "indent-using": "space",
};

/* What blanks.chunksFor() needs before it will cut a passage by verse rather
 * than by punctuation. Below it the array is dead weight in the shipped file,
 * which is why the public-domain path only carries one where it earns its
 * place; the ESV path has always written one unconditionally and is left
 * alone. */
const MIN_VERSES_TO_CUT = 3;

/* data/passages.js is a single JSON array literal, and has to stay one:
 * tools/gen_keywords.py reads it by slicing between the first "[" and the last
 * "]" and handing that to json.loads. So we parse and re-emit the same way
 * rather than treating it as JavaScript. It is also the reason the record of
 * which translation this is lives in its own file -- see data/translation.js. */
async function readPassages() {
  const src = await readFile(PASSAGES_JS, "utf8");
  return JSON.parse(src.slice(src.indexOf("["), src.lastIndexOf("]") + 1));
}

const emit = (passages) => "export const passages = " + JSON.stringify(passages) + ";\n";

/* ── which translation, and which one is already shipped ──────────────────── */

/* --translation web, --translation=web, or TRANSLATION=web, in that order of
 * precedence. The default is deliberately esv: this script's oldest caller is
 * somebody topping up the church's own set, and a flag they have never heard
 * of must not change what they get. */
function chosenTranslation(argv) {
  const eq = argv.find((a) => a.startsWith("--translation="));
  if (eq) return eq.slice("--translation=".length);
  const i = argv.indexOf("--translation");
  if (i !== -1) {
    if (!argv[i + 1] || argv[i + 1].startsWith("--")) fail("--translation needs a value, e.g. --translation web");
    return argv[i + 1];
  }
  return process.env.TRANSLATION || "esv";
}

/* What data/translation.js currently claims the committed set is. A missing or
 * unreadable file is read as ESV rather than as an error, because that is what
 * every copy of this repo held before the file existed and guessing wrong in
 * that direction only means re-fetching a set that was already right. */
async function shippedTranslationId() {
  try {
    const mod = await import(new URL("../data/translation.js", import.meta.url));
    return mod.translation?.id || "esv";
  } catch {
    return "esv";
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

/* ── the two fetch paths ──────────────────────────────────────────────────── */

/* One ESV passage's text, cut into verses.
 *
 * The response is a flat string with "[n]" before each verse and newlines
 * wherever the poetry setting laid one out. Two things matter:
 *
 * Anything before the first marker is dropped. A psalm carries a
 * superscription ("A Psalm of David.", "A Maskil of David.") which is printed
 * ahead of verse 1 and is not part of it -- kept, it would be graded as words
 * the member has to recall.
 *
 * Whitespace inside a verse collapses to a single space, because
 * data/keywords.js indexes words by text.split(" ") and a newline would put a
 * blank token in the middle of the passage. */
function versesFrom(passage) {
  const parts = passage.split(/\[\d+\]/);
  return parts
    .slice(1)
    .map((v) => v.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

async function fetchEsv(ref, key) {
  const url = new URL("https://api.esv.org/v3/passage/text/");
  url.searchParams.set("q", ref);
  for (const [k, v] of Object.entries(OPTIONS)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: { Authorization: "Token " + key } });
  if (!res.ok) throw new Error(`${ref}: HTTP ${res.status} ${await res.text()}`);
  const body = await res.json();
  const text = (body.passages || [])[0];
  if (!text) throw new Error(`${ref}: no passage in response (canonical: ${body.canonical || "none"})`);

  const verses = versesFrom(text);
  if (!verses.length) throw new Error(`${ref}: no verse markers found`);
  return { canonical: body.canonical, verses, always: true };
}

/* One passage from bible-api.com, which hands back the verses already split --
 * an array of { book_name, chapter, verse, text } -- so there is no marker to
 * parse and no superscription to drop. What it does hand back is the
 * publisher's line breaks: poetry arrives with newlines inside a verse and the
 * older texts with runs of spaces where a typesetter had a column to fill. All
 * of it collapses to single spaces for the same reason the ESV path collapses
 * it, and that reason is worth restating because it is the invariant the whole
 * data layer rests on: `text` is indexed by text.split(" "), so a newline or a
 * double space is an empty token sitting in the middle of the passage that
 * data/keywords.js, blanks.js and the recital scorer all count as a word. */
/* A reference naming half a verse, "Isaiah 55:1-3a", "Zechariah 4:6b", is a
 * convention the ESV API understands and bible-api.com does not: it answers a
 * trailing letter with a 404. Four of the shipped passages are written that
 * way, and there is no honest way to ask a service for half a verse it has no
 * notion of, so the letter is dropped and the whole verse fetched.
 *
 * That means a public-domain build carries a little MORE text than the ESV set
 * does for exactly those four, which is a difference worth printing rather than
 * swallowing: somebody memorizing "Zechariah 4:6b" from this build would learn
 * the whole of verse 6. It is flagged in the run's output for that reason. */
const PARTIAL_VERSE = /(\d+)[ab](?=\b|$)/g;
const wholeVerses = (ref) => ref.replace(PARTIAL_VERSE, "$1");

async function fetchBibleApi(ref, translation) {
  const asked = wholeVerses(ref);
  const query = asked
    .trim()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, "+");
  const url = `${BIBLE_API}/${encodeURI(query)}?translation=${encodeURIComponent(translation.id)}`;

  /* bible-api.com is one person's free service and it rate-limits, which a
   * fixed delay cannot answer: switching the whole set is nearly two hundred
   * requests, and measured against the live service a steady 350ms starts
   * drawing HTTP 429 ("Retry later") after about fourteen of them. Since every
   * fetch must succeed before anything is written, one 429 two-thirds of the
   * way through would otherwise throw the whole run away.
   *
   * So a 429 is not a failure, it is the service asking for room: wait, and
   * wait longer each time, and only give up once it has been asked for and
   * refused several times over. The waits are deliberately generous, a
   * translation switch is a thing somebody does once, and being slow and
   * certain beats being quick and half-finished. */
  let res;
  let raw;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url);
    raw = await res.text();
    if (res.status !== 429 && res.status !== 503) break;
    if (attempt >= RETRY_LIMIT)
      throw new Error(
        `${ref}: ${BIBLE_API} is still rate-limiting after ${RETRY_LIMIT + 1} attempts (HTTP ${res.status}). ` +
          `Nothing has been written. Wait a few minutes and run it again.`,
      );
    const wait = RETRY_BASE_MS * 2 ** attempt;
    console.log(`  … ${ref}: rate-limited, waiting ${Math.round(wait / 1000)}s (attempt ${attempt + 1})`);
    await sleep(wait);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    /* A rejected translation id answers with nginx's HTML 404 rather than
     * JSON, which is why the id is checked against the table before any of
     * this runs; this is the belt to that pair of braces. */
    throw new Error(`${ref}: ${url} did not return JSON (HTTP ${res.status}): ${raw.slice(0, 120)}`);
  }
  if (!res.ok || body.error) throw new Error(`${ref}: HTTP ${res.status} ${body.error || raw.slice(0, 120)}`);
  if (body.translation_id && body.translation_id !== translation.id)
    throw new Error(`${ref}: asked for ${translation.id} and was served ${body.translation_id}`);

  const verses = (body.verses || [])
    .map((v) =>
      String(v.text || "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  if (!verses.length) throw new Error(`${ref}: no verses in response`);
  if (asked !== ref) console.log(`  … ${ref}: fetched as ${asked}, this build carries the whole verse`);

  return {
    canonical: body.reference || ref,
    verses,
    /* Only worth carrying when chunksFor() will actually cut on it. */
    always: false,
    name: body.translation_name,
    note: body.translation_note,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── the three files this writes ──────────────────────────────────────────── */

const emitTranslation = (translation, generatedAt) =>
  `/* Which translation the shipped data/passages.js is actually in.\n` +
  ` *\n` +
  ` * Generated by tools/fetch_passages.mjs alongside data/passages.js -- do not\n` +
  ` * hand-edit. It is a file of its own because data/passages.js must stay a\n` +
  ` * single JSON array literal: tools/gen_keywords.py reads that file by slicing\n` +
  ` * between the first "[" and the last "]" and handing the slice to json.loads,\n` +
  ` * so a second export in it lands inside the slice and kills the generator.\n` +
  ` *\n` +
  ` * src/views/footer.js prints \`notice\` under every signed-in screen, and\n` +
  ` * test/passages.test.mjs applies Crossway's storage caps only when \`id\` is\n` +
  ` * "esv" -- those caps are Crossway's licence terms, not a rule about\n` +
  ` * scripture. \`notice\` is copied from data/translations.js rather than\n` +
  ` * imported, so that this stays a record of what was fetched; the two are\n` +
  ` * asserted equal in test/passages.test.mjs. */\n` +
  `export const translation = ${JSON.stringify(
    {
      id: translation.id,
      name: translation.name,
      notice: translation.notice,
      publicDomain: translation.publicDomain,
      generatedAt,
    },
    null,
    2,
  )};\n`;

/* THE KEYWORD TRAP, and why this function exists at all.
 *
 * data/keywords.js holds, per passage, a list of word indices **aligned to
 * text.split(" ")** -- position 14 of this passage, position 31 of that one --
 * and src/blanks.js *prefers* those precomputed indices, falling back to its
 * lexical heuristic only for a passage that has none. Nothing in either file
 * records which text the indices were computed from.
 *
 * So the moment a passage's text is rewritten -- a refreshed ref, and above all
 * a whole set refetched in another translation -- every index attached to it
 * points at a word that has moved or is no longer there. The failure is silent
 * and it is worse than having no data: blanks.js will confidently blank the
 * wrong words, out of a file that looks perfectly well-formed, and the only
 * symptom is a member being asked to recall "the" while "righteousness" sits
 * there in plain sight. **Stale indices are strictly worse than absent ones**,
 * because absent ones fall through to a heuristic that is at least computed
 * from the text in front of it.
 *
 * Hence the rule this script keeps, without asking: no run may leave an index
 * from one text attached to another. It prunes every rewritten id out of
 * data/keywords.js FIRST -- so the safe, empty-for-those-passages state is on
 * disk before anything can go wrong -- and only then tries to regenerate the
 * whole file properly with spaCy. If spaCy is not installed, or the model is
 * missing, or the generator throws, the pruned file is what stands, blanks.js
 * uses its heuristic for those passages, and the operator is told in plain
 * words to run `npm run keywords` when they have spaCy. The one outcome that
 * cannot happen is the silent one.
 *
 * test/passages.test.mjs asserts the invariant from the other end: every
 * keyword index must be inside its own passage's word count, and no keyword
 * entry may name a passage the set no longer holds. */
function emitKeywords(indices) {
  const body = Object.entries(indices)
    .map(([id, idx]) => `  "${id}": ${JSON.stringify(idx)}`)
    .join(",\n");
  return (
    "/* Pruned by tools/fetch_passages.mjs after a passage refetch, then normally\n" +
    "   regenerated by tools/gen_keywords.py using spaCy (en_core_web_sm).\n" +
    "   Per-passage content-word indices (aligned to text.split(' ')), ordered\n" +
    "   most-important first. Do not edit by hand -- re-run the generator.\n" +
    "\n" +
    "   A passage missing from this map is not an error: src/blanks.js falls back\n" +
    "   to its lexical heuristic. That is exactly what refetching drops a passage\n" +
    "   to, because an index computed against one translation's wording silently\n" +
    "   blanks the wrong word in another's. Run `npm run keywords` to fill it in\n" +
    "   again. */\n" +
    "export const keywordIndices = {\n" +
    body +
    "\n};\n"
  );
}

async function readKeywords() {
  try {
    const mod = await import(new URL("../data/keywords.js", import.meta.url));
    return { ...mod.keywordIndices };
  } catch {
    return {};
  }
}

/* Prune first, regenerate second -- see the trap above for why that order is
 * the whole point rather than a matter of taste.
 *
 * Two kinds of entry come out: the ones whose passage was just rewritten, which
 * is the trap itself, and the ones naming a passage the set no longer holds at
 * all. The second kind cannot mis-blank anything, since nothing looks it up,
 * but it is the same mistake one step further along -- indices outliving the
 * text they were computed from -- and leaving it would fail the assertion in
 * test/passages.test.mjs that keeps the two files honest about each other. */
async function settleKeywords(rewrittenIds, liveIds) {
  const indices = await readKeywords();
  const stale = new Set(rewrittenIds.map(String));
  let dropped = 0;
  let orphaned = 0;
  for (const id of Object.keys(indices)) {
    if (stale.has(id)) {
      delete indices[id];
      dropped++;
    } else if (!liveIds.has(id)) {
      delete indices[id];
      orphaned++;
    }
  }
  if (orphaned)
    console.log(`Dropped ${orphaned} keyword entr${orphaned === 1 ? "y" : "ies"} for passages that are gone.`);
  await writeFile(KEYWORDS_JS, emitKeywords(indices), "utf8");
  console.log(`\nPruned data/keywords.js: dropped ${dropped} passage${dropped === 1 ? "" : "s"} whose text changed.`);

  const run = spawnSync("python3", [join(ROOT, "tools", "gen_keywords.py")], { encoding: "utf8" });
  if (run.status === 0) {
    console.log((run.stdout || "").trim() || "Regenerated data/keywords.js with spaCy.");
    return;
  }
  const why = (run.stderr || run.error?.message || "").trim().split("\n").slice(-1)[0] || "spaCy is not available";
  console.log(`Could not regenerate the keywords (${why}).`);
  console.log("The blanks for those passages will use the lexical fallback in src/blanks.js until you run:");
  console.log("  npm run keywords");
}

/* ── the run ──────────────────────────────────────────────────────────────── */

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const wanted = chosenTranslation(process.argv.slice(2));
  const translation = translationById(wanted);
  if (!translation) {
    console.error(`Unknown translation "${wanted}". data/translations.js knows:`);
    for (const t of translations)
      console.error(`  ${t.id.padEnd(6)} ${t.name}${t.publicDomain ? " (public domain)" : ""}`);
    process.exit(1);
  }

  const key = process.env.ESV_API_KEY;
  if (translation.id === "esv" && !key) {
    console.error("ESV_API_KEY is not set. Get a key at https://api.esv.org/account/ and pass it in the environment:");
    console.error("  ESV_API_KEY=... node tools/fetch_passages.mjs");
    console.error("");
    console.error("Or ship a public-domain text instead, which needs no key at all:");
    console.error("  node tools/fetch_passages.mjs --translation web");
    process.exit(1);
  }

  const shipped = await shippedTranslationId();
  const switching = shipped !== translation.id;

  console.log(
    `Translation: ${translation.name} (${translation.abbrev})${translation.publicDomain ? "" : ", licensed"}`,
  );
  if (switching) {
    /* Said before a single request goes out, because this is the point at
     * which somebody can still change their mind cheaply. The wording is
     * descriptive on purpose: which translation a congregation recites is
     * theirs to decide, and the tool's only job is to make sure the decision
     * is made with the difference in view rather than discovered on a card. */
    console.log(`Switching the whole set from ${shipped}, every ref will be refetched.`);
    console.log("The wording is what members memorize, so this changes the verses themselves, not just the source.");
    console.log('The WEB prints "Yahweh" where the ESV and KJV print "the LORD"; the ASV prints "Jehovah".');
    console.log("");
  }

  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const passages = await readPassages();
  const byRef = new Map(passages.map((p) => [p.ref, p]));

  /* What to fetch. In the translation the set is already in, that is the
   * manifest and nothing else -- the behaviour this script has always had. On
   * a switch it is every ref already committed (carrying its own id, book,
   * testament, category and group forward, since those are authored facts
   * about the passage and not properties of the text) followed by whatever the
   * manifest adds on top. A manifest entry for a ref already present wins,
   * because it is the more recently authored description of it. */
  const targets = [];
  if (switching) for (const p of passages) targets.push(manifestOrRecord(manifest, p));
  for (const entry of manifest.passages) if (!switching || !byRef.has(entry.ref)) targets.push(entry);

  const throttle = translation.id === "esv" ? THROTTLE_MS : BIBLE_API_THROTTLE_MS;

  /* Everything is fetched before anything is written. A network that gives out
   * on ref 140 of 187 must leave the committed set alone rather than half
   * translated. */
  const fetched = [];
  for (const [i, entry] of targets.entries()) {
    if (i) await sleep(throttle);
    const got = translation.id === "esv" ? await fetchEsv(entry.ref, key) : await fetchBibleApi(entry.ref, translation);
    fetched.push([entry, got]);
    console.log(
      `${entry.ref.padEnd(24)} ${String(got.verses.length).padStart(2)} verses  ` +
        `${String(got.verses.join(" ").split(" ").length).padStart(4)} words  (${got.canonical})`,
    );
  }

  let nextId = Math.max(...passages.map((p) => p.id)) + 1;
  const rewritten = [];
  let added = 0;
  let refreshed = 0;

  for (const [entry, got] of fetched) {
    const existing = byRef.get(entry.ref);
    const record = {
      id: existing ? existing.id : nextId++,
      ref: entry.ref,
      book: entry.book,
      // Kept alongside `verses` rather than derived at import: gen_keywords.py
      // reads this file as plain JSON and indexes `text`, and the app's grading
      // has always worked on the flat string.
      text: got.verses.join(" "),
      testament: entry.testament,
      category: entry.category,
      ...(entry.group ? { group: entry.group } : {}),
      // What a verse-level "Order the phrases" cuts on (see blanks.chunksFor).
      ...(got.always || got.verses.length >= MIN_VERSES_TO_CUT ? { verses: got.verses } : {}),
    };

    if (existing) {
      passages[passages.indexOf(existing)] = record;
      refreshed++;
    } else {
      passages.push(record);
      byRef.set(record.ref, record);
      added++;
    }
    rewritten.push(record.id);
  }

  if (dryRun) {
    console.log(`\n--dry-run: would add ${added} and refresh ${refreshed}; nothing in data/ was touched.`);
    console.log(`--dry-run: data/translation.js would record ${translation.id}, and ${rewritten.length} passages`);
    console.log("--dry-run: would have their keyword indices dropped or regenerated (see THE KEYWORD TRAP).");
    return;
  }

  await writeFile(PASSAGES_JS, emit(passages), "utf8");
  console.log(`\nWrote data/passages.js: ${passages.length} passages (${added} added, ${refreshed} refreshed).`);

  await writeFile(TRANSLATION_JS, emitTranslation(translation, new Date().toISOString()), "utf8");
  console.log(`Wrote data/translation.js: ${translation.id}, the footer's notice now comes from there.`);

  await settleKeywords(rewritten, new Set(passages.map((p) => String(p.id))));
}

/* A manifest entry for a ref that is already committed describes it better
 * than the committed record does, since it is the authored source; failing
 * that, the record describes itself. Either way the text is about to be
 * replaced and only the surrounding facts are being carried over. */
function manifestOrRecord(manifest, p) {
  const entry = manifest.passages.find((e) => e.ref === p.ref);
  if (entry) return entry;
  return {
    ref: p.ref,
    book: p.book,
    testament: p.testament,
    category: p.category,
    ...(p.group ? { group: p.group } : {}),
  };
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
