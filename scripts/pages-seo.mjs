/**
 * The public edition's search and AI-answer basics, added to the built tree for the
 * GitHub Pages deploy only (.github/workflows/pages.yml runs it after `npm run build`).
 *
 * The app renders in the browser, so without this the page a crawler reads is a title and
 * an empty <div id="root">. This writes, into dist/ only:
 *   - a description, a canonical link, a share card and JSON-LD in the head of index.html;
 *   - a <noscript> paragraph that says what the app is, which never shows when it runs;
 *   - sitemap.xml, llms.txt and the share image from pages/.
 *
 * index.html in the repository is untouched, so the other deploys (Cloudflare, the
 * container) and every congregation's own build are exactly as before.
 *
 * Usage: node scripts/pages-seo.mjs [dist]
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const OUT = process.argv[2] || "dist";
const SITE = "https://kvadney-insomniac.github.io/verse-mastery/";
const TITLE = "Verse Mastery, public edition: memorize Bible verses (KJV)";
const DESC =
  "A free spaced-repetition app for memorizing Bible verses, with the public-domain King James text. " +
  "Review several ways, or recite aloud in Speak mode. No sign-up; progress stays in your browser.";
const CREDIT = "https://github.com/kvadney-insomniac/verse-mastery#credit";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const ld = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "@id": SITE + "#app",
  url: SITE,
  name: "Verse Mastery, public edition",
  description: DESC,
  applicationCategory: "EducationalApplication",
  operatingSystem: "Any (web browser)",
  inLanguage: "en",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  license: "https://opensource.org/license/mit",
  image: SITE + "og.jpg",
  isBasedOn: "https://github.com/godwinlaw/verse-memory",
  codeRepository: "https://github.com/kvadney-insomniac/verse-mastery",
};

const head = `<meta name="description" content="${esc(DESC)}" />
    <link rel="canonical" href="${SITE}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Verse Mastery, public edition" />
    <meta property="og:title" content="${esc(TITLE)}" />
    <meta property="og:description" content="${esc(DESC)}" />
    <meta property="og:url" content="${SITE}" />
    <meta property="og:image" content="${SITE}og.jpg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Verse Mastery home screen: progress, days left and today's review" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
  </head>`;

const noscript = `<body>
    <noscript>
      <main style="max-width: 40rem; padding: 2rem; font: 1.05rem/1.6 system-ui, sans-serif">
        <h1>Verse Mastery, public edition</h1>
        <p>
          A free app for memorizing Bible verses with spaced repetition. Work through a set of passages, review
          them several ways (flashcards, fill the blanks, order the phrases, write it from memory), and watch a
          freshness score fade and recover along the forgetting curve so you know what to revisit and when. Speak
          mode runs hands-free: the app reads a reference and you recite the verse aloud.
        </p>
        <p>
          This edition uses the King James Version, which is in the public domain in the United States. There is no
          sign-up and nothing to install; progress is saved in your own browser and goes nowhere else.
        </p>
        <p>
          The app needs JavaScript to run. It is a derived edition of an MIT-licensed app, and the design and most
          of the code are the original authors'; see the <a href="${CREDIT}">credit in the README</a>.
        </p>
      </main>
    </noscript>`;

const file = `${OUT}/index.html`;
let html = readFileSync(file, "utf8");
const title = /<title>[^<]*<\/title>/;
if (!title.test(html) || !html.includes("</head>") || !html.includes("<body>")) {
  throw new Error(`${file}: expected a <title>, </head> and <body> to add to`);
}
html = html
  .replace(title, `<title>${esc(TITLE)}</title>`)
  .replace("</head>", head)
  .replace("<body>", noscript);
writeFileSync(file, html);

writeFileSync(
  `${OUT}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>
</urlset>
`,
);
copyFileSync("pages/llms.txt", `${OUT}/llms.txt`);
copyFileSync("pages/og.jpg", `${OUT}/og.jpg`);
console.log(`Added search and AI-answer basics to ${OUT}/ (head, noscript, sitemap.xml, llms.txt, og.jpg)`);
