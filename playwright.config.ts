import { defineConfig, devices } from "@playwright/test";
import { execSync } from "child_process";
import { config as dotenvConfig } from "dotenv";
import * as fs from "fs";

// Load environment variables from .env file
dotenvConfig({ path: ".env" });

// Log for debugging
const cwd = execSync("pwd").toString().trim();
console.log("Current working directory:", cwd);

try {
  if (fs.existsSync(".env")) {
    const envContents = fs.readFileSync(".env", "utf-8");
    console.log(".env file contents:");
    console.log(envContents);
  } else {
    console.log(".env file not found in working directory");
  }
} catch (error) {
  console.log("Error reading .env file:", error);
}

console.log("TEST_ENV_VAR in config", process.env.TEST_ENV_VAR);
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
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run web",
    reuseExistingServer: !process.env.CI,
    url: "http://localhost:3000",
  },
  workers: process.env.CI ? 1 : undefined,
});
