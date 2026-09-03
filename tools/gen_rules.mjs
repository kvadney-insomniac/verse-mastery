/* Write deploy/firestore.rules from the deployment's configured domains.
 *
 * The gate has two halves and only one of them is security: the client's
 * emailAllowed() in src/firebase.js is a courtesy, and the regex in
 * deploy/firestore.rules is the enforcement. The rules file is uploaded to
 * Firebase rather than served with the app, so it cannot read src/config.js and
 * has to carry the domains written out, which is exactly the arrangement that
 * lets the two halves drift apart.
 *
 * Drift here is not a hypothetical and it is not loud. A client that admits a
 * domain the deployed rules refuse means every read and every write is denied
 * for those members, and the app cannot tell a refused read from an empty one,
 * so they are asked to set up a profile on every device they open, nothing ever
 * syncs, and nothing anywhere says why. Rather than ask a deployer to remember
 * two places, this generator makes the rules a **build product of the client's
 * own list**: run `npm run rules` after changing appConfig.allowedDomains, then
 * `firebase deploy --only firestore:rules`.
 *
 * The domains come from src/firebase.js's ALLOWED_DOMAINS rather than straight
 * from the config, so the rules are generated from the very list the client will
 * check against, normalization included. test/rules.test.mjs is the alarm on
 * top: it asserts the file on disk is still what this generator would write, so
 * a change to either half that skips the other fails the suite.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const RULES_PATH = resolve(ROOT, "deploy/firestore.rules");

/* The header the generated file wears, so nobody edits it by hand and wonders
 * why their change came back. */
const HEADER = `// GENERATED FILE, do not edit by hand.
// Re-run tools/gen_rules.mjs (npm run rules) after changing the allowed domains
// in src/config.js, then: firebase deploy --only firestore:rules`;

/* Only a real domain may reach the regex. This is a generator writing a security
 * rule, so a config value carrying a regex metacharacter, or a quote, which
 * would end the string literal early, is refused outright rather than escaped
 * and hoped for: a rules file that compiles but means something else is worse
 * than one that was never written. The single wildcard entry is handled above
 * this and never gets here. */
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/* A domain as the rules language wants it: dots are the only metacharacter a
 * hostname can contain, and `[.]` is the least surprising way to say "a literal
 * dot" inside a `matches()` pattern. */
const forRegex = (domain) => domain.replace(/\./g, "[.]");

/* The body of isAllowedUser(), which is where the three configured cases part
 * company, and each one is written out in full rather than folded together,
 * because a person opening the deployed rules should be able to read who can
 * get in without reconstructing a generator's branches.
 *
 *   • no domains at all → `false`. An unset or malformed list is a deployment
 *     that has not said who may sign in, and the safe reading of that is
 *     nobody. Falling open would publish every member's record on a typo.
 *   • the single entry "*" → any verified Google account. A real thing to want
 *     (a church with no Workspace of its own, members on personal Gmail), and
 *     available only because the config said so in as many words.
 *   • otherwise → the exact domains, anchored at the end and matched on the
 *     lower-cased address, so a look-alike or a subdomain gets nothing. */
function guardFor(domains) {
  if (domains.length === 0) {
    return `      // No domains are configured for this deployment, so nobody is admitted.
      // This is deliberate: an unset list is a question nobody answered, and
      // the safe answer is "no one". Set appConfig.allowedDomains in
      // src/config.js (or ["*"] for any Google account) and re-run the
      // generator.
      return false;`;
  }
  if (domains.length === 1 && domains[0] === "*") {
    return `      // This deployment is open to any verified Google account, appConfig
      // .allowedDomains is ["*"], which is the explicit way to say so. There
      // is no domain test below because there is no domain restriction.
      return request.auth != null
        && request.auth.token.email_verified == true;`;
  }
  for (const d of domains) {
    if (!DOMAIN_RE.test(d)) {
      throw new Error(
        `gen_rules: "${d}" is not a domain name. appConfig.allowedDomains takes bare hostnames ` +
          `("acts2.network"), or the single entry "*" for any Google account.`,
      );
    }
  }
  const pattern = domains.map(forRegex).join("|");
  return `      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email.lower().matches('.*@(${pattern})$');`;
}

/* The whole file, as a pure function of the domain list, pure so the drift test
 * can call it without touching the disk. The prose below is the rules' own and
 * predates the generator; it is kept here rather than in the output's history
 * because this template is now the only place it can be edited. */
export function renderRules(domains) {
  return `${HEADER}

rules_version = '2';

// Firestore security rules for Verse Mastery.
// Access is restricted to verified Google accounts in this deployment's
// configured domains (see appConfig.allowedDomains in src/config.js). This is
// the authoritative enforcement, the client-side domain check is a
// convenience, not security.
// Deploy with: firebase deploy --only firestore:rules
service cloud.firestore {
  match /databases/{database}/documents {

    function isAllowedUser() {
${guardFor(domains)}
    }

    // Per-user progress documents: users/{uid} = { progress, log, updatedAt }.
    // Any signed-in member may read (so a leaderboard can aggregate committed
    // counts); a user may write only their own document.
    match /users/{uid} {
      allow read: if isAllowedUser();
      allow write: if isAllowedUser() && request.auth.uid == uid;
    }

    // Per-user leaderboard summaries: standings/{uid} = the few figures the
    // board ranks, written from the record above by its owner (see
    // src/standings.js, summarize). Same access as users/{uid}, everyone
    // reads, each member writes only their own, but this is the collection
    // the board actually scans, so the read is a fraction of the size.
    match /standings/{uid} {
      allow read: if isAllowedUser();
      allow write: if isAllowedUser() && request.auth.uid == uid;
    }
  }
}
`;
}

/* The domains this deployment will actually ship with.
 *
 * A deployer's overrides live in the root config.js as a classic script
 * assigning window globals, which is a browser arrangement rather than a module
 * one, so it is evaluated into a stand-in `window` and that window is installed
 * before src/firebase.js is imported, exactly as the browser orders it. Falling
 * back to config.example.js when there is no config.js mirrors what
 * scripts/build.mjs ships, so the rules match the site that gets built.
 *
 * The import has to be dynamic and has to come after the shim: a static import
 * would have evaluated src/config.js, and cached its answer, before any of
 * this ran, and the override would silently do nothing. */
export async function configuredDomains() {
  const source = existsSync(resolve(ROOT, "config.js")) ? "config.js" : "config.example.js";
  const shim = {};
  try {
    runInNewContext(readFileSync(resolve(ROOT, source), "utf8"), { window: shim });
  } catch {
    /* Not this tool's business to validate, the browser will complain, and the
     * defaults in src/config.js are the right thing to fall back to. */
  }
  globalThis.window = shim;
  const { ALLOWED_DOMAINS } = await import(pathToFileURL(resolve(ROOT, "src/firebase.js")).href);
  return ALLOWED_DOMAINS;
}

async function main() {
  const domains = await configuredDomains();
  writeFileSync(RULES_PATH, renderRules(domains));
  const who = domains.length === 0 ? "nobody (no domains configured)" : domains.join(", ");
  console.log(`Wrote deploy/firestore.rules, sign-in allowed for: ${who}`);
  console.log("Deploy it with: firebase deploy --only firestore:rules");
}

/* Importable by the drift test without writing anything: only a direct run
 * touches the file. */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
