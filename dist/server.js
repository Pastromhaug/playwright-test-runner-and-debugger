#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fastmcp_1 = require("fastmcp");
const zod_1 = require("zod");
const add_js_1 = require("./add.js");
const server = new fastmcp_1.FastMCP({
    name: "Addition",
    version: "1.0.0",
});
server.addTool({
    annotations: {
        openWorldHint: false, // This tool doesn't interact with external systems
        readOnlyHint: true, // This tool doesn't modify anything
        title: "Addition",
    },
    description: "Add two numbers",
    execute: async (args) => {
        return String((0, add_js_1.add)(args.a, args.b));
    },
    name: "add",
    parameters: zod_1.z.object({
        a: zod_1.z.number().describe("The first number"),
        b: zod_1.z.number().describe("The second number"),
    }),
});
server.addResource({
    async load() {
        return {
            text: "Example log content",
        };
    },
    mimeType: "text/plain",
    name: "Application Logs",
    uri: "file:///logs/app.log",
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
