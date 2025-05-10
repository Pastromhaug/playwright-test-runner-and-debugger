import { test, expect } from "@playwright/test";

test("homepage has correct heading", async ({ page }) => {
  await page.goto("/");

  // Check if the heading is present
  const heading = page.getByRole("heading", {
    name: "Playwright Test Runner MCP",
  });
  await expect(heading).toBeVisible();

  // Verify the text content
  const paragraph = page.getByText(
    "This is the test page for running Playwright tests"
  );
  await expect(paragraph).toBeVisible();
});
