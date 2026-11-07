import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import type { ZodType } from "zod";
import { replaySuiteSchema } from "../../application/evaluation/replay-benchmark.js";
import { approveReviewedReplay, replayReviewAttestationSchema } from "../../application/evaluation/reviewed-replay.js";

const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const { values } = parseArgs({ options: {
  suite: { type: "string" }, attestation: { type: "string" }, output: { type: "string" }
} });

async function parseFile<T>(file: string, schema: ZodType<T>, label: string): Promise<T> {
  let input: unknown;
  try { input = JSON.parse(await readFile(resolve(repository, file), "utf8")); }
  catch { throw new Error(`${label} could not be read as JSON.`); }
  const result = schema.safeParse(input);
  if (!result.success) {
    const locations = result.error.issues.map(({ path }) => path.join(".") || "root").join(", ");
    throw new Error(`${label} did not pass validation at ${locations}.`);
  }
  return result.data;
}

if (!values.suite || !values.attestation || !values.output) {
  throw new Error("Provide --suite, --attestation, and --output paths for a local review receipt.");
}
const [suite, attestation] = await Promise.all([
  parseFile(values.suite, replaySuiteSchema, "Replay suite"),
  parseFile(values.attestation, replayReviewAttestationSchema, "Review attestation")
]);
const approval = approveReviewedReplay(suite, attestation);
await writeFile(resolve(repository, values.output), `${JSON.stringify(approval, null, 2)}\n`, { flag: "wx", mode: 0o600 });
process.stdout.write(`Recorded review for suite digest ${approval.suiteDigest}.\n`);
