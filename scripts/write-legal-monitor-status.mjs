import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RESULTS = new Set(["not_run", "no_changes", "changes_detected", "failed"]);
const DEFAULT_HISTORY_LIMIT = 7;
const DEFAULT_STALE_AFTER_HOURS = 36;

export function buildMonitorStatus({
  previous = {},
  result,
  checkedAt,
  sourceCount,
  failedSources,
  workflowRunUrl,
  workflowRunAttempt = 1,
  historyLimit = DEFAULT_HISTORY_LIMIT,
  staleAfterHours = DEFAULT_STALE_AFTER_HOURS,
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
  if (normalizedFailedSources > normalizedSourceCount) {
    throw new Error("실패 소스 수가 전체 소스 수보다 많습니다.");
  }
  if (!workflowRunUrl?.startsWith("https://github.com/")) {
    throw new Error("워크플로 실행 URL이 올바르지 않습니다.");
  }
  const normalizedAttempt = Number(workflowRunAttempt);
  const normalizedHistoryLimit = Number(historyLimit);
  const normalizedStaleAfterHours = Number(staleAfterHours);
  if (!Number.isInteger(normalizedAttempt) || normalizedAttempt < 1) {
    throw new Error("워크플로 실행 시도 번호가 올바르지 않습니다.");
  }
  if (
    !Number.isInteger(normalizedHistoryLimit) ||
    normalizedHistoryLimit < 1 ||
    normalizedHistoryLimit > 30
  ) {
    throw new Error("감시 이력 보존 개수가 올바르지 않습니다.");
  }
  if (!Number.isFinite(normalizedStaleAfterHours) || normalizedStaleAfterHours < 1) {
    throw new Error("감시 만료 시간이 올바르지 않습니다.");
  }
  const successful = result === "no_changes" || result === "changes_detected";
  const failed = result === "failed";
  const previousSuccessfulCheck =
    typeof previous.lastSuccessfulCheckAt === "string" &&
    !Number.isNaN(Date.parse(previous.lastSuccessfulCheckAt))
      ? previous.lastSuccessfulCheckAt
      : null;
  const lastSuccessfulCheckAt = successful ? checkedAt : previousSuccessfulCheck;
  const previousConsecutiveFailures = Number.isInteger(previous.consecutiveFailures)
    ? previous.consecutiveFailures
    : previous.lastResult === "failed"
      ? 1
      : 0;
  const consecutiveFailures = failed
    ? previousConsecutiveFailures + 1
    : successful
      ? 0
      : previousConsecutiveFailures;
  const recovered = successful && previousConsecutiveFailures > 0;
  const recoveredAt =
    recovered
      ? checkedAt
      : typeof previous.recoveredAt === "string"
        ? previous.recoveredAt
        : null;
  const staleAfter = lastSuccessfulCheckAt
    ? new Date(
        Date.parse(lastSuccessfulCheckAt) + normalizedStaleAfterHours * 60 * 60 * 1_000,
      ).toISOString()
    : null;
  const stale = !lastSuccessfulCheckAt || Date.parse(checkedAt) > Date.parse(staleAfter);
  const recentRuns = [
    ...(Array.isArray(previous.recentRuns) ? previous.recentRuns : []),
    {
      checkedAt,
      result,
      sourceCount: normalizedSourceCount,
      failedSources: normalizedFailedSources,
      workflowRunUrl,
      workflowRunAttempt: normalizedAttempt,
      consecutiveFailures,
      recovered,
    },
  ].slice(-normalizedHistoryLimit);

  return {
    schemaVersion: 2,
    configured: true,
    lastAttemptAt: checkedAt,
    lastSuccessfulCheckAt,
    lastResult: result,
    sourceCount: normalizedSourceCount,
    failedSources: normalizedFailedSources,
    consecutiveFailures,
    recoveredAt,
    stale,
    staleAfter,
    staleAfterHours: normalizedStaleAfterHours,
    workflowRunUrl,
    workflowRunAttempt: normalizedAttempt,
    recentRuns,
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
    workflowRunAttempt: values.workflowRunAttempt,
    historyLimit: values.historyLimit,
    staleAfterHours: values.staleAfterHours,
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
