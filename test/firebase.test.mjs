import test from "node:test";
import assert from "node:assert/strict";

import { emailAllowed, normalizeDomains, ALLOWED_DOMAINS, PRIMARY_DOMAIN, ANY_DOMAIN } from "../src/firebase.js";
import { appConfig } from "../src/config.js";

test("emailAllowed accepts only the approved domains", () => {
  // The list is configurable (appConfig.allowedDomains) but the default is this
  // deployment's, and an unconfigured build must behave exactly as it always has.
  assert.deepEqual(ALLOWED_DOMAINS, ["gpmail.org", "acts2.network"]);
  assert.deepEqual(appConfig.allowedDomains, ["gpmail.org", "acts2.network"]);
  assert.equal(emailAllowed("member@gpmail.org"), true);
  assert.equal(emailAllowed("member@acts2.network"), true);
  assert.equal(emailAllowed("Member@ACTS2.Network"), true, "case-insensitive");
  assert.equal(emailAllowed("member@gmail.com"), false);
  assert.equal(emailAllowed("member@evilgpmail.org"), false, "must match full domain");
  assert.equal(emailAllowed("member@gpmail.org.evil.com"), false);
  assert.equal(emailAllowed("member@sub.acts2.network"), false, "subdomains not allowed");
  assert.equal(emailAllowed(null), false);
  assert.equal(emailAllowed(""), false);
});

test("PRIMARY_DOMAIN is one of the allowed domains", () => {
  assert.equal(PRIMARY_DOMAIN, "acts2.network");
  assert.equal(appConfig.primaryDomain, "acts2.network");
  assert.ok(ALLOWED_DOMAINS.includes(PRIMARY_DOMAIN));
});

/* A configured list must be no weaker than the hard-coded one it replaced, so
 * the hostile cases are asserted again against a list the test supplies. */
test("a configured domain list is matched whole, never as a substring", () => {
  const domains = ["example.org"];
  assert.equal(emailAllowed("member@example.org", domains), true);
  assert.equal(emailAllowed("MEMBER@Example.ORG", domains), true);
  assert.equal(emailAllowed("member@evilexample.org", domains), false);
  assert.equal(emailAllowed("member@example.org.evil.com", domains), false);
  assert.equal(emailAllowed("member@sub.example.org", domains), false);
  assert.equal(emailAllowed("member@example.orgx", domains), false);
  assert.equal(emailAllowed("example.org@evil.com", domains), false, "the domain is after the LAST @");
  assert.equal(emailAllowed("evil.com@example.org", domains), true, "…and only after the last @");
});

test("an empty or malformed domain list admits nobody", () => {
  // Falling open on a missing value is how a private record becomes public, so
  // an unconfigured list is read as "no one has been let in yet", not "anyone".
  assert.equal(emailAllowed("member@acts2.network", []), false);
  assert.equal(emailAllowed("member@anything.com", []), false);
  assert.equal(emailAllowed("member@gmail.com", []), false);
});

test('the single entry "*" admits any real address, and only a real address', () => {
  const any = [ANY_DOMAIN];
  assert.equal(ANY_DOMAIN, "*");
  assert.equal(emailAllowed("member@gmail.com", any), true);
  assert.equal(emailAllowed("member@acts2.network", any), true);
  // "Any account" still means an account: nothing here is a pass for a value
  // that was never an address in the first place.
  assert.equal(emailAllowed("member", any), false);
  assert.equal(emailAllowed("member@", any), false);
  assert.equal(emailAllowed("@gmail.com", any), false);
  assert.equal(emailAllowed("", any), false);
  assert.equal(emailAllowed(null, any), false);
  assert.equal(emailAllowed(undefined, any), false);
  // The wildcard is only a wildcard on its own, beside a real domain it is a
  // domain that matches nothing, the same reading the rules generator takes.
  assert.equal(emailAllowed("member@gmail.com", ["*", "acts2.network"]), false);
  assert.equal(emailAllowed("member@acts2.network", ["*", "acts2.network"]), true);
});

test("the configured list is normalized, so a stray @ or capital is not a lockout", () => {
  // The shapes a deployer plausibly types into config.js. Forgiving these is
  // about reading the config charitably, never about matching more loosely,
  // whatever comes out is still compared whole.
  assert.deepEqual(normalizeDomains(["  @ACTS2.Network ", "GPMail.org"]), ["acts2.network", "gpmail.org"]);
  assert.deepEqual(normalizeDomains(["*"]), ["*"]);
  // Anything that is not a domain at all is dropped rather than offered as a
  // blank entry that would then match a blank domain.
  assert.deepEqual(normalizeDomains(["", "   ", null, undefined, 42, {}, ["nested"]]), []);
  // A value that is not a list is a misconfiguration, and reads as "no one".
  assert.deepEqual(normalizeDomains("acts2.network"), []);
  assert.deepEqual(normalizeDomains(undefined), []);
  assert.deepEqual(normalizeDomains(null), []);
  // And the shipped default survives it unchanged.
  assert.deepEqual(normalizeDomains(appConfig.allowedDomains), ALLOWED_DOMAINS);
});
