/* Application configuration.
 *
 * Defaults live here in source. Deploy-time overrides are injected as a global
 * by an optional `config.js` at the site root (loaded before the app module,
 * see index.html and config.example.js). This keeps environment-specific values
 * out of the codebase, per the 12-factor "config from environment" principle. */

const appOverrides = (typeof window !== "undefined" && window.__APP_CONFIG__) || {};

export const appConfig = {
  /* The church, campus or ministry this deployment belongs to. It is the line
   * under the wordmark on every gate, the subtitle on the leaderboard, and the
   * name the sign-in refusal uses when it turns an outside account away, so a
   * deployer standing this up for their own congregation changes this first. */
  groupName: "Acts 2 Network - Berkeley",
  /* One short line under the group name on the sign-in gate and the board hero
   *, a rallying sentence, not a description. Empty is the default and means
   * the line is simply not drawn, which is what every screen did before this
   * setting was written down; a deployer with nothing to say leaves it empty
   * rather than inventing a slogan to fill the space. */
  motto: "",
  deadline: "2026-10-31",
  /* The Google Workspace domains permitted to sign in.
   *
   * This is only half the gate, and the half that is not security: the
   * authoritative check is the regex in deploy/firestore.rules. The two are
   * kept in step by `npm run rules` (tools/gen_rules.mjs), which writes that
   * file from this list, change the domains here, re-run it, and redeploy the
   * rules. A client admitting a domain the deployed rules refuse means every
   * read and write fails for those members, which the app cannot tell from
   * having no record at all, so they are asked to set up a profile on every
   * device and nothing ever syncs.
   *
   * Two values are deliberate rather than accidental. An **empty list admits
   * nobody**: a missing or malformed value is a misconfiguration, and a gate
   * that falls open on one is how a private record becomes public, a deployer
   * who has not yet decided who may sign in should have an app that lets no one
   * in, not one that lets everyone in. To open the app to **any** signed-in
   * Google account, say so out loud with the single entry ["*"]; that is a
   * decision somebody made, and it reads like one both here and in the
   * generated rules.
   *
   * Entries are matched against the whole domain after the final "@", so a
   * look-alike ("evilgpmail.org", "gpmail.org.evil.com") and a subdomain
   * ("sub.acts2.network") are both refused. See emailAllowed in firebase.js. */
  allowedDomains: ["gpmail.org", "acts2.network"],
  /* The one domain named on the sign-in prompt ("Sign in with your
   * @acts2.network account"). Every entry in allowedDomains can sign in;
   * naming one keeps the instruction short, so a deploy with several domains
   * should name whichever one most members actually have. */
  primaryDomain: "acts2.network",
  /* The option list behind the profile form's ministry-group picker: the
   * congregation, campus or small group a member can say they belong to, and
   * one of the three fields the leaderboard slices by.
   *
   * The default is deliberately generic, because this app is not one church's.
   * A named list of somebody else's campuses is worse than no list at all to
   * everybody outside that church: it tells a visitor the app was not built
   * for them, and the one honest answer left is "Other". The shapes below are
   * the ones most congregations have in some form, and the field is free text
   * with this list beside it as suggestions rather than a closed menu, so a
   * member whose group is not here simply types it.
   *
   * A deployment with its own congregations names them here (see
   * config.example.js), in whatever order that group would read them, keeping
   * the "Other" catch-all pinned last rather than alphabetized. A group name
   * is stored verbatim and read back by the leaderboard's grouping, so
   * renaming one leaves the members who chose the old name filed under it. */
  ministryGroups: [
    "Small group",
    "Sunday service",
    "Youth",
    "College",
    "Young adults",
    "Mens",
    "Womens",
    "Family",
    "Other",
  ],
  /* What the three shelves are called on screen, keyed by the category key in
   * src/categories.js. Only the display name is configurable, and that is the
   * whole point: the **key** is written into every passage record and into each
   * saved setup form, so it is data and must not move, renaming a shelf here
   * changes what a member reads and nothing else. A key left out keeps the
   * name in categories.js, and a key nobody recognizes is ignored. The short
   * tab labels stay put; they are already generic. */
  categoryNames: {
    core: "Verses Every Self Respecting Christian Should Know",
    psalms: "Psalms",
    dt: "DT Passages",
  },
  /* The shortest time the opening splash stays up, in milliseconds. It sits
   * here rather than in App.js because it is a matter of taste, how long the
   * registration mark is worth watching, and so it can be retuned per deploy
   * without a code change. Retune this one; SPLASH_MAX_MS in App.js is the
   * failsafe above it and is not a preference. */
  splashMinMs: 2000,
  /* Where a recorded recitation is sent to be transcribed, the route in
   * worker/transcribe.js, which on this deploy is "/api/transcribe".
   *
   * Empty means not configured, and not configured is the default on purpose:
   * with nothing here Speak mode listens exactly the way it always has, through
   * the browser's own streaming recognizer, and no audio leaves the device by
   * this path. Setting it turns on record-then-transcribe (src/transcriber.js),
   * which is the shape that survives a phone, Chrome for Android ignores
   * `continuous` entirely, so the streaming path was never really working there
   * (docs/research/asr.md §1). It sits with the other tunables because it is a
   * per-deploy fact: a build with no Worker behind it should leave it empty
   * rather than point at a route that will 404 on every verse. */
  transcribeUrl: "",
  /* Where the app's own voice is synthesized (worker/transcribe.js, the
   * /api/speak route). Same shape and same reasoning as transcribeUrl above: a
   * per-deploy fact, empty when there is no Worker behind it, and empty is not
   * a broken app but the one it was before, reading with whatever voice the
   * browser has. Speak mode and Run mode both prefer this and both fall back
   * per line, so a member on a bad connection loses the good voice for a
   * sentence rather than for the drive. */
  speakUrl: "",
  ...appOverrides,
};

/* Firebase web config. Firebase web configuration (apiKey, projectId, ...) is
 * public by design and safe to expose to clients; access is governed by
 * Firebase Security Rules, not by hiding this object. The default below points
 * at the project's Firebase; a deploy can override it via window.__FIREBASE_CONFIG__
 * (e.g. a separate staging project). Set to null to disable cloud sync. */
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAjX1oxuaJXlRenLg_TvPZIT-MT2WZTe1A",
  authDomain: "verse-memory.firebaseapp.com",
  projectId: "verse-memory",
  storageBucket: "verse-memory.firebasestorage.app",
  messagingSenderId: "223583873519",
  appId: "1:223583873519:web:eb490a7c3f51a14897ae1a",
  measurementId: "G-3YYWC1KY57",
};

const firebaseOverride = typeof window !== "undefined" ? window.__FIREBASE_CONFIG__ : undefined;
export const firebaseConfig = firebaseOverride === undefined ? DEFAULT_FIREBASE_CONFIG : firebaseOverride;

export const isFirebaseConfigured = () => firebaseConfig != null;
