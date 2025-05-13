import { defineConfig, devices } from "@playwright/test";
import { config as dotenvConfig } from "dotenv";

// Load environment variables from .env file
dotenvConfig({ path: ".env" });

export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: true,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: "html",
  retries: process.env.CI ? 2 : 0,
  testDir: "./tests",
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "on",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run web",
    reuseExistingServer: !process.env.CI,
    url: "http://localhost:3000",
  },
  workers: process.env.CI ? 1 : undefined,
});
