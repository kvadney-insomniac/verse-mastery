/* Member profile.
 *
 * Each signed-in member fills in a small profile, ministry group, gender, and
 * graduating class, that is stored alongside their progress (see storage.js /
 * firebase.js) and used to slice the leaderboard stats. This module holds the
 * option lists and the pure helpers; all functions are pure so they can be unit
 * tested in Node without a browser. */

import { appConfig } from "./config.js";

/* The ministry groups this deployment knows about, the authoritative option
 * list for the profile's autocomplete picklist. Every group is somebody's own
 * list of congregations, campuses or small groups, so it comes from
 * `appConfig.ministryGroups` (see src/config.js, whose default is a generic set
 * that fits any congregation) rather than being written out here. Keep whatever
 * list is configured in canonical/ministry order, with an "Other" catch-all
 * pinned last (not alphabetized) for members whose group isn't listed.
 *
 * A group name is stored in the member's profile verbatim and read back by the
 * leaderboard's grouping, so renaming one leaves the members who chose the old
 * name filed under it, the same reason a category key never moves. Anything
 * that is not a non-empty string is dropped rather than offered as a blank row,
 * and a list configured as nothing at all leaves the picker with no suggestions,
 * which the form already handles: the field is free text with a picklist beside
 * it, not a closed menu. */
export const MINISTRY_GROUPS = (Array.isArray(appConfig.ministryGroups) ? appConfig.ministryGroups : [])
  .filter((g) => typeof g === "string" && g.trim())
  .map((g) => g.trim());

export const GENDERS = ["Male", "Female"];

/* The review settings a member can tune on their profile: how many verses a
 * review session takes, and how far a committed verse may fade before it comes
 * back round. The threshold sits well above the point where a verse is properly
 * at risk, a passage is easiest to hold when it is topped up before it slips,
 * and reviewing at 75% costs a fraction of what relearning at 20% does. */
export const DEFAULT_DUE_TOP_X = 10;
export const DEFAULT_DUE_FRESHNESS = 75;

/* How many of the words a write-out has to get right to commit a verse (see
 * srs.commitsVerse). 95% by default, matching srs.COMMIT_SCORE, so one dropped
 * article does not deny a passage the member plainly knows, a member who
 * wants a stricter or more forgiving bar can move it, down to MIN_COMMIT_THRESHOLD
 * so the bar still means recalling the passage rather than approximating it. */
export const DEFAULT_COMMIT_THRESHOLD = 95;
export const MIN_COMMIT_THRESHOLD = 90;
export const MAX_COMMIT_THRESHOLD = 100;
const clampCommitThreshold = (n) => Math.max(MIN_COMMIT_THRESHOLD, Math.min(MAX_COMMIT_THRESHOLD, n));

/* Default exercise difficulty: 0 = Coarse (fewest blanks / longest phrases),
 * 1 = Medium, 2 = Fine (every key word / shortest phrases). Sets the starting
 * level for both Fill the Blanks and Order the Phrases when no per-device
 * override is saved. */
export const DEFAULT_DIFFICULTY = 1;

/* Those settings as the app reads them, filled in from the defaults for a member
 * who has never touched them. */
export function reviewSettings(profile) {
  const p = profile || {};
  return {
    dueTopX: p.dueTopX !== undefined ? Number(p.dueTopX) : DEFAULT_DUE_TOP_X,
    dueFreshness: p.dueFreshness !== undefined ? Number(p.dueFreshness) : DEFAULT_DUE_FRESHNESS,
    defaultDifficulty: p.defaultDifficulty !== undefined ? Number(p.defaultDifficulty) : DEFAULT_DIFFICULTY,
    commitThreshold: clampCommitThreshold(
      p.commitThreshold !== undefined ? Number(p.commitThreshold) : DEFAULT_COMMIT_THRESHOLD,
    ),
  };
}

/* Google Workspace appends a campus tag like "(Berk)" to some members' display
 * names. Strip a trailing "(Berk)" (any spacing/case) so names read cleanly on
 * the leaderboard and in the pre-filled profile form. Safe on null/empty. */
export function cleanDisplayName(name) {
  return String(name || "")
    .replace(/\s*\(Berk\)\s*$/i, "")
    .trim();
}

/* A profile is complete once name and ministry group are set. The gate (App.js)
 * uses this to decide whether to prompt the member before showing the app. Name
 * is normally pre-filled from the Google account, but is required here so a
 * member whose account has no display name still gives one.
 *
 * Gender and graduating class are deliberately NOT required, and this is the
 * one thing in here worth arguing about. They are only ever used to slice the
 * leaderboard, so a member who leaves them blank costs nobody anything:
 * `standingsBy` already drops a row with no value for the attribute it is
 * grouping on rather than pooling it into an invented "Unknown" group, so the
 * board stays correct on its own. Against that, a mandatory field is a wall in
 * front of the whole app, and these two ask a stranger to declare a gender and
 * name a graduating class before they may read a verse. Somebody who is not a
 * student has no answer to the second one at all, and used to have to invent
 * a year to get in. Optional costs a slice of one screen; mandatory cost us
 * everyone who was not going to answer. */
export function isProfileComplete(p) {
  return !!(p && p.name && p.ministryGroup);
}

/* Is there anything here at all? `{}` is what an unsigned device and a document
 * with no profile field both look like, and it is truthy, which is exactly how
 * an empty object used to win a merge against a real profile. */
const hasProfile = (p) => !!p && Object.keys(p).length > 0;

/* Reconcile a local and a remote profile, in three steps, each of which exists
 * to stop a real profile being lost to a lesser one:
 *
 *   1. If only one side has anything, that side, an empty object is not a
 *      profile that beat the other, it is the absence of one. (`{}` vs a real
 *      profile carrying no `updatedAt` used to tie at 0 and hand back the
 *      empty side, which reads to the member as "set up your profile" on a
 *      device where the cloud plainly had one.)
 *   2. A complete profile beats an incomplete one regardless of timestamp,
 *      since a half-filled form is never the answer a member wants back.
 *   3. Otherwise last write wins by `updatedAt`; no timestamp counts as oldest.
 *
 * Returns {} when neither side has data. */
export function mergeProfile(local, remote) {
  const a = hasProfile(local) ? local : null;
  const b = hasProfile(remote) ? remote : null;
  if (!a) return b || {};
  if (!b) return a;
  if (isProfileComplete(a) !== isProfileComplete(b)) return isProfileComplete(a) ? a : b;
  return (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
}
