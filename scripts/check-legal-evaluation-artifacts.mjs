#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PRIVATE_RECORD_TYPES = new Set([
  "legal_evaluation_review_packet",
  "legal_evaluation_reviewer_annotation",
  "legal_evaluation_reviewer_annotation_batch",
  "legal_evaluation_adjudication",
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const [name, inline] = argument.slice(2).split("=", 2);
    const value = inline ?? argv[index + 1];
    if (inline === undefined && value && !value.startsWith("--")) index += 1;
    options[name] = inline ?? (value?.startsWith("--") ? true : value ?? true);
  }
  return options;
}

function containsPrivateContract(value) {
  if (Array.isArray(value)) return value.some(containsPrivateContract);
  if (!value || typeof value !== "object") return false;
  if (PRIVATE_RECORD_TYPES.has(value.recordType)) return true;
  return Object.values(value).some(containsPrivateContract);
}

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "git ls-files failed");
  }
  return result.stdout.split("\0").filter(Boolean);
}

const options = parseArgs(process.argv.slice(2));
const paths =
  typeof options.files === "string"
    ? options.files.split(",").map((value) => value.trim()).filter(Boolean)
    : trackedFiles();
const failures = [];
for (const suppliedPath of paths) {
  const absolutePath = isAbsolute(suppliedPath)
    ? suppliedPath
    : resolve(repositoryRoot, suppliedPath);
  const repositoryPath = relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
  if (repositoryPath === "work" || repositoryPath.startsWith("work/")) {
    failures.push(`${repositoryPath}: work artifacts must never be tracked`);
    continue;
  }
  if (!repositoryPath.toLowerCase().endsWith(".json")) continue;
  let value;
  try {
    value = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch {
    continue;
  }
  const allowedSyntheticExample =
    /^data\/legal-evaluation\/examples\/[^/]+\.synthetic\.json$/.test(
      repositoryPath,
    );
  if (!allowedSyntheticExample && containsPrivateContract(value)) {
    failures.push(`${repositoryPath}: private legal-evaluation contract is tracked`);
  }
}

if (failures.length > 0) {
  throw new Error(`Legal evaluation artifact guard failed:\n- ${failures.join("\n- ")}`);
}
process.stdout.write(`${paths.length} tracked paths checked for private evaluation artifacts\n`);
