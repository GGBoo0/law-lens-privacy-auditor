import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RESULTS = new Set(["not_run", "no_changes", "changes_detected", "failed"]);

export function buildMonitorStatus({
  previous = {},
  result,
  checkedAt,
  sourceCount,
  failedSources,
  workflowRunUrl,
}) {
  if (!RESULTS.has(result)) {
    throw new Error(`지원하지 않는 감시 결과입니다: ${result}`);
  }
  const normalizedSourceCount = Number(sourceCount);
  const normalizedFailedSources = Number(failedSources);
  if (Number.isNaN(Date.parse(checkedAt))) throw new Error("감시 시각이 올바르지 않습니다.");
  if (!Number.isInteger(normalizedSourceCount) || normalizedSourceCount < 1) {
    throw new Error("감시 소스 수가 올바르지 않습니다.");
  }
  if (!Number.isInteger(normalizedFailedSources) || normalizedFailedSources < 0) {
    throw new Error("실패 소스 수가 올바르지 않습니다.");
  }
  if (!workflowRunUrl?.startsWith("https://github.com/")) {
    throw new Error("워크플로 실행 URL이 올바르지 않습니다.");
  }
  const successful = result === "no_changes" || result === "changes_detected";
  const previousSuccessfulCheck =
    typeof previous.lastSuccessfulCheckAt === "string"
      ? previous.lastSuccessfulCheckAt
      : null;
  return {
    schemaVersion: 1,
    configured: true,
    lastAttemptAt: checkedAt,
    lastSuccessfulCheckAt: successful
      ? checkedAt
      : previousSuccessfulCheck,
    lastResult: result,
    sourceCount: normalizedSourceCount,
    failedSources: normalizedFailedSources,
    workflowRunUrl,
  };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`잘못된 인자입니다: ${key || "(없음)"}`);
    }
    values[key.slice(2)] = value;
  }
  return values;
}

async function main() {
  const values = parseArguments(process.argv.slice(2));
  const previous = JSON.parse(await readFile(values.previous, "utf8"));
  const status = buildMonitorStatus({
    previous,
    result: values.result,
    checkedAt: values.checkedAt,
    sourceCount: values.sourceCount,
    failedSources: values.failedSources,
    workflowRunUrl: values.workflowRunUrl,
  });
  await mkdir(path.dirname(values.output), { recursive: true });
  await writeFile(values.output, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
