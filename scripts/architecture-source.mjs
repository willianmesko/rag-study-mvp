import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import policy from "./architecture-policy.cjs";

const testFile = new RegExp(policy.testFilePattern);
const sourceFile = /\.[cm]?[jt]sx?$/;

export async function productionFiles(root) {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && sourceFile.test(entry.name) && !testFile.test(entry.name))
        files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  for (const relative of policy.sourceRoots) await walk(path.join(root, relative));
  return files;
}

export function computedImports(source, filename) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const findings = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const target = node.arguments[0];
      if (!target || (!ts.isStringLiteral(target) && !ts.isNoSubstitutionTemplateLiteral(target))) {
        const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
        findings.push({ file: filename, line: position.line + 1, column: position.character + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return findings;
}

export async function inspectComputedImports(root, files) {
  const results = await Promise.all(files.map(async (filename) =>
    computedImports(await readFile(path.join(root, filename), "utf8"), filename)));
  return results.flat();
}
