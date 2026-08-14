import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const LEGAL_MONITOR_RETRY_SCHEDULES = new Set([
  "27 9 * * *",
  "47 9 * * *",
  "57 15 * * *",
  "17 16 * * *",
]);

const DEFAULT_MAX_FAILURE_AGE_HOURS = 6;

export function decideLegalMonitorRun({
  eventName,
  schedule = "",
  status,
  incidentOpen = false,
  now = Date.now(),
  maxFailureAgeHours = DEFAULT_MAX_FAILURE_AGE_HOURS,
}) {
  const runKind =
    eventName === "workflow_dispatch"
      ? "manual"
      : LEGAL_MONITOR_RETRY_SCHEDULES.has(schedule)
        ? "scheduled_retry"
        : "scheduled_primary";

  if (runKind !== "scheduled_retry") {
    return { shouldRun: true, runKind, reason: "primary_or_manual" };
  }

  if (incidentOpen === true) {
    return { shouldRun: true, runKind, reason: "open_incident" };
  }

  const maxAgeMilliseconds = Number(maxFailureAgeHours) * 60 * 60 * 1_000;
  const lastAttemptMilliseconds = Date.parse(status?.lastAttemptAt || "");
  const nowMilliseconds = new Date(now).getTime();
  if (
    !status ||
    typeof status.lastResult !== "string" ||
    !Number.isFinite(lastAttemptMilliseconds)
  ) {
    return { shouldRun: true, runKind, reason: "status_unavailable" };
  }
  if (
    status?.lastResult !== "failed" ||
    !Number.isFinite(nowMilliseconds) ||
    !Number.isFinite(maxAgeMilliseconds) ||
    maxAgeMilliseconds <= 0
  ) {
    return { shouldRun: false, runKind, reason: "latest_result_not_recent_failure" };
  }

  const failureAgeMilliseconds = nowMilliseconds - lastAttemptMilliseconds;
  if (
    failureAgeMilliseconds < 0 ||
    failureAgeMilliseconds > maxAgeMilliseconds
  ) {
    return { shouldRun: false, runKind, reason: "failure_outside_retry_window" };
  }

  return { shouldRun: true, runKind, reason: "recent_failure" };
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
  let status = null;
  try {
    status = JSON.parse(await readFile(values.status, "utf8"));
  } catch {
    status = null;
  }
  const decision = decideLegalMonitorRun({
    eventName: values.eventName,
    schedule: values.schedule || "",
    status,
    incidentOpen: values.incidentOpen === "true",
    maxFailureAgeHours:
      values.maxFailureAgeHours || DEFAULT_MAX_FAILURE_AGE_HOURS,
  });
  const outputs = [
    `should_run=${decision.shouldRun}`,
    `run_kind=${decision.runKind}`,
    `reason=${decision.reason}`,
  ].join("\n");
  if (values.githubOutput) {
    await appendFile(values.githubOutput, `${outputs}\n`, "utf8");
  }
  console.log(
    decision.shouldRun
      ? `법령 감시 실행: ${decision.runKind} (${decision.reason})`
      : `법령 감시 재시도 생략: ${decision.reason}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
