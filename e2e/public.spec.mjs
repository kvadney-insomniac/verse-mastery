/* The public edition, as a stranger meets it: no profile, no account, the
 * settings .github/workflows/pages.yml writes into config.js. Nobody here has a
 * name or a ministry group, so every screen that reads one has to cope without
 * it; the fixture fails the test if any of them logs an error. */

import { test, expect } from "./fixtures.mjs";

const PUBLIC = {
  groupName: "Public edition, King James Version",
  requireProfile: false,
  feedbackUrl: "https://forms.example.test/feedback",
  feedbackPrompt: "What helped, what did not, and what would you want?",
  feedbackLink: "Tell us in three short questions.",
  aboutUrl: "https://example.test/readme#what-it-does-not-do",
};

test("a stranger lands on the board, not the profile form", async ({ app, page }) => {
  await app.boot({ profile: null, config: PUBLIC });
  await expect(app.board).toBeVisible();
  await expect(page.getByText("Tell us in three short questions.")).toHaveAttribute("href", PUBLIC.feedbackUrl);
  await expect(page.getByText("What this app does and does not do")).toHaveAttribute("href", PUBLIC.aboutUrl);
});

test("every screen in the header opens without a profile", async ({ app, page }) => {
  await app.boot({ profile: null, config: PUBLIC });
  const labels = await app.header.getByRole("button").allInnerTexts();
  expect(labels.length).toBeGreaterThan(3);
  for (const label of labels.map((l) => l.trim()).filter(Boolean)) {
    const button = app.header.getByRole("button", { name: label, exact: true });
    if (!(await button.count())) continue;
    await button.first().click();
    await page.waitForTimeout(150);
    await expect(page.locator("body")).not.toBeEmpty();
  }
});

test("with no feedback url the line is not drawn", async ({ app, page }) => {
  await app.boot({ profile: null, config: { ...PUBLIC, feedbackUrl: "", aboutUrl: "" } });
  await expect(app.board).toBeVisible();
  await expect(page.getByText("Tell us in three short questions.")).toHaveCount(0);
  await expect(page.getByText("What this app does and does not do")).toHaveCount(0);
});
