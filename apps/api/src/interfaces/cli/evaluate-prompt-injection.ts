import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluatePromptInjectionSuite, promptInjectionSuiteSchema } from "../../application/evaluation/prompt-injection-suite.js";

const filePath = process.argv[2];
if (!filePath) {
  throw new Error("Usage: npm run eval:security -- evals/security/prompt-injection.v1.json");
}

const suite = promptInjectionSuiteSchema.parse(JSON.parse(await readFile(resolve(filePath), "utf8")));
const report = evaluatePromptInjectionSuite(suite);
console.log(JSON.stringify({ suite: suite.name, ...report }, null, 2));
if (!report.passed) process.exitCode = 1;
