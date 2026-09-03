/* The drift alarm.
 *
 * deploy/firestore.rules is the authoritative half of the sign-in gate and it
 * cannot read src/config.js, it is uploaded to Firebase, not served with the
 * app, so the domains have to be written out in it. That is the arrangement
 * that lets the two halves come apart, and coming apart is silent: a client
 * admitting a domain the deployed rules refuse fails every read and write for
 * those members, and the app cannot tell a refused read from an empty record,
 * so they are asked to set up a profile on every device and nothing syncs.
 *
 * tools/gen_rules.mjs closes that by making the rules a product of the client's
 * own list. This is the check that the product on disk is still the current one:
 * change the domains without re-running the generator (or edit the generated
 * file by hand) and the suite says so here, rather than the members finding out.
 *
 * Everything is imported from the generator so nothing is described twice, and
 * nothing here writes, a test that regenerated the file would assert only that
 * it can call a function. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { RULES_PATH, configuredDomains, renderRules } from "../tools/gen_rules.mjs";

test("the shipped firestore.rules is what the configured domains generate", async () => {
  const onDisk = readFileSync(RULES_PATH, "utf8");
  const expected = renderRules(await configuredDomains());
  assert.equal(
    onDisk,
    expected,
    "deploy/firestore.rules is out of step with the configured domains, run `npm run rules`, " +
      "then redeploy with `firebase deploy --only firestore:rules`",
  );
});

test("the generated rules name every configured domain, anchored and escaped", async () => {
  const rules = renderRules(["gpmail.org", "acts2.network"]);
  assert.match(rules, /matches\('\.\*@\(gpmail\[\.\]org\|acts2\[\.\]network\)\$'\)/);
  assert.match(rules, /email_verified == true/);
  // The header is what stops the file being hand-edited back into drift.
  assert.match(rules, /GENERATED FILE/);
  assert.match(rules, /tools\/gen_rules\.mjs/);
});

test("no configured domains admits nobody, rather than everybody", () => {
  const rules = renderRules([]);
  assert.match(rules, /return false;/);
  assert.doesNotMatch(rules, /email_verified/, "an unconfigured deployment must not let a signed-in account through");
});

test('the single entry "*" opens the rules to any verified Google account', () => {
  const rules = renderRules(["*"]);
  assert.match(rules, /email_verified == true/);
  assert.doesNotMatch(rules, /matches\(/, "there is no domain test when there is no domain restriction");
});

test("a domain that is not a domain is refused rather than escaped into the rules", () => {
  // Anything that could end the rules' string literal or change what the regex
  // means has to stop the generator: a rules file that compiles and means
  // something else is worse than one that was never written.
  for (const bad of [
    "acts2.network')|(.*",
    "acts2 network",
    "*.acts2.network",
    "acts2",
    "",
    "acts2.network|evil.com",
  ]) {
    assert.throws(() => renderRules([bad]), /not a domain name/, `expected "${bad}" to be refused`);
  }
});

test('"*" alongside a real domain is refused, so the wildcard is never accidental', () => {
  assert.throws(() => renderRules(["*", "acts2.network"]), /not a domain name/);
});
