import { expect, test } from "@playwright/test";

test("dashboard has correct heading", async ({ page }) => {
  await page.goto("/");
  console.log("TEST_ENV_VAR", process.env.TEST_ENV_VAR);
  const heading = page.getByRole("heading", {
    name: "Playwright Test Runner MCP",
  });
  await expect(heading).toBeVisible();

  // Verify the text content
});

test("dashboard has correct subheading", async ({ page }) => {
  await page.goto("/");
  const paragraph = page.getByText(
    "This is the test page for running Playwright tests 2"
  );
  await expect(paragraph).toBeVisible();
});
