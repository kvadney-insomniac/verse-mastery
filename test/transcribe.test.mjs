/* The Worker's pure parts.
 *
 * `providerFor` and `wordsOf` are the two pieces of worker/transcribe.js that
 * take plain values and answer without a network, a binding or a key, so they
 * are the two worth pinning here, the same split test/transcriber.test.mjs
 * makes on the client side of the same route.
 *
 * The precedence assertions are the point of the first block. Which provider a
 * deploy picks is decided by which secrets happen to be present, which is
 * exactly the kind of rule that drifts silently when a third one is added. */

import test from "node:test";
import assert from "node:assert/strict";

import { PROVIDERS, providerFor, wordsOf } from "../worker/transcribe.js";

test("providerFor takes TRANSCRIBE_PROVIDER over anything the environment implies", () => {
  assert.equal(providerFor({ TRANSCRIBE_PROVIDER: "assemblyai", AI: {}, GROQ_API_KEY: "k" }), "assemblyai");
  assert.equal(providerFor({ TRANSCRIBE_PROVIDER: "groq", AI: {} }), "groq");
});

test("providerFor reads a named provider case-insensitively", () => {
  assert.equal(providerFor({ TRANSCRIBE_PROVIDER: "AssemblyAI", ASSEMBLYAI_API_KEY: "k" }), "assemblyai");
});

test("providerFor ignores a name no provider answers to", () => {
  assert.equal(providerFor({ TRANSCRIBE_PROVIDER: "deepgram", GROQ_API_KEY: "k" }), "groq");
});

test("providerFor prefers the binding with no secret in it", () => {
  assert.equal(providerFor({ AI: {}, GROQ_API_KEY: "k", ASSEMBLYAI_API_KEY: "k" }), "workersai");
});

test("providerFor falls to AssemblyAI only when it is the one key present", () => {
  assert.equal(providerFor({ ASSEMBLYAI_API_KEY: "k" }), "assemblyai");
  assert.equal(providerFor({ GROQ_API_KEY: "k", ASSEMBLYAI_API_KEY: "k" }), "groq");
});

test("providerFor answers an empty environment with nothing to call", () => {
  assert.equal(providerFor({}), "");
  assert.equal(providerFor(undefined), "");
});

test("wordsOf splits a vocab written with spaces", () => {
  assert.deepEqual(wordsOf("Melchizedek Zerubbabel thy"), ["Melchizedek", "Zerubbabel", "thy"]);
});

test("wordsOf splits a vocab written with commas, and one written with both", () => {
  assert.deepEqual(wordsOf("Melchizedek,Zerubbabel"), ["Melchizedek", "Zerubbabel"]);
  assert.deepEqual(wordsOf("Melchizedek, Zerubbabel,  thy"), ["Melchizedek", "Zerubbabel", "thy"]);
});

test("wordsOf drops the empties a trailing separator leaves behind", () => {
  assert.deepEqual(wordsOf("  thy,  , steadfast, "), ["thy", "steadfast"]);
});

test("wordsOf answers an unset vocab with a list nothing needs to guard", () => {
  assert.deepEqual(wordsOf(""), []);
  assert.deepEqual(wordsOf(undefined), []);
  assert.deepEqual(wordsOf(null), []);
});

test("wordsOf caps a vocab that has run away", () => {
  const many = Array.from({ length: 1500 }, (_, i) => "w" + i).join(" ");
  assert.equal(wordsOf(many).length, 1000);
});

/* The two keyed providers refuse before they call anybody.
 *
 * These reach into PROVIDERS rather than the fetch handler and still touch no
 * network, because refusing is the whole of what they do here: the guard runs
 * before the first request is built. The assertion worth having is on the
 * message, not the throw. A provider that fails without naming the binding
 * sends whoever is reading the log to the upstream error table, and an
 * unbound key arrives there disguised as a bad one. */
test("the keyed providers name the binding they were not given", async () => {
  await assert.rejects(() => PROVIDERS.assemblyai({}, new Uint8Array(1), "audio/wav", ""), {
    message: "no ASSEMBLYAI_API_KEY binding",
  });
  await assert.rejects(() => PROVIDERS.groq({}, new Uint8Array(1), "audio/wav", ""), {
    message: "no GROQ_API_KEY binding",
  });
});
