"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const add_js_1 = require("./add.js");
(0, vitest_1.it)("should add two numbers", () => {
    (0, vitest_1.expect)((0, add_js_1.add)(1, 2)).toBe(3);
});
