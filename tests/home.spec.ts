import { expect, test } from "@playwright/test";

test("homepage has correct heading", async ({ page }) => {
  await page.goto("/");
  const heading = page.getByRole("heading", {
    name: "Playwright Test Runner MCP",
  });
  await expect(heading).toBeVisible();

  // Verify the text content
});

test("homepage has correct subheading", async ({ page }) => {
  await page.goto("/");
  const paragraph = page.getByText(
    "This is the test page for running Playwright tests"
  );
  await expect(paragraph).toBeVisible();
});
