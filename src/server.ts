#!/usr/bin/env node
import AdmZip from "adm-zip";
import { spawn } from "child_process";
import { FastMCP } from "fastmcp";
import fs from "fs";
// Import jiti for TypeScript file handling
import jiti from "jiti";
import { dirname } from "path";
import { fileURLToPath } from "url";
import yargs from "yargs";
import { z } from "zod";

// Get current filename and directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
 * Extracts trace.zip file if the output directory doesn't already exist
 * @param traceDirectory The directory containing the trace.zip file
 * @returns An object with the output directory path and a message including directory structure
 */
function maybeExtractTraceZip(traceDirectory: string): {
  message: string;
  outputDir: string;
} {
  const outputDir = `${traceDirectory}/trace`;
  let message = "";
  if (fs.existsSync(outputDir)) {
    message = `Using existing trace files in ${outputDir}.`;
  } else {
    const zipPath = `${traceDirectory}/trace.zip`;
    if (!fs.existsSync(zipPath)) {
      throw new Error(`Trace zip file not found at ${zipPath}`);
    }
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(outputDir, true);
    message = `Extracted trace files to ${outputDir}.`;
  }
  try {
    const files = fs.readdirSync(outputDir, { recursive: true });
    message += `\n\nTrace directory structure:\n${files.join("\n")}`;
  } catch (error) {
    message += `\n\nError reading trace directory: ${error}`;
  }
  return {
    message,
    outputDir,
  };
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
    const { message, outputDir } = maybeExtractTraceZip(args.traceDirectory);
    let output = message;

    const networkFilePath = `${outputDir}/0-trace.network`;
    try {
      const networkContent = fs.readFileSync(networkFilePath, "utf8");
      output += `\n\nNetwork content from ${networkFilePath}:\n\n${networkContent}`;
    } catch (error) {
      output += `\n\nError reading network file: ${error}`;
    }
    return output;
  },
  name: "get-network-log",
  parameters: z.object({
    traceDirectory: z
      .string()
      .describe("The directory the trace.zip was saved to"),
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
    const { message, outputDir } = maybeExtractTraceZip(args.traceDirectory);
    let output = message;

    const traceFilePath = `${outputDir}/0-trace.trace`;
    try {
      const traceContent = fs.readFileSync(traceFilePath, "utf8");
      output += `\n\nTrace content from ${traceFilePath}:\n\n${traceContent}`;
    } catch (error) {
      output += `\n\nError reading trace file: ${error}`;
    }
    return output;
  },
  name: "get-trace",
  parameters: z.object({
    traceDirectory: z
      .string()
      .describe("The directory the trace.zip was saved to"),
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
      "list,json",
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
