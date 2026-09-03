# Deploying Verse Mastery for your own church

Verse Mastery was built for **Acts 2 Network - Berkeley**, and it is theirs, the
code is MIT-licensed and free for you to take, and the `LICENSE` file's copyright
notice stays with it wherever it goes. If you stand this up for your own
congregation, credit the original project: it is the honest thing to do, and the
licence asks for it.

This document is the whole path from a fork to a running site. Nothing in it
requires a build step or a bundler, the app is static ES modules and a handful
of CDN scripts.

---

## What you actually have to change

Five things, in the order they will bite you:

| What                                 | Where                                                    |
| ------------------------------------ | -------------------------------------------------------- |
| Your church's name, motto, deadline  | `config.js` (copied from `config.example.js`)            |
| Who is allowed to sign in            | `config.js` → `allowedDomains`, **then `npm run rules`** |
| Your own Firebase project            | `config.js` → `window.__FIREBASE_CONFIG__`               |
| Your ministry groups and shelf names | `config.js` → `ministryGroups`, `categoryNames`          |
| The browser tab title                | `index.html` → `<title>`                                 |

Everything else has a working default. An unconfigured checkout still runs, but
it runs as Acts 2 Network - Berkeley's copy, pointed at their Firebase project,
which will refuse your members, so do not skip the config.

---

## 1. Fork and run it locally

```bash
git clone <your fork>
cd verse-memory
npm install          # dev tooling only: eslint, prettier, serve, wrangler, playwright
npm run dev          # http://localhost:8080
```

The app uses ES modules, so it **must be served over HTTP**, opening
`index.html` from the filesystem will not work. Any static server is fine.

While you are only looking at the app, copy the template and turn cloud sync off:

```js
// config.js
window.__APP_CONFIG__ = {};
window.__FIREBASE_CONFIG__ = null; // local-only: no sign-in, no sync
```

`scripts/build.mjs` **refuses to build** with that line live, because a site
shipped that way has no sign-in and no cross-device progress and says nothing
about it. That refusal is the safety net for exactly this workflow; when you mean
it, `ALLOW_LOCAL_ONLY_BUILD=1 npm run build`.

## 2. Create your Firebase project

Progress lives in the browser's `localStorage` first and syncs to Firestore
second, so Firebase is an overlay rather than a dependency, but without it
nobody signs in and nothing follows a member between devices.

In the [Firebase console](https://console.firebase.google.com):

1. **Create a project.**
2. **Authentication → Sign-in method → enable Google.**
3. **Firestore Database → create** (production mode; you are about to deploy
   rules that lock it down).
4. **Authentication → Settings → Authorized domains**, add the domain you will
   serve the app from.
5. **Project settings → Your apps → Web**, register a web app and copy the
   config object.

Paste that object into your `config.js`:

```js
window.__FIREBASE_CONFIG__ = {
  apiKey: "...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "...",
  appId: "...",
  measurementId: "G-...", // omit to disable Google Analytics only
};
```

The Firebase web config is **public by design**, it identifies the project, it
does not authorize anything. Access is governed entirely by the security rules in
step 4, which is why it is safe to commit.

## 3. Fill in your configuration

Copy `config.example.js` to `config.js` and work down it. Every setting is
commented there; the ones worth thinking about before members start using the app
are:

- **`groupName`**, the line under the wordmark on every gate, and the name the
  sign-in refusal uses when it turns an outside account away.
- **`motto`**, one short line under it, or empty for no line at all.
- **`deadline`**, the date the board's pace is counted down to.
- **`ministryGroups`**, your congregations, campuses or small groups. This one is
  worth settling early: a group name is stored in a member's profile verbatim, so
  renaming one later leaves everybody who chose the old name filed under it. Keep
  an `"Other"` catch-all pinned last.
- **`categoryNames`**, what the three shelves are called on screen. Only the
  display name is configurable: the **key** (`core`, `psalms`, `dt`) is written
  into every passage record and every saved setup form, so it is data and does not
  move. Name only the shelves you want renamed.

Then edit `index.html`'s `<title>`, which is the one piece of church-specific
text the config does not reach, a browser reads it before any script runs.

## 4. Decide who can sign in, and generate the rules

This is the step that goes wrong quietly, so it is worth understanding rather
than following.

The gate has **two halves and only one of them is security.** The client's check
(`emailAllowed()` in `src/firebase.js`) is a courtesy that keeps a stranger off
the sign-in screen. The enforcement is `deploy/firestore.rules`, which Firebase
runs on the server for every read and write. The rules file is uploaded to
Firebase rather than served with the app, so it cannot read your `config.js` and
has to carry the domains written out, which is exactly what lets the two halves
drift apart.

When they drift, **nothing says so.** A client admitting a domain the deployed
rules refuse means every read and every write is denied for those members, and
the app cannot tell a refused read from an empty record, so they are asked to
set up a profile on every device they open, and nothing ever syncs.

So the rules are **generated from the client's own list**:

```js
// config.js
window.__APP_CONFIG__ = {
  allowedDomains: ["yourchurch.org"],
  primaryDomain: "yourchurch.org", // the one named on the sign-in prompt
};
```

```bash
npm run rules                            # rewrites deploy/firestore.rules from your config
firebase deploy --only firestore:rules   # publishes it
```

`test/rules.test.mjs` is the alarm on top: it fails if the rules file on disk is
no longer what your configured domains generate, so `npm test` catches a change
to either half that skipped the other. Do not hand-edit `deploy/firestore.rules`,
it carries a generated-file header, and your edit will come back next run.

**Two configured edges are worth knowing:**

- An **empty `allowedDomains` admits nobody**, both in the client and in the
  generated rules. That is deliberate. A gate that falls open on a value somebody
  forgot is how a private record becomes public, and the failure would look
  exactly like a working app.
- To open the app to **any signed-in Google account**, which is the right answer
  if your members are on personal Gmail rather than a Workspace domain, say so
  explicitly with the single entry `allowedDomains: ["*"]`. It is available
  because somebody asked for it, never because a value went missing.

Domains are matched **whole**, against everything after the final `@`. A
look-alike (`evilyourchurch.org`), a suffix (`yourchurch.org.evil.com`) and a
subdomain (`sub.yourchurch.org`) are all refused.

## 5. Ship it

Two paths, both already wired:

- **Cloudflare Workers static assets**, `npm run deploy` runs
  `scripts/build.mjs` into `dist/` and `wrangler deploy` serves it. The build
  copies only `index.html`, `src/`, `data/` and your runtime `config.js`. Never
  point a host at the repo root; it would serve `node_modules/` and `design/`.
- **Container**, `Dockerfile` (nginx, `deploy/nginx.conf`) builds an image you
  can run anywhere.

Any static host works: the app has no server-side component. The one server-side
piece in the repo is the optional Cloudflare Worker behind `transcribeUrl`, and
Speak mode works without it.

Deploy the rules alongside the site, every time. `.github/workflows/deploy.yml`
does this on every push to `main` for exactly the reason in step 4, so the
client half can never ship without the rules half.

---

## Scripture text is a separate question

**The MIT licence covers the code only.** It does not cover the verses.

`data/passages.js` ships the **English Standard Version**, © Crossway, fetched
once at authoring time by `tools/fetch_passages.mjs` against Crossway's API. Acts
2 Network - Berkeley uses it under Crossway's copyright and permissions policy,
and that permission is **theirs, not yours**, a fork is a new publication of the
text and needs its own answer. Crossway's terms also set hard limits on how much
may be stored (half a book, 500 consecutive verses), which `test/passages.test.mjs`
asserts over the shipped set, and they require the copyright notice rendered
wherever the text appears, which is what `src/views/footer.js` is for. If you
ship ESV text, that notice ships with it.

Your realistic options:

1. **Get your own ESV API key and permission** from Crossway, and keep the
   licence notice in the footer.
2. **Use a public-domain translation**, the KJV, the ASV, the WEB, which
   nobody has to license. Translation support lives in `data/translations.js`;
   check what is available there in your checkout, since public-domain
   translation support is being added alongside this document.
3. **Ship no text at all** and add your own passages via
   `tools/fetch_passages.mjs` and `tools/new-passages.json`.

Whichever you choose, `data/passages.js` and `data/keywords.js` are **generated
files**, do not hand-edit them. Keywords come from a spaCy pass
(`npm run keywords`), and they are aligned to `text.split(" ")`, so changing a
passage's text without regenerating them misaligns every blank in it.

---

## Verifying your deployment

```bash
npm test          # the node:test suite, including the rules drift alarm
npm run lint
npm run test:e2e  # Playwright, the app driven in a browser
```

Then, on the deployed site: sign in with an account in your domain, fill in a
profile, commit a verse, and open the app in a second browser. If the verse is
there, both halves of the gate agree and sync is working. If the second browser
asks you to set up a profile you already have, the rules are behind the client,
go back to step 4 and redeploy them.

---

## Credit

Verse Mastery was written for and by **Acts 2 Network - Berkeley**, and is
released under the MIT licence (`LICENSE`, © 2026 Acts 2 Network - Berkeley).
That notice must travel with the code, including in your fork. Beyond the
licence's requirement, a line in your own README saying where the app came from
costs nothing and is plainly right.

`CLAUDE.md` is the architectural tour, why the two enforcement layers exist, how
the spaced-repetition model works, what commits a verse. Read it before changing
anything load-bearing.
