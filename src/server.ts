#!/usr/bin/env node
import AdmZip from "adm-zip";
import { spawn } from "child_process";
import { Content, FastMCP, imageContent } from "fastmcp";
import fs from "fs";
// Import jiti for TypeScript file handling
import jiti from "jiti";
import { fileURLToPath } from "url";
import yargs from "yargs";
import { z } from "zod";

import { filterNetworkTraceWithPreset } from "./networkTraceFilter.js";
import { filterTraceWithPreset } from "./traceFilter.js";

// Get current filename in ES modules
const __filename = fileURLToPath(import.meta.url);

const argv = yargs(process.argv.slice(2))
  .options({
    "playwright-config": {
      alias: "pc",
      default: "playwright.config.ts",
      demandOption: false,
      description:
        "The path to the playwright config file relative to the project root",
      type: "string",
    },
    "playwright-executable": {
      alias: "pe",
      default: "node_modules/.bin/playwright",
      demandOption: false,
      description:
        "The path to the playwright executable relative to the project root",
      type: "string",
    },
    "project-root": {
      alias: "pr",
      demandOption: true,
      description: "The absolute path to the project root",
      type: "string",
    },
  })
  .parseSync();

// Only worry about the .ts extension
const playwrightConfigPath = `${argv.projectRoot}/${argv.playwrightConfig}`;
if (!fs.existsSync(playwrightConfigPath)) {
  throw new Error(
    `Playwright config file not found at ${playwrightConfigPath}. Current working directory: ${process.cwd()}`
  );
}

const playwrightExecutablePath = `${argv.projectRoot}/${argv.playwrightExecutable}`;
if (!fs.existsSync(playwrightExecutablePath)) {
  throw new Error(
    `Playwright executable ${playwrightExecutablePath} does not exist. Current working directory: ${process.cwd()}`
  );
}

// Create a jiti instance
const requireTs = jiti(__filename, {
  interopDefault: true,
});

// Use the instance to require the playwright config
const getPlaywrightConfig = () => {
  try {
    return requireTs(playwrightConfigPath);
  } catch (error) {
    console.error("Error importing playwright config:", error);
    throw error;
  }
};

/**
 * Creates a filtered version of a network trace file to reduce size and remove bloated data
 * @param networkTraceFilePath The path to the original network trace file
 * @returns The path to the filtered network trace file
 */
async function createFilteredNetworkTrace(
  networkTraceFilePath: string
): Promise<string> {
  const filteredPath = networkTraceFilePath.replace(
    ".network",
    "_filtered.network"
  );

  // Check if filtered network trace already exists and is newer than original
  if (fs.existsSync(filteredPath)) {
    const originalStat = fs.statSync(networkTraceFilePath);
    const filteredStat = fs.statSync(filteredPath);
    if (filteredStat.mtime > originalStat.mtime) {
      return filteredPath;
    }
  }

  try {
    // Use the TypeScript network filtering function with minimal preset
    await filterNetworkTraceWithPreset(
      networkTraceFilePath,
      filteredPath,
      "minimal"
    );
    console.log(`Created filtered network trace: ${filteredPath}`);
    return filteredPath;
  } catch (error) {
    console.warn(`Error filtering network trace: ${error}`);
    return networkTraceFilePath;
  }
}

/**
 * Creates a filtered version of a trace file to reduce size and remove bloated data
 * @param traceFilePath The path to the original trace file
 * @returns The path to the filtered trace file
 */
async function createFilteredTrace(traceFilePath: string): Promise<string> {
  const filteredPath = traceFilePath.replace(".trace", "_filtered.trace");

  // Check if filtered trace already exists and is newer than original
  if (fs.existsSync(filteredPath)) {
    const originalStat = fs.statSync(traceFilePath);
    const filteredStat = fs.statSync(filteredPath);
    if (filteredStat.mtime > originalStat.mtime) {
      return filteredPath;
    }
  }

  try {
    // Use the TypeScript filtering function
    await filterTraceWithPreset(traceFilePath, filteredPath, "minimal");
    console.log(`Created filtered trace: ${filteredPath}`);
    return filteredPath;
  } catch (error) {
    console.warn(`Error filtering trace: ${error}`);
    return traceFilePath;
  }
}

/**
 * Constructs the full path to the trace directory from just the directory name
 * @param traceDirName The name of the trace directory (e.g. "home-homepage-has-correct-heading-chromium")
 * @returns The full path to the trace directory
 */
function getFullTracePath(traceDirName: string): string {
  const testResultsDirPath = getTestResultsDirPath();
  const fullPath = `${testResultsDirPath}/${traceDirName}`;
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Trace directory '${traceDirName}' not found`);
  }
  return fullPath;
}

function getTestResultsDirPath(): string {
  const playwrightConfig = getPlaywrightConfig();
  let outputDir = playwrightConfig?.outputDir || "test-results";
  outputDir = normalizeOutputDir(outputDir);
  return `${argv.projectRoot}/${outputDir}`;
}

/**
 * Extracts trace.zip file if the output directory doesn't already exist
 * @param traceDirName The name of the trace directory
 * @returns An object with the output directory path and a message including directory structure
 */
function maybeExtractTraceZip(traceDirName: string): {
  outputDir: string;
} {
  const traceDirectory = getFullTracePath(traceDirName);
  const outputDir = `${traceDirectory}/trace`;
  const zipPath = `${traceDirectory}/trace.zip`;
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Trace not found for directory ${traceDirName}`);
  }
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(outputDir, true);

  // Create filtered trace file if the main trace exists
  const mainTraceFile = `${outputDir}/0-trace.trace`;
  if (fs.existsSync(mainTraceFile)) {
    // Create filtered trace asynchronously - don't wait for it
    createFilteredTrace(mainTraceFile).catch((error) => {
      console.warn(`Failed to create filtered trace: ${error}`);
    });
  }

  // Create filtered network trace file if the network trace exists
  const networkTraceFile = `${outputDir}/0-trace.network`;
  if (fs.existsSync(networkTraceFile)) {
    // Create filtered network trace asynchronously - don't wait for it
    createFilteredNetworkTrace(networkTraceFile).catch((error) => {
      console.warn(`Failed to create filtered network trace: ${error}`);
    });
  }

  return {
    outputDir,
  };
}

/**
 * Normalizes an output directory path by removing leading "." or "./" and trailing "/"
 * @param outputDir The output directory path to normalize
 * @returns The normalized path
 */
function normalizeOutputDir(outputDir: string): string {
  let normalized = outputDir;
  // Normalize the outputDir by removing leading "." or "./" and trailing "/"
  if (normalized.startsWith("./")) {
    normalized = normalized.substring(2);
  } else if (normalized.startsWith(".")) {
    normalized = normalized.substring(1);
  }

  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

(async () => {
  try {
    const playwrightConfig = getPlaywrightConfig();
    console.log("playwrightConfig", playwrightConfig);
  } catch (error) {
    console.error("Error importing playwright config:", error);
  }
})();

const server = new FastMCP({
  name: "Addition",
  version: "1.0.0",
});

server.addTool({
  annotations: {
    openWorldHint: false,
    readOnlyHint: true,
    title: "Get Playwright Config",
  },
  description: "Returns the Playwright configuration as JSON",
  execute: async () => {
    const playwrightConfig = getPlaywrightConfig();
    return JSON.stringify(playwrightConfig, null, 2);
  },
  name: "get-config",
  parameters: z.object({}), // No parameters needed
});

server.addTool({
  annotations: {
    openWorldHint: false,
    readOnlyHint: true,
    title: "Get Network Log for Test Run",
  },
  description:
    "Get browser network logs for a test run. By default returns a filtered version that removes analytics, third-party services, and verbose metadata while preserving essential debugging information. Use raw=true to get unfiltered logs.",
  execute: async (args) => {
    const { outputDir } = maybeExtractTraceZip(args.traceDirectory);
    let output = "";
    const originalNetworkFilePath = `${outputDir}/0-trace.network`;

    try {
      if (args.raw) {
        // Return raw unfiltered network log
        const networkContent = fs.readFileSync(originalNetworkFilePath, "utf8");
        output += `Raw network log (unfiltered):\n\n${networkContent}`;
      } else {
        // Return filtered network log
        const filteredNetworkFilePath = await createFilteredNetworkTrace(
          originalNetworkFilePath
        );
        const networkContent = fs.readFileSync(filteredNetworkFilePath, "utf8");

        if (filteredNetworkFilePath.includes("_filtered.network")) {
          output += `Filtered network log (80%+ size reduction, third-party services removed):\n\n${networkContent}`;
        } else {
          output += `Network log:\n\n${networkContent}`;
        }
      }
    } catch (error) {
      output += `\n\nError reading network file: ${error}`;
    }
    return output;
  },
  name: "get-network-log",
  parameters: z.object({
    raw: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Return raw unfiltered network log including all analytics, third-party services, and verbose metadata. Default is false (filtered)."
      ),
    traceDirectory: z
      .string()
      .describe(
        "The name of the trace directory (e.g. 'home-homepage-has-correct-heading-chromium')"
      ),
  }),
});

server.addTool({
  annotations: {
    openWorldHint: false,
    readOnlyHint: true,
    title: "Get Trace for Test Run",
  },
  description:
    "Get the trace for a test run. This includes step-by-step playwright test execution info along with console logs. By default returns a filtered version that removes bloated data like DOM snapshots while preserving essential debugging information. Use raw=true to get unfiltered traces.",
  execute: async (args) => {
    const { outputDir } = maybeExtractTraceZip(args.traceDirectory);
    let output = "";
    const originalTraceFilePath = `${outputDir}/0-trace.trace`;

    try {
      if (args.raw) {
        // Return raw unfiltered trace
        const traceContent = fs.readFileSync(originalTraceFilePath, "utf8");
        output += `Raw trace content (unfiltered):\n\n${traceContent}`;
      } else {
        // Return filtered trace
        const filteredTraceFilePath = await createFilteredTrace(
          originalTraceFilePath
        );
        const traceContent = fs.readFileSync(filteredTraceFilePath, "utf8");

        if (filteredTraceFilePath.includes("_filtered.trace")) {
          output += `Filtered trace content (95%+ size reduction applied):\n\n${traceContent}`;
        } else {
          output += `Trace content:\n\n${traceContent}`;
        }
      }
    } catch (error) {
      output += `\n\nError reading trace: ${error}`;
    }
    return output;
  },
  name: "get-trace",
  parameters: z.object({
    raw: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Return raw unfiltered trace including all DOM snapshots and verbose data. Default is false (filtered)."
      ),
    traceDirectory: z
      .string()
      .describe(
        "The name of the trace directory (e.g. 'home-homepage-has-correct-heading-chromium')"
      ),
  }),
});

server.addTool({
  annotations: {
    openWorldHint: false,
    readOnlyHint: true,
    title: "List Playwright Tests",
  },
  description: "Lists all available Playwright tests",
  execute: async () => {
    const { exitCode, stderr, stdout } = await sunSubprocess(
      playwrightExecutablePath,
      ["test", "--list", "--config", playwrightConfigPath]
    );

    let output = stdout;
    if (stderr) {
      output = `${stderr}\n\n${stdout}`;
    }
    if (exitCode !== 0) {
      output = `${output}\n\nExited with code ${exitCode}`;
    }
    return output;
  },
  name: "list-tests",
  parameters: z.object({}), // No parameters needed
});

server.addTool({
  annotations: {
    openWorldHint: false,
    readOnlyHint: false, // This tool can modify state (run tests, create reports)
    title: "Run Playwright Tests",
  },
  description:
    "Runs Playwright tests, optionally specifying test files or test names",
  execute: async (args) => {
    const cmdArgs = [
      "test",
      "--config",
      playwrightConfigPath,
      "--trace",
      "on",
      "--retries",
      "0",
      "--max-failures",
      "0",
      "--reporter",
      "list",
    ];

    // Add test file path if provided
    if (args.grep) {
      cmdArgs.push("-g", args.grep);
    }
    if (args.debug) {
      cmdArgs.push("--debug");
    }
    if (args.ui) {
      cmdArgs.push("--ui");
    }
    if (args.timeout) {
      cmdArgs.push("--timeout", args.timeout.toString());
    }
    if (args.headed) {
      cmdArgs.push("--headed");
    }
    if (args.lastFailed) {
      cmdArgs.push("--last-failed");
    }
    if (args.fullyParallel) {
      cmdArgs.push("--fully-parallel");
    }

    try {
      const { stderr, stdout } = await sunSubprocess(
        playwrightExecutablePath,
        cmdArgs
      );
      let output = stdout;
      if (stderr) {
        output = `${stderr}\n\n${stdout}`;
      }
      const testResultsDirPath = getTestResultsDirPath();
      const traceDirs = fs.readdirSync(testResultsDirPath);
      output += `\n\nTrace directories:`;
      for (const traceDir of traceDirs) {
        const traceDirPath = `${testResultsDirPath}/${traceDir}`;
        if (fs.statSync(traceDirPath).isDirectory()) {
          output += `\n - ${traceDir}`;
        }
      }

      // Check for failed tests with error context and screenshots
      const content: Content[] = [];
      for (const traceDir of traceDirs) {
        const traceDirPath = `${testResultsDirPath}/${traceDir}`;
        if (fs.statSync(traceDirPath).isDirectory()) {
          const failedScreenshotPath = `${traceDirPath}/test-failed-1.png`;
          if (fs.existsSync(failedScreenshotPath)) {
            content.push({
              text: `Final screenshot for failed test ${traceDir}:`,
              type: "text",
            });
            content.push(await imageContent({ path: failedScreenshotPath }));
          }
        }
      }

      // Return content array with screenshots if we have any failed tests
      return {
        content: [{ text: output, type: "text" }, ...content],
      };
    } catch (error) {
      if (error instanceof Error) {
        return `Test execution failed: ${error.message}`;
      }
      return `Test execution failed with unknown error`;
    }
  },
  name: "run-tests",
  parameters: z.object({
    debug: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Run tests in debug mode. This lets the developer control test execution and step line by line through the code. Only do this if the developer specifically asks you to."
      ),
    fullyParallel: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Run tests in parallel. This is faster as long as the server doesn't get overwhelmed"
      ),
    grep: z
      .string()
      .optional()
      .default(".*")
      .describe(
        `Only run tests matching this regular expression (default: ".*")

**Instructions**

Let's say list-tests outputs an item like this:
> [chromium] › homepage.spec.ts:5:7 › Homepage › Has nav

In this format you see the file name, test description, and test name separated by "›".

Examples that will match:
- "homepage.spec.ts"
- "Homepage"
- "Homepage Has nav"
- "Has nav"

Examples that will NOT match:
- "Homepage > Has nav"
- "homepage.spec.ts Homepage Has nav"

Summary:
- Do not grep across file name _and_ description/test name. Do one or the other.
- Do not include the "›" in your grep value`
      ),
    headed: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Run tests in headed mode so the browser is visible to the developer"
      ),
    lastFailed: z
      .boolean()
      .optional()
      .default(false)
      .describe("Only run tests that failed in the last run"),
    timeout: z
      .number()
      .optional()
      .default(10000)
      .describe(
        "Specify test timeout threshold in milliseconds, zero for unlimited (default: 10000)"
      ),
    ui: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Run the tests in 'UI mode' which lets the developer control test execution and view console and network logs. Only do this if the developer specificallyasks you to."
      ),
  }),
});

server.addTool({
  annotations: {
    openWorldHint: false,
    readOnlyHint: true,
    title: "Get Test Screenshots",
  },
  description:
    "Get all available screenshots for a test run. Useful for debugging.",
  execute: async (args) => {
    const { traceDirectory } = args;
    const { outputDir } = maybeExtractTraceZip(traceDirectory);

    const resourcesDir = `${outputDir}/resources`;
    if (!fs.existsSync(resourcesDir)) {
      return `Resources directory not found in the trace directory`;
    }

    try {
      const files = fs.readdirSync(resourcesDir);
      const imageFiles = files.filter((file) => /\.(jpe?g|png)$/i.test(file));

      if (imageFiles.length === 0) {
        return "No screenshots found in the trace directory";
      }
      const content: Content[] = [];
      for (const imgFile of imageFiles) {
        const fullPath = `${outputDir}/resources/${imgFile}`;
        content.push({
          text: `Screenshot: ${imgFile}`,
          type: "text",
        });
        content.push(await imageContent({ path: fullPath }));
      }
      return {
        content,
      };
    } catch (error) {
      if (error instanceof Error) {
        return `Error listing screenshots: ${error.message}`;
      }
      return `Unknown error listing screenshots`;
    }
  },
  name: "get-screenshots",
  parameters: z.object({
    traceDirectory: z
      .string()
      .describe(
        "The name of the trace directory (e.g. 'home-homepage-has-correct-heading-chromium')"
      ),
  }),
});

async function sunSubprocess(
  command: string,
  args: string[]
): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  return new Promise((resolve, reject) => {
    // Create a process environment that includes all the current environment variables
    // This will ensure that environment variables loaded by dotenv are passed to the child process
    const processEnv = {
      ...process.env,
    };

    // Spawn the process with the environment variables and set the cwd to the project root path
    const childProcess = spawn(command, args, {
      cwd: argv.projectRoot, // Use the project root path as the working directory
      env: processEnv,
    });
    let stdout = "";
    let stderr = "";

    childProcess.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    childProcess.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    childProcess.on("close", (code: null | number) => {
      resolve({ exitCode: code ?? 0, stderr, stdout });
    });

    childProcess.on("error", (err: Error) => {
      reject(err);
    });
  });
}

server.start({
  transportType: "stdio",
});
