import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildLegalRuntimeManifest,
  validateLegalRuntimeManifest,
} from "../lib/legal-runtime-manifest.ts";

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) throw new Error(`잘못된 인자입니다: ${key || "(없음)"}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${key} 값이 필요합니다.`);
    }
    values[key.slice(2)] = value;
    index += 1;
  }
  return values;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function runLegalRuntimeManifestCli(argv) {
  const values = parseArguments(argv);
  if (!values.snapshot || !values.registry || !values.output) {
    throw new Error("--snapshot, --registry, --output이 필요합니다.");
  }
  const snapshot = await readJson(values.snapshot);
  const registry = await readJson(values.registry);
  const previousManifest = values.previous
    ? await readJson(values.previous)
    : undefined;
  const manifest = buildLegalRuntimeManifest({
    snapshot,
    registry,
    previousManifest,
    generatedAt: values.generatedAt || new Date(),
    observedAt: values.observedAt,
  });
  const validation = validateLegalRuntimeManifest(manifest);
  if (!validation.valid) {
    throw new Error(`생성된 manifest가 유효하지 않습니다: ${validation.errors.join("; ")}`);
  }
  await mkdir(path.dirname(values.output), { recursive: true });
  await writeFile(values.output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLegalRuntimeManifestCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
