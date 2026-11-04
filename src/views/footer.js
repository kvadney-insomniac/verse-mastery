/* App footer, a persistent feedback prompt linking to the bug / feature-request
 * form, and the notice belonging to whichever translation this build ships.
 * Rendered below the current view on every signed-in screen.
 *
 * The notice is not decoration: Crossway's API terms require it wherever their
 * text is shown, and the footer is the one place in the app that is under every
 * screen without being a card a member is working.
 *
 * It is read from data/translation.js rather than written out here, because
 * this app's scripture is pluggable (see data/translations.js) and a sentence
 * hard-coded about the ESV is a false statement on any build that does not
 * ship the ESV, the one kind of footer text that is worse than none, since the
 * whole reason the line exists is to be true about the text above it. The
 * notice therefore travels with the data it describes: regenerating the
 * passages rewrites data/translation.js in the same run, and this line changes
 * with them. An ESV build still carries Crossway's wording verbatim, which is
 * asserted character for character in test/translations.test.mjs.
 *
 * (`copy.footer.esv` still holds that same sentence and is now unused, the
 * notice is data about the build rather than copy about the app.) */

import { copy } from "../copy.js";
import { appConfig } from "../config.js";
import { translation } from "../../data/translation.js";
import { html, sx } from "../dom.js";
import { muted } from "../ui/tokens.js";

const LINK = "color:var(--color-accent);text-decoration:underline";

/* The feedback line, the optional "reach out" line and the optional "what this
 * does not do" link are per-deploy settings (src/config.js). An empty setting
 * draws nothing, so a build never links to a form or an address it does not
 * have. */
function contactHref(c) {
  if (/^(https?:|mailto:)/i.test(c)) return c;
  return c.includes("@") ? `mailto:${c}` : c;
}

export function footerView() {
  const { feedbackUrl, feedbackPrompt, feedbackLink, helpContact, aboutUrl } = appConfig;
  return html`<div
    style=${sx(`max-width:1280px;margin:0 auto;padding:0 36px 48px;font-size:13px;line-height:1.6;color:${muted(55)}`)}
  >
    ${
      feedbackUrl &&
      html`<div>
        ${feedbackPrompt || copy.footer.prompt}${" "}
        <a href=${feedbackUrl} target="_blank" rel="noopener noreferrer" style=${sx(LINK)}
          >${feedbackLink || copy.footer.link}</a
        >
      </div>`
    }
    ${
      helpContact &&
      html`<div>
        If you want help memorizing or studying,${" "}
        <a href=${contactHref(helpContact)} target="_blank" rel="noopener noreferrer" style=${sx(LINK)}>reach out</a>.
      </div>`
    }
    ${
      aboutUrl &&
      html`<div>
        <a href=${aboutUrl} target="_blank" rel="noopener noreferrer" style=${sx(LINK)}
          >What this app does and does not do</a
        >
      </div>`
    }
    <div
      style=${sx(`margin-top:14px;padding-top:12px;border-top:1px solid var(--color-divider);font-size:11px;color:${muted(42)};max-width:80ch`)}
    >
      ${translation.notice}
    </div>
  </div>`;
}
