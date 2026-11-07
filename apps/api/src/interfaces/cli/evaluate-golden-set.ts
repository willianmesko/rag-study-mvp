import { config } from "../../config.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateRetrieval, goldenSetSchema } from "../../modules/evaluations/application/evaluation/golden-set.js";
import { createApplication } from "../../app/app.module.js";

const filePath = process.argv[2];
if (!filePath) {
  throw new Error("Usage: npm run eval:golden -- evals/golden-set.v1.json");
}

const file = await readFile(resolve(filePath), "utf8");
const goldenSet = goldenSetSchema.parse(JSON.parse(file));
const app = createApplication(config);

try {
  const resultsByCaseId = new Map();
  for (const item of goldenSet.cases) {
    resultsByCaseId.set(item.id, await app.useCases.searchDocuments.execute({ query: item.question }));
  }
  const report = evaluateRetrieval(goldenSet, resultsByCaseId);
  console.log(JSON.stringify({ goldenSet: goldenSet.name, ...report }, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  await app.close();
}
