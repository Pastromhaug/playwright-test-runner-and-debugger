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

// Get current filename in ES modules
const __filename = fileURLToPath(import.meta.url);

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

// Only worry about the .ts extension
const playwrightConfigPath = `${argv.projectRootPath}/playwright.config.ts`;
if (!fs.existsSync(playwrightConfigPath)) {
  throw new Error(
    `Playwright config file not found at ${playwrightConfigPath}. Current working directory: ${process.cwd()}`
  );
}

const playwrightExecutablePath = `${argv.projectRootPath}/node_modules/.bin/playwright`;
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
  return `${argv.projectRootPath}/${outputDir}`;
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
    "Get browser network logs for a test run. Useful for debugging test failures",
  execute: async (args) => {
    const { outputDir } = maybeExtractTraceZip(args.traceDirectory);
    let output = "";
    const networkFilePath = `${outputDir}/0-trace.network`;
    try {
      const networkContent = fs.readFileSync(networkFilePath, "utf8");
      output += `Network log:\n\n${networkContent}`;
    } catch (error) {
      output += `\n\nError reading network file: ${error}`;
    }
    return output;
  },
  name: "get-network-log",
  parameters: z.object({
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
    "Get the trace for a test run. This includes step-by-step playwright test execution info along with console logs. Useful for debugging test failures",
  execute: async (args) => {
    const { outputDir } = maybeExtractTraceZip(args.traceDirectory);
    let output = "";
    const traceFilePath = `${outputDir}/0-trace.trace`;
    try {
      const traceContent = fs.readFileSync(traceFilePath, "utf8");
      output += `Trace content:\n\n${traceContent}`;
    } catch (error) {
      output += `\n\nError reading trace: ${error}`;
    }
    return output;
  },
  name: "get-trace",
  parameters: z.object({
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
      return output;
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
        "Run tests in debug mode. This lets the developer control test execution and step line by line through the code"
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
        'Only run tests matching this regular expression (default: ".*")'
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
        "Run the tests in 'UI mode' which lets the developer control test execution and view console and network logs"
      ),
  }),
});

// server.addTool({
//   annotations: {
//     openWorldHint: false,
//     readOnlyHint: true,
//     title: "View Test Screenshot",
//   },
//   description: "Get a screenshot from a test run. Returns the image directly.",
//   execute: async (args) => {
//     const { screenshotFileName, traceDirectory } = args;
//     try {
//       let normalizedPath = screenshotFileName;
//       if (!normalizedPath.startsWith("resources/")) {
//         normalizedPath = `resources/${normalizedPath}`;
//       }
//       const fullPath = `${traceDirectory}/trace/${normalizedPath}`;
//       if (!fs.existsSync(fullPath)) {
//         return `Screenshot not found at ${fullPath}`;
//       }
//       return imageContent({
//         path: fullPath,
//       });
//     } catch (error) {
//       if (error instanceof Error) {
//         return `Error reading screenshot: ${error.message}`;
//       }
//       return `Unknown error reading screenshot`;
//     }
//   },
//   name: "view-screenshot",
//   parameters: z.object({
//     screenshotFileName: z
//       .string()
//       .describe(
//         "The name of the screenshot file within the trace/resources directory (just file name, not path)"
//       ),
//     traceDirectory: z
//       .string()
//       .describe("The directory the trace.zip was saved to"),
//   }),
// });

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
      resolve({ exitCode: code ?? 0, stderr, stdout });
    });

    process.on("error", (err) => {
      reject(err);
    });
  });
}

server.start({
  transportType: "stdio",
});
