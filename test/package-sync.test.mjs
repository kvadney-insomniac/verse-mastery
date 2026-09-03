import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* The scorer exists twice, and the duplication is deliberate rather than an
 * oversight anybody is going to clean up.
 *
 * `packages/recital-score/` is the publishable extraction of `src/recital.js`
 * and `src/wordmatch.js`, the alignment is general (language drills, reading
 * tutors, voice-agent evals all want it) and there is nothing scripture-specific
 * in the API. The obvious move once it is on npm would be for the app to depend
 * on it. **The app cannot.** It is a no-build, no-bundler static site: the
 * browser loads `src/*.js` as native ES modules straight off the origin, so
 * there is nothing in the pipeline that could resolve a bare `recital-score`
 * specifier at runtime, and adding one would mean adding a build step to an app
 * whose whole architecture is the absence of one (see CLAUDE.md, "No-build ES
 * modules + CDN globals").
 *
 * So two copies, and the copies must be **byte-identical**. That is achievable
 * because the package puts `recital.js`, `wordmatch.js` and a trimmed `text.js`
 * in a `src/` of its own, which makes every relative import in the two files
 * resolve unchanged, no import rewriting was needed, so there is nothing to
 * except from the comparison and this test is a plain equality.
 *
 * What it is guarding against is silent divergence: a cost retuned in one copy,
 * a homophone added to the other, and two graders that no longer agree about
 * what somebody said. */

const from = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const COPIES = ["recital.js", "wordmatch.js"];

for (const file of COPIES) {
  test(`packages/recital-score/src/${file} is byte-identical to src/${file}`, () => {
    assert.equal(
      from(`../packages/recital-score/src/${file}`),
      from(`../src/${file}`),
      `src/${file} and packages/recital-score/src/${file} have diverged. They are two copies of one ` +
        `module, the app loads src/ directly in the browser and cannot resolve an npm package at ` +
        `runtime, so neither copy can be deleted. Copy whichever one you meant to change over the ` +
        `other (\`cp src/${file} packages/recital-score/src/${file}\`, or the reverse if the package ` +
        `was the edit), re-run \`npm test\` here and \`npm test --prefix packages/recital-score\`.`,
    );
  });
}

/* The third file is not a copy, the package ships only the one helper the
 * scorer imports, where `src/text.js` also carries the app's display and date
 * helpers, so it cannot be compared whole. `norm` itself still has to be the
 * same function in both, because every comparison in both graders runs through
 * it and two normalizations that disagree are two graders that disagree. */
test("norm() is the same function in the package as in src/text.js", () => {
  const declaration = /export const norm = [\s\S]*?;\n/;
  const app = from("../src/text.js").match(declaration);
  assert.ok(app, "src/text.js no longer declares norm the way this test looks for it");
  assert.ok(
    from("../packages/recital-score/src/text.js").includes(app[0]),
    "packages/recital-score/src/text.js carries a different norm() than src/text.js. Copy the " +
      "declaration across, the scorer compares every word through it, so a difference here is a " +
      "difference in what counts as the same word.",
  );
});
