#!/usr/bin/env python3
"""check_seo.py: mechanical SEO and GEO checks for one or more pages.

Usage:
  check_seo.py URL [URL ...] [--live-base LIVE] [--site-base BASE] [--json] [--min-score N]

Standard library only, Python 3.9+. No network calls except to the pages checked,
their own alternates, images, sitemap, robots.txt and llms.txt.

Testing a local server before a deploy:
  check_seo.py http://127.0.0.1:8766/ --live-base https://example.github.io/site/
The local origin stands in for LIVE: canonical, hreflang, og:url and the sitemap must
name LIVE urls, and they are fetched from the local server.

Exit code: 0 when no check FAILs (and the score is at least --min-score), else 1.
WARN never fails the run. The checklist behind each id is docs/seo-geo-checklist.md.
"""
import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

VERSION = "1.0.0"
UA = "check_seo/" + VERSION
TRACKERS = (
    "googletagmanager.com", "google-analytics.com", "doubleclick.net", "plausible.io",
    "segment.com", "hotjar.com", "clarity.ms", "facebook.net", "mixpanel.com",
    "amplitude.com", "cloudflareinsights.com", "umami.is", "posthog.com", "sentry.io",
    "fullstory.com", "matomo", "goatcounter.com", "statcounter.com",
)
GENERIC_LINK_TEXT = {"click here", "here", "read more", "more", "link", "this", "learn more", "こちら", "ここ"}
EM_DASH = chr(0x2014)


def fetch(url, method="GET", limit=3_000_000):
    """Return (status, final_url, headers, body_bytes). status 0 means no connection."""
    req = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read(limit) if method == "GET" else b""
            return r.status, r.geturl(), {k.title(): v for k, v in r.headers.items()}, body
    except urllib.error.HTTPError as e:
        return e.code, url, {k.title(): v for k, v in (e.headers or {}).items()}, b""
    except Exception:
        return 0, url, {}, b""


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lang = None
        self.title = ""
        self.metas = []          # dicts
        self.links = []          # dicts (link rel=...)
        self.jsonld = []         # raw strings
        self.headings = []       # (level, text)
        self.imgs = []           # dicts
        self.anchors = []        # (href, text, aria)
        self.scripts = []        # src
        self.other_src = []      # iframe/img/link hrefs to other hosts
        self.text = []
        self._stack = []
        self._cap = None         # current capture buffer name
        self._buf = []
        self._a = None
        self._in_body = False
        self._noscript = 0
        self.noscript_text = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "html":
            self.lang = a.get("lang")
        elif tag == "body":
            self._in_body = True
        elif tag == "title" and not self._in_body:
            self._cap, self._buf = "title", []
        elif tag == "meta":
            self.metas.append(a)
        elif tag == "link":
            self.links.append(a)
        elif tag == "script":
            if a.get("type", "").lower() == "application/ld+json":
                self._cap, self._buf = "jsonld", []
            else:
                self._cap, self._buf = "script", []
                if a.get("src"):
                    self.scripts.append(a["src"])
        elif tag == "style":
            self._cap, self._buf = "style", []
        elif tag == "noscript":
            self._noscript += 1
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._cap, self._buf = tag, []
        elif tag == "img":
            self.imgs.append(a)
        elif tag == "iframe" and a.get("src"):
            self.other_src.append(a["src"])
        elif tag == "a":
            self._a = [a.get("href", ""), [], a.get("aria-label", "") or a.get("title", "")]

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag == "title" and self._cap == "title":
            self.title = " ".join("".join(self._buf).split())
            self._cap = None
        elif tag == "script" and self._cap in ("jsonld", "script"):
            if self._cap == "jsonld":
                self.jsonld.append("".join(self._buf))
            self._cap = None
        elif tag == "style" and self._cap == "style":
            self._cap = None
        elif tag == "noscript":
            self._noscript = max(0, self._noscript - 1)
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6") and self._cap == tag:
            self.headings.append((int(tag[1]), " ".join("".join(self._buf).split())))
            self._cap = None
        elif tag == "a" and self._a:
            self.anchors.append((self._a[0], " ".join("".join(self._a[1]).split()), self._a[2]))
            self._a = None

    def handle_data(self, data):
        if self._cap in ("title", "jsonld", "script", "style"):
            self._buf.append(data)
            return
        if self._cap:
            self._buf.append(data)
        if self._a is not None:
            self._a[1].append(data)
        if self._in_body:
            (self.noscript_text if self._noscript else self.text).append(data)

    def meta(self, key):
        for m in self.metas:
            if m.get("name", "").lower() == key or m.get("property", "").lower() == key:
                return m.get("content", "")
        return None

    def rel(self, name):
        return [l for l in self.links if name in l.get("rel", "").lower().split()]


def site_base_of(url):
    """Project sites on github.io live under the first path segment."""
    p = urlparse(url)
    if p.netloc.endswith(".github.io"):
        seg = [s for s in p.path.split("/") if s]
        if seg and not p.netloc.lower().startswith(seg[0].lower() + "."):
            return "%s://%s/%s/" % (p.scheme, p.netloc, seg[0])
    return "%s://%s/" % (p.scheme, p.netloc)


def norm(u):
    p = urlparse(u)
    path = p.path or "/"
    if path.endswith("/index.html"):
        path = path[: -len("index.html")]
    return "%s://%s%s" % (p.scheme, p.netloc.lower(), path)


def jsonld_types(raw_blocks):
    types, errors = [], 0
    def walk(o):
        if isinstance(o, dict):
            t = o.get("@type")
            if isinstance(t, str):
                types.append(t)
            elif isinstance(t, list):
                types.extend(x for x in t if isinstance(x, str))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    for raw in raw_blocks:
        try:
            walk(json.loads(raw))
        except Exception:
            errors += 1
    return types, errors


class Checker:
    def __init__(self, url, live_base=None, site_base=None):
        self.url = url
        self.results = []   # (id, status, detail)
        self.local_base = None
        self.live_base = None
        if live_base:
            self.live_base = live_base if live_base.endswith("/") else live_base + "/"
            self.local_base = site_base or ("%s://%s/" % (urlparse(url).scheme, urlparse(url).netloc))
            self.site_base = self.local_base
        else:
            self.site_base = site_base or site_base_of(url)
        if not self.site_base.endswith("/"):
            self.site_base += "/"

    # live <-> local mapping, so a local preview can be checked against live urls
    def to_live(self, u):
        if self.live_base and u.startswith(self.local_base):
            return self.live_base + u[len(self.local_base):]
        return u

    def to_fetch(self, u):
        if self.live_base and u.startswith(self.live_base):
            return self.local_base + u[len(self.live_base):]
        return u

    def add(self, cid, status, detail=""):
        self.results.append((cid, status, detail))

    def ok(self, cid, cond, good="", bad="", warn=False):
        self.add(cid, "PASS" if cond else ("WARN" if warn else "FAIL"), good if cond else bad)

    def run(self):
        status, final, headers, body = fetch(self.url)
        self.ok("http-200", status == 200, "200", "status %s" % status)
        if status != 200:
            return self
        html = body.decode("utf-8", "replace")
        p = Page()
        try:
            p.feed(html)
        except Exception as e:
            self.add("html-parse", "FAIL", str(e))
            return self
        expected = norm(self.to_live(self.url))
        robots_meta = (p.meta("robots") or "").lower()
        if "noindex" in robots_meta:
            self.add("indexable", "INFO", "noindex is set on purpose? the remaining search checks are skipped")
            self._privacy(p)
            return self
        self.add("indexable", "PASS", "no noindex")

        # 1 title, description, lang
        t = p.title
        self.ok("title", 10 <= len(t) <= 70, "%d chars: %s" % (len(t), t), "%d chars (want 10 to 70): %s" % (len(t), t), warn=bool(t))
        d = p.meta("description") or ""
        self.ok("meta-description", 50 <= len(d) <= 200, "%d chars" % len(d),
                "%d chars (want 50 to 200)" % len(d), warn=bool(d))
        self.ok("html-lang", bool(p.lang), p.lang or "", "no lang attribute on <html>")
        self.ok("no-em-dash", EM_DASH not in t + d, "", "em dash in the title or description")
        self.ok("viewport", p.meta("viewport") is not None, "", "no viewport meta")

        # 2 canonical
        canon = [l.get("href", "") for l in p.rel("canonical")]
        if len(canon) != 1:
            self.add("canonical", "FAIL", "%d canonical links (want exactly 1)" % len(canon))
        else:
            c = canon[0]
            absolute = bool(urlparse(c).scheme)
            self.ok("canonical", absolute and norm(c) == expected,
                    c, "canonical is %s, page is %s%s" % (c, expected, "" if absolute else " (not absolute)"),
                    warn=absolute)

        # 3 hreflang
        alts = [(l.get("hreflang", ""), l.get("href", "")) for l in p.rel("alternate") if l.get("hreflang")]
        if alts:
            langs = dict(alts)
            self_listed = any(norm(h) == expected for _, h in alts)
            self.ok("hreflang-self", self_listed, "", "the page does not list itself among its hreflang alternates")
            self.ok("hreflang-x-default", "x-default" in langs, "", "no x-default alternate", warn=True)
            missing = []
            for lang, href in alts:
                if norm(href) == expected or lang == "x-default":
                    continue
                s, _, _, b = fetch(self.to_fetch(href))
                if s != 200:
                    missing.append("%s returns %s" % (href, s))
                    continue
                q = Page()
                q.feed(b.decode("utf-8", "replace"))
                back = [l.get("href", "") for l in q.rel("alternate") if l.get("hreflang")]
                if not any(norm(h) == expected for h in back):
                    missing.append("%s does not link back" % href)
            self.ok("hreflang-reciprocal", not missing, "%d alternates link back" % (len(alts)), "; ".join(missing))
        else:
            self.add("hreflang", "INFO", "no hreflang alternates (fine for a one-language site)")

        # 5 Open Graph and Twitter card
        og = {k: p.meta("og:" + k) for k in ("title", "type", "image", "url", "description")}
        miss = [k for k, v in og.items() if not v]
        self.ok("og-tags", not miss, "", "missing og:" + ", og:".join(miss))
        if og["image"]:
            s, _, h, _ = fetch(self.to_fetch(og["image"]), method="GET", limit=64)
            ctype = h.get("Content-Type", "")
            self.ok("og-image-loads", s == 200 and ctype.startswith("image/") and bool(urlparse(og["image"]).scheme),
                    ctype, "og:image %s returns %s %s" % (og["image"], s, ctype))
        if og["url"]:
            self.ok("og-url", norm(og["url"]) == expected, "", "og:url is %s, page is %s" % (og["url"], expected), warn=True)
        self.ok("twitter-card", bool(p.meta("twitter:card")), p.meta("twitter:card") or "", "no twitter:card meta")

        # 6 JSON-LD
        types, errs = jsonld_types(p.jsonld)
        self.ok("jsonld-present", bool(p.jsonld), ", ".join(sorted(set(types))), "no JSON-LD block")
        if p.jsonld:
            self.ok("jsonld-parses", errs == 0 and bool(types), "", "%d block(s) do not parse or have no @type" % errs)

        # 7 headings and link text
        h1 = [h for h in p.headings if h[0] == 1]
        self.ok("one-h1", len(h1) == 1, h1[0][1][:60] if h1 else "", "%d h1 elements (want exactly 1)" % len(h1))
        skips, prev = [], 0
        for lvl, txt in p.headings:
            if prev and lvl > prev + 1:
                skips.append("h%d to h%d at '%s'" % (prev, lvl, txt[:30]))
            prev = lvl
        self.ok("heading-order", not skips, "", "; ".join(skips[:4]), warn=True)
        generic = [t2 for href, t2, aria in p.anchors if t2.lower().strip(" .>") in GENERIC_LINK_TEXT and not aria]
        empty = [href for href, t2, aria in p.anchors if href and not t2 and not aria]
        self.ok("link-text", not generic, "", "generic link text: " + ", ".join(sorted(set(generic))[:5]), warn=True)
        if empty:
            self.add("link-text-empty", "INFO", "%d links have no text (fine when they wrap an image with alt)" % len(empty))

        # 8 crawlable text without scripts
        words = len(" ".join(p.text).split())
        chars = len("".join("".join(p.text).split()))
        ns_chars = len("".join("".join(p.noscript_text).split()))
        self.ok("crawlable-text", chars >= 250 or ns_chars >= 250, "%d words in the HTML itself" % words,
                "only %d characters of text without running scripts (want 250 or more, or a noscript block)" % chars)

        # 9 images
        noalt = [i.get("src", "") for i in p.imgs if "alt" not in i]
        self.ok("img-alt", not noalt, "%d images" % len(p.imgs), "%d images have no alt attribute: %s" % (len(noalt), ", ".join(noalt[:3])))
        nodim = [i for i in p.imgs if not (i.get("width") and i.get("height"))]
        self.ok("img-dimensions", not nodim, "", "%d images have no width and height (layout shift risk)" % len(nodim), warn=True)

        # 4 sitemap and robots
        s, _, _, b = fetch(urljoin(self.site_base, "sitemap.xml"))
        if s == 200:
            locs = [norm(x) for x in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", b.decode("utf-8", "replace"))]
            self.ok("sitemap", expected in locs, "%d urls" % len(locs), "sitemap.xml does not list %s" % expected)
        else:
            self.add("sitemap", "FAIL", "no sitemap.xml at %s" % self.site_base)
        live_site = self.to_live(self.site_base)
        host_root = "%s://%s/" % (urlparse(live_site).scheme, urlparse(live_site).netloc)
        if True:
            s, _, _, b = fetch(urljoin(host_root, "robots.txt"))
            if s == 200:
                txt = b.decode("utf-8", "replace")
                self.ok("robots-sitemap-line", live_site.rstrip("/") in txt and "sitemap" in txt.lower(), "",
                        "host robots.txt has no Sitemap line for %s" % live_site, warn=True)
            elif host_root != live_site:
                self.add("robots-host-root", "INFO",
                         "no robots.txt at %s (crawlers read it only there; a project site cannot add one, so submit the sitemap in Search Console and Bing)" % host_root)
            else:
                self.add("robots-host-root", "FAIL", "no robots.txt at %s" % host_root)

        # 10 llms.txt and a quotable about paragraph
        s, _, _, b = fetch(urljoin(self.site_base, "llms.txt"))
        if s == 200:
            txt = b.decode("utf-8", "replace")
            good = txt.lstrip().startswith("# ") and re.search(r"^> ", txt, re.M) is not None
            self.ok("llms-txt", good, "", "llms.txt needs an H1 line and a '> ' summary line")
            self.ok("llms-txt-no-em-dash", EM_DASH not in txt, "", "em dash in llms.txt")
        else:
            self.add("llms-txt", "FAIL", "no llms.txt at %s" % self.site_base)

        # 12 a missing page answers 404
        s, _, _, _ = fetch(urljoin(self.site_base, "check-seo-no-such-page-7f3a/"))
        self.ok("404-status", s == 404, "", "a missing page returns %s, not 404" % s)

        self._privacy(p)
        return self

    def _privacy(self, p):
        host = urlparse(self.to_live(self.url)).netloc
        ext = sorted({urlparse(urljoin(self.url, s)).netloc for s in p.scripts + p.other_src} - {host, urlparse(self.url).netloc, ""})
        bad = [h for h in ext if any(t in h for t in TRACKERS)]
        self.ok("no-trackers", not bad, "", "tracking or analytics host: " + ", ".join(bad))
        if ext:
            self.add("third-party-scripts", "INFO", ", ".join(ext))

    def score(self):
        graded = [r for r in self.results if r[1] in ("PASS", "FAIL", "WARN")]
        if not graded or any(r[0] == "indexable" and r[1] == "INFO" for r in self.results):
            return None  # noindex page: search checks do not apply
        pts = sum(1.0 if r[1] == "PASS" else 0.5 if r[1] == "WARN" else 0.0 for r in graded)
        return int(round(100 * pts / len(graded)))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("urls", nargs="+")
    ap.add_argument("--live-base", help="live site base that the local url stands in for")
    ap.add_argument("--site-base", help="site base (default: repo folder on github.io, else the host root)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--min-score", type=int, default=0)
    ap.add_argument("--version", action="version", version=VERSION)
    a = ap.parse_args()
    out, failed = [], False
    for u in a.urls:
        c = Checker(u, a.live_base, a.site_base).run()
        sc = c.score()
        fails = [r for r in c.results if r[1] == "FAIL"]
        failed = failed or bool(fails) or (sc is not None and sc < a.min_score)
        out.append({"url": u, "score": sc, "results": [{"id": i, "status": s, "detail": d} for i, s, d in c.results]})
        if not a.json:
            print("%s  score %s  (%d fail, %d warn)" % (u, "n/a (noindex)" if sc is None else "%d/100" % sc, len(fails), sum(1 for r in c.results if r[1] == "WARN")))
            for i, s, d in c.results:
                if s != "PASS":
                    print("  %-4s %-22s %s" % (s, i, d))
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=1))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
