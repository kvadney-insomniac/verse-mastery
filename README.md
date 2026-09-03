# Verse Mastery, public edition

A spaced-repetition Bible-verse memorization app. Work through a set of
passages, review them several ways, and watch a "freshness" score decay and
recover along the Ebbinghaus forgetting curve so you know what to revisit and
when. There is also a **Speak mode** that runs hands-free, the app reads a
reference, you recite the verse aloud, and it marks you, and a **Run mode**
that calls verses out over a synthesized beat.

**Try it: https://kvadney-insomniac.github.io/verse-mastery/**

No sign-up, nothing to install. Progress is saved in your own browser and goes
nowhere else, there is no account and no server holding your data.

---

## Where this came from, and what is different here

**Verse Mastery was written for [Acts 2 Network - Berkeley](https://github.com/godwinlaw/verse-memory), and the design and the great majority of the code are theirs.** This is a
derived edition under the MIT licence, and it exists because their build cannot
be redistributed as-is:

- **The text.** The original ships the **ESV**, © Crossway, under API terms
  that cap what may be stored and that a fork has no licence to hand out. This
  edition ships the **King James Version**, which is in the public domain in the
  United States, so anyone may run it, fork it, or deploy their own.
- **The congregation.** The original is gated to one church's Google Workspace
  domains. Here every church-specific value is a setting, and this deployment
  simply sets none of them.

This is **not** Acts 2 Network's app and does not speak for them. If you are a
member there, use their deployment, not this one.

## Deploy your own

Everything a congregation needs to change is configuration rather than code,
sign-in domains, group name, ministry groups, category names, the goal deadline.
See **[docs/DEPLOYING.md](docs/DEPLOYING.md)** for standing up an instance with
your own Firebase project, and _Scripture text_ below for choosing a
translation. Deploying to GitHub Pages costs nothing and needs no credentials:
`.github/workflows/pages.yml` in this repo is a working example.

---

## Features

- **Four review modes**, Flashcard, Fill the blanks, Write it out, Order the phrases.
- **Spaced repetition**, each verse's stability grows with successful reviews;
  free recall builds more durable memory than cued recall than recognition.
- **Intelligent blanks**, key words are chosen by an offline spaCy pass
  (`tools/gen_keywords.py`), not by naive position.
- **Progress board, passage list, and leaderboard** views.

## Quick start

```bash
npm install       # dev tooling only, eslint, prettier, serve, wrangler, plus
                   # react/react-dom/htm for the render smoke tests (see test/)
npm run dev       # serve at http://localhost:8080
```

Any static file server works too (e.g. `python3 -m http.server 8080`), the app
has no server-side component. Because it uses ES modules, it must be served over
HTTP; opening `index.html` from the filesystem will not work.

## Project structure

```
.
├── index.html            # entry document: loads CDN libs, config.js, src/main.js
├── config.example.js     # deploy-time config template (copy to config.js)
├── src/                   # application source (ES modules)
│   ├── main.js            #   entry point, mounts <App/>
│   ├── App.js             #   stateful shell: state, actions, view dispatch
│   ├── dom.js             #   React/htm globals, sx() style parser, corners()
│   ├── config.js          #   app config + defaults (reads deploy overrides)
│   ├── storage.js         #   localStorage persistence + cloud-sync seam
│   ├── firebase.js        #   optional Firebase auth + cloud sync
│   ├── profile.js         #   member profile domain (options, validation, merge)
│   ├── srs.js             #   spaced-repetition / forgetting-curve math (pure)
│   ├── blanks.js          #   blank selection + phrase chunking (pure)
│   ├── grading.js         #   grading a typed / first-letter attempt (pure)
│   ├── progress.js        #   reading a progress map: status, due order, streaks (pure)
│   ├── review.js          #   review modes, session shape, seeded shuffle (pure)
│   ├── text.js            #   small text/date helpers (pure)
│   ├── styles.css         #   design system + component styles
│   ├── ui/
│   │   └── tokens.js      #   shared style strings (only ones used more than once)
│   ├── viewmodel/         #   state + actions -> one flat object, per view
│   │   ├── index.js, totals.js, chrome.js, board.js, list.js,
│   │   └── review.js, leaderboard.js, gate.js
│   └── views/             #   view-model -> markup; pure functions of `v`
│       ├── header.js, board.js, list.js, review.js, done.js,
│       └── leaderboard.js, auth-gate.js, profile-form.js
├── data/                  # generated/authored content
│   ├── passages.js        #   the passage set (ESV)
│   └── keywords.js        #   per-passage keyword indices (generated)
├── tools/
│   ├── gen_keywords.py    # spaCy keyword generator -> data/keywords.js
│   ├── fetch_passages.mjs # ESV API fetch -> data/passages.js (authoring only)
│   ├── gen_rules.mjs      # writes deploy/firestore.rules from the configured domains
│   └── new-passages.json  #   what that fetch should pull
├── scripts/
│   └── build.mjs          # assembles ./dist for the Cloudflare Workers deploy
├── test/                  # node:test suite, pure modules + view render tests
│   └── helpers/            #  dom-env.mjs (render harness), scenarios.mjs (fixtures)
├── deploy/
│   ├── nginx.conf         # static-serving config for the container
│   └── firestore.rules    # Firestore security rules (generated, npm run rules)
├── design/                # provenance: source docs + original design export
│                           #  (design/claude-design/ is gitignored, absent on a fresh clone)
├── docs/                  # standards & reference; DEPLOYING.md for a new church
├── wrangler.jsonc         # Cloudflare Workers static-assets config
├── Dockerfile             # nginx image (container-based deploy, per A2N)
└── .drone.yml             # CI/CD pipeline (Drone)
```

The rule for where a change belongs: **how something looks** goes in `views/`,
**what is shown** goes in `viewmodel/`, **how memory/grading/scheduling work**
goes in `srs.js` / `grading.js` / `progress.js` / `review.js`. `App.js` holds
state and an `actions` table and dispatches to views, nothing else.

## Configuration

Defaults live in `src/config.js`. To override per deployment, copy the template
and edit it:

```bash
cp config.example.js config.js
```

`config.js` is gitignored and loaded by `index.html` before the app. If it is
absent, the app runs on the built-in defaults.

Everything church-specific is a setting, so the app is deployable by any church
and Acts 2 Network - Berkeley is simply the deployment whose values are the
defaults: `groupName`, `motto`, `deadline`, `splashMinMs`, `allowedDomains` +
`primaryDomain`, `ministryGroups`, `categoryNames`, `transcribeUrl`, and the
Firebase config. Changing `allowedDomains` also means regenerating the Firestore
rules, see below. **Standing this up for your own church? Start with
[`docs/DEPLOYING.md`](docs/DEPLOYING.md).**

## Adding passages

`data/passages.js` is authored offline and shipped as a static module, **the
app never calls a Bible API at run time**, and there is no key in the build.
To add passages, list them in `tools/new-passages.json` (reference, book,
testament, category, and a `group` if the entry is one section of a longer
chapter), then:

```bash
ESV_API_KEY=... node tools/fetch_passages.mjs   # --dry-run to see it first
npm run keywords                                 # indices realign to the new text
```

Get a key at [api.esv.org/account](https://api.esv.org/account/). It is read
from the environment and never written to the repo. A reference already in the
set is refreshed in place, so the script is safe to re-run.

A long chapter is listed as several sections sharing one `group`, each is an
ordinary passage that commits on its own, and the group is only what holds them
together on the list. Sections also keep each record inside the ESV licence and
inside what a member can actually give back in one sitting.

`test/passages.test.mjs` asserts the two limits Crossway's terms put on what may
be stored, no more than half of any book, and no run of 500 consecutive verses,
so an over-eager addition fails the build rather than the licence.

## Regenerating keywords

`data/keywords.js` is generated offline from `data/passages.js`:

```bash
pip install spacy && python3 -m spacy download en_core_web_sm
npm run keywords   # == python3 tools/gen_keywords.py
```

Do not edit `data/keywords.js` by hand, re-run the generator.

## Authentication & cloud sync (Firebase)

Access is restricted to Google accounts in the deployment's configured Workspace
domains, for this deployment, **gpmail.org** and **acts2.network**. Members sign
in with Google; each member's progress then syncs across devices via Firebase
(project `verse-memory`):

- **Google sign-in**, gated to the configured domains. The client rejects and
  signs out any account outside them, and, authoritatively, **Firestore rules
  only allow verified identities in those domains** (`deploy/firestore.rules`).
  Never trust the client alone; the rules are the real enforcement. The list is
  `appConfig.allowedDomains` in `src/config.js`, and `deploy/firestore.rules` is
  **generated from it** by `npm run rules` (`tools/gen_rules.mjs`) so the two
  halves cannot drift; `test/rules.test.mjs` fails if they have. An empty list
  admits nobody, deliberately, to open the app to any Google account, say so
  with the single entry `["*"]`.
- **Firestore** stores one doc per user at
  `users/{uid}` = `{ name, email, progress, log, profile, updatedAt }`. On
  sign-in the remote doc is pulled and reconciled with local state
  (`mergeProgress` keeps the most recently reviewed record per verse); each local
  save is debounced and pushed back up.

The Firebase modular SDK (v11.6.1) is imported from the gstatic CDN, preserving
the no-build setup. If Firebase is unreachable/misconfigured the app degrades to
local-only (`auth.status === "disabled"`) rather than locking members out. The
default project config lives in `src/config.js`; override per deployment via
`window.__FIREBASE_CONFIG__`, or set it to `null` to disable.

**One-time Firebase / Google Cloud console setup:**

1. **Authentication → Sign-in method → enable "Google".**
2. **Firestore Database → create**, then deploy the rules from the repo root
   (project + rules path are configured in `.firebaserc` / `firebase.json`):
   ```bash
   npm i -g firebase-tools     # if needed
   firebase login              # once
   npm run rules                            # regenerate deploy/firestore.rules from the config
   firebase deploy --only firestore:rules   # uses deploy/firestore.rules
   ```
3. Add the app's domain under **Authentication → Settings → Authorized domains**.

Note: because sign-in can span more than one Workspace domain (here gpmail.org
and acts2.network), the Google `hd` hint isn't used and the OAuth consent screen
can't be locked to a single Workspace. Domain membership is enforced by `emailAllowed()` and the
Firestore rules instead.

Implementation: `src/firebase.js` (SDK load, Google auth + domain gate, Firestore
read/write) and `src/storage.js` (`registerRemoteSync`, `mergeProgress`,
`mergeLog`).

## Deployment

Two independent deploy paths exist.

**Container → Amazon ECS via Drone CI**, the [A2N dev standard](docs/a2n-dev-best-practices.md):

```bash
docker build -t verse-mastery .
docker run --rm -p 8080:80 verse-mastery   # http://localhost:8080
```

`.drone.yml` lints on every push/PR and, on `main`, builds and pushes the image
to Amazon ECR (us-east-1). Set the `aws_access_key_id` / `aws_secret_access_key`
secrets and the ECR registry in the Drone repo settings.

**Cloudflare Workers static assets**, an alternative host with no container:

```bash
npm run build    # scripts/build.mjs assembles ./dist: index.html, src/, data/, config.js
npm run deploy    # build + `wrangler deploy`
npm run cf:dev     # build + `wrangler dev`, for a local preview of the Worker
```

`wrangler.jsonc` points the Worker's static-assets binding at `./dist`.
`scripts/build.mjs` copies only the files the app actually serves, never point
a host at the repo root, since that would also serve `node_modules/`, `design/`,
`test/`, and everything else not meant to ship.

## Development

```bash
npm test               # node:test, pure modules + view render smoke tests
npm run lint           # ESLint
npm run format         # Prettier (write)
npm run format:check   # Prettier (check, as CI runs it)
```

## Scripture text, and choosing a translation

**The code is MIT. The scripture text is not, and the difference matters most to
anyone deploying this themselves.**

The set shipped here is the **English Standard Version (ESV)**, © Crossway,
fetched from the [ESV API](https://api.esv.org/) at authoring time (see _Adding
passages_). Use is noncommercial and subject to Crossway's
[copyright and permissions](https://www.crossway.org/permissions/) and the
[API v3 guidelines](https://api.esv.org/docs/), which cap how much may be
stored: no run of 500 consecutive verses and no more than half of any one book.
Those limits are not left in this file to be remembered; `test/passages.test.mjs`
asserts both over the set actually shipped, so a well-meant addition to
`tools/new-passages.json` fails the build rather than the licence. The required
notice appears in the app's footer under every signed-in screen, because the
terms ask for it wherever the text appears.

**That is fine for one church running its own tool, and it is the wrong default
for anything public**, a fork cannot lawfully redistribute ESV at will, and has
no API key in any case. So the translation is pluggable, and several
public-domain texts need no key and no permission:

```bash
node tools/fetch_passages.mjs --translation web   # World English Bible
node tools/fetch_passages.mjs --translation kjv   # King James Version
node tools/fetch_passages.mjs --translation asv   # American Standard Version
```

`data/translations.js` is the table of what is available; `data/translation.js`
records which one the shipped set actually contains, and the footer notice is
read from it, so a public-domain build says something true and an ESV build
still carries Crossway's wording verbatim.

One thing worth deciding deliberately rather than discovering later: **the
translations differ in the words being memorized**, which in an app about
holding a verse word for word is the product rather than a detail. The WEB
renders the divine name as "Yahweh" where the ESV and KJV have "the LORD", so
Proverbs 3:5 begins "Trust in Yahweh with all your heart". Pick the one your
congregation actually recites.

Switching translations also invalidates `data/keywords.js`, whose indices are
aligned to the old text, the fetcher handles this for you and explains why in
`tools/fetch_passages.mjs`; see _Regenerating keywords_.

## Credit

Verse Mastery was written for **Acts 2 Network - Berkeley**, and the MIT
copyright is theirs. Everything church-specific is now a setting rather than a
constant, so other congregations can deploy it, but the defaults are Acts 2
Network's because it is their app, and the work of designing it was done there.
If you stand up your own instance, please keep the attribution intact.
