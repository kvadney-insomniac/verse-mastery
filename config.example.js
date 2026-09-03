/* Deploy-time configuration override (optional), the template a new deployment
 * fills in.
 *
 * Copy this file to `config.js` (which is gitignored) and edit the values for
 * your deployment. index.html loads it as a classic script before the app, so
 * these globals are available to src/config.js at startup. Anything you leave
 * out falls back to the default in src/config.js, and if config.js is absent
 * altogether the app runs entirely on those defaults.
 *
 * Every setting below is commented with what it does; the commented-out ones
 * show the shipped default, so uncommenting a line without editing it changes
 * nothing. Standing this up for your own church? Read docs/DEPLOYING.md first,
 * it walks the whole thing, including the two settings that need something done
 * outside this file (the domains, and the Firebase project).
 *
 * Firebase web configuration is public by design (access is controlled by
 * Firebase Security Rules), so it is safe to commit a real config.js if you
 * prefer, it is gitignored only to keep environment specifics out of source. */

window.__APP_CONFIG__ = {
  // The church, campus or ministry this deployment belongs to. Appears under the
  // wordmark on every gate, on the leaderboard, and in the sign-in refusal.
  groupName: "Acts 2 Network - Berkeley",

  deadline: "2026-10-31", // YYYY-MM-DD, the memorization goal date
  splashMinMs: 3000, // least time the opening splash stays up, in milliseconds

  // One short line under the group name on the sign-in gate and the board, a
  // rallying sentence, not a description. Left empty (the default) the line is
  // simply not drawn, which is better than a slogan invented to fill the space.
  // motto: "",

  /* ── who can sign in ───────────────────────────────────────────────────────
   *
   * The Google Workspace domains permitted to sign in. THIS IS ONLY HALF THE
   * GATE: the authoritative check is the regex in deploy/firestore.rules, which
   * is generated from this list. After changing it:
   *
   *     npm run rules                            # regenerates deploy/firestore.rules
   *     firebase deploy --only firestore:rules   # publishes it
   *
   * Skipping that leaves the client admitting a domain the server refuses, and
   * the symptom is not an error message, members are asked to set up a profile
   * on every device they open and nothing ever syncs.
   *
   * An empty list admits NOBODY. That is deliberate: a gate that falls open on
   * a value somebody forgot is how a private record becomes public. If your
   * members are on personal Gmail rather than a Workspace domain, open the app
   * to any signed-in Google account by saying so explicitly, with the single
   * entry ["*"]. */
  // allowedDomains: ["gpmail.org", "acts2.network"],

  // The one domain named on the sign-in prompt ("Sign in with your
  // @acts2.network account"). Every entry in allowedDomains can sign in; naming
  // one keeps the instruction short, so pick whichever most members have.
  // primaryDomain: "acts2.network",

  /* ── your people and your shelves ──────────────────────────────────────────
   *
   * The option list behind the profile form's ministry-group picker, your
   * congregations, campuses or small groups. It is one of the three fields the
   * leaderboard slices by, so it is worth getting right before members start
   * filling in profiles: a group name is stored in the profile verbatim, and
   * renaming one later leaves the members who chose the old name filed under it.
   * Keep an "Other" catch-all pinned last for anyone whose group is missing. */
  // ministryGroups: ["A2F", "Kairos", "USF", "SFSU", "Womens", "Other"],

  /* What the three shelves are called on screen, keyed by the category key in
   * src/categories.js (`core`, `psalms`, `dt`). Only the display NAME is
   * configurable, the key is written into every passage record and every saved
   * setup form, so it is data and does not move. Name only the shelves you want
   * renamed; the rest keep their defaults. */
  // categoryNames: {
  //   core: "Verses Every Self Respecting Christian Should Know",
  //   psalms: "Psalms",
  //   dt: "DT Passages",
  // },

  // Where a recorded recitation is sent to be transcribed (worker/transcribe.js).
  // Empty means not configured, and Speak mode listens through the browser's own
  // recognizer instead, which is the right setting for a build with no Worker
  // behind it, since a route that 404s would fail on every verse.
  // transcribeUrl: "",
};

// Cloud sync uses the default Firebase project baked into src/config.js, which
// is Acts 2 Network - Berkeley's. A new deployment needs its own: create a
// Firebase project, enable Google sign-in, create Firestore, and paste the web
// config here (see docs/DEPLOYING.md). Leaving this unset points your members'
// progress at somebody else's project, where the rules will refuse it.
//
// window.__FIREBASE_CONFIG__ = {
//   apiKey: "...",
//   authDomain: "your-project.firebaseapp.com",
//   projectId: "your-project",
//   storageBucket: "your-project.firebasestorage.app",
//   messagingSenderId: "...",
//   appId: "...",
//   measurementId: "G-...", // omit to disable Google Analytics only
// };
// window.__FIREBASE_CONFIG__ = null; // disable cloud sync
