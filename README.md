# Playwright Test Runner and Debugger MCP

A Machine Code Processing (MCP) tool for executing and debugging Playwright tests directly from within Cursor or other AI coding environments.

## Overview

This MCP allows you to:

1. Run Playwright tests from your codebase
2. Debug failed tests with detailed trace information
3. View network logs, console output, and screenshots
4. Interactively debug tests with UI mode and headed browser options

## Installation

```bash
npm install @perandrestromhaug/playwright-test-runner-and-debugger --save-dev
```

## Setup

1. Ensure you have Playwright installed in your project:
```bash
npm install @playwright/test --save-dev
npx playwright install
```

2. Configure the MCP in your `.cursor/mcp.json` file (or equivalent file for Claude Desktop or Claude Code):
```json
{
  "playwright-test-runner-and-debugger": {
    "command": "npx",
    "args": [
      "-y",
      "@perandrestromhaug/playwright-test-runner-and-debugger",
      "--project-root",
      "/path/to/your/project"
    ]
  }
}
```

3. Make sure you have a playwright.config.ts file in your project root
4. Write your tests in the directory specified in your playwright.config.ts

## Tools

### get-config
* **Description**: Returns the Playwright configuration as JSON
* **Parameters**: None
* **Output**: JSON representation of your Playwright configuration

### list-tests
* **Description**: Lists all available Playwright tests
* **Parameters**: None
* **Output**: List of all available Playwright tests with file paths and test names

### run-tests
* **Description**: Runs Playwright tests, optionally specifying test files or test names
* **Parameters**:
  * `grep` (string, optional): Only run tests matching this regular expression
  * `headed` (boolean, optional, default: true): Run tests in headed mode with visible browser
  * `debug` (boolean, optional, default: false): Run tests in debug mode for step-by-step execution
  * `ui` (boolean, optional, default: false): Run tests in UI mode for interactive debugging
  * `timeout` (number, optional, default: 10000): Specify test timeout in milliseconds
  * `lastFailed` (boolean, optional, default: false): Only run tests that failed in the last run
  * `fullyParallel` (boolean, optional, default: true): Run tests in parallel
* **Output**: 
  * Test execution results
  * List of trace directories
  * Screenshots for any failed tests

### get-trace
* **Description**: Gets the trace for a test run, including step-by-step execution info and console logs. By default returns a filtered version that removes bloated data like DOM snapshots while preserving essential debugging information.
* **Parameters**: 
  * `traceDirectory` (string, required): The name of the trace directory (e.g., "home-homepage-has-correct-heading-chromium")
  * `raw` (boolean, optional, default: false): Return raw unfiltered trace including all DOM snapshots and verbose data
* **Output**: Detailed trace information showing each step of test execution and console logs (filtered by default)

### get-network-log
* **Description**: Gets browser network logs for a test run. By default returns a filtered version that removes analytics, third-party services, and verbose metadata while preserving essential debugging information.
* **Parameters**: 
  * `traceDirectory` (string, required): The name of the trace directory
  * `raw` (boolean, optional, default: false): Return raw unfiltered network log including all analytics, third-party services, and verbose metadata
* **Output**: Network requests and responses (filtered by default for 80%+ size reduction, focused on localhost application traffic)

### get-screenshots
* **Description**: Gets all available screenshots for a test run
* **Parameters**: `traceDirectory` (string, required): The name of the trace directory
* **Output**: All screenshots captured during test execution with their names


