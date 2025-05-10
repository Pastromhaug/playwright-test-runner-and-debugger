#!/usr/bin/env node

import { PlaywrightTestConfig } from "@playwright/test";
import { spawn } from "child_process";
import { FastMCP } from "fastmcp";
import fs from "fs";
import yargs from "yargs";
import { z } from "zod";

import { add } from "./add.js";

const argv = yargs(process.argv.slice(2))
  .options({
    "project-root-path": {
      alias: "prp",
      demandOption: true,
      description: "The absolute path to the project root",
      type: "string",
    },
  })
  .parseSync();

const playwrightConfigPath = `${argv.projectRootPath}/playwright.config.ts`;
if (!fs.existsSync(playwrightConfigPath)) {
  throw new Error(
    `Playwright config file ${playwrightConfigPath} does not exist. Current working directory: ${process.cwd()}`
  );
}
const playwrightExecutablePath = `${argv.projectRootPath}/node_modules/.bin/playwright`;
if (!fs.existsSync(playwrightExecutablePath)) {
  throw new Error(
    `Playwright executable ${playwrightExecutablePath} does not exist. Current working directory: ${process.cwd()}`
  );
}

(async () => {
  const playwrightConfig: PlaywrightTestConfig = (
    await import(playwrightConfigPath)
  ).default;
  console.log("playwrightConfig", playwrightConfig);
})();

const server = new FastMCP({
  name: "Addition",
  version: "1.0.0",
});

const getPlaywrightConfig = async () => {
  const configModule = await import(playwrightConfigPath);
  return configModule.default;
};

server.addResource({
  async load() {
    const playwrightConfig: PlaywrightTestConfig = await getPlaywrightConfig();
    return {
      text: JSON.stringify(playwrightConfig, null, 2),
    };
  },
  mimeType: "application/json",
  name: "playwright-config",
  uri: "file:///playwright-config.json",
});

server.addTool({
  annotations: {
    openWorldHint: true, // Interacts with external playwright process
    readOnlyHint: true, // Just reads test info, doesn't modify anything
    title: "List Playwright Tests",
  },
  description: "Lists all available Playwright tests",
  execute: async () => {
    const { stderr, stdout } = await sunSubprocess(playwrightExecutablePath, [
      "test",
      "--list",
      "--config",
      playwrightConfigPath,
    ]);

    let output = stdout;
    if (stderr) {
      output = `${stderr}\n\n${stdout}`;
    }
    return output;
  },
  name: "list-tests",
  parameters: z.object({}), // No parameters needed
});

server.addTool({
  annotations: {
    openWorldHint: false, // This tool doesn't interact with external systems
    readOnlyHint: true, // This tool doesn't modify anything
    title: "Addition",
  },
  description: "Add two numbers",
  execute: async (args) => {
    return String(add(args.a, args.b));
  },
  name: "add",
  parameters: z.object({
    a: z.number().describe("The first number"),
    b: z.number().describe("The second number"),
  }),
});

server.addPrompt({
  arguments: [
    {
      description: "Git diff or description of changes",
      name: "changes",
      required: true,
    },
  ],
  description: "Generate a Git commit message",
  load: async (args) => {
    return `Generate a concise but descriptive commit message for these changes:\n\n${args.changes}`;
  },
  name: "git-commit",
});

server.start({
  transportType: "stdio",
});

async function sunSubprocess(
  command: string,
  args: string[]
): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args);
    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    process.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    process.on("close", (code) => {
      if (code === 0) {
        resolve({ stderr, stdout });
      } else {
        reject(
          new Error(`Command failed with exit code ${code}\nStderr: ${stderr}`)
        );
      }
    });

    process.on("error", (err) => {
      reject(err);
    });
  });
}
