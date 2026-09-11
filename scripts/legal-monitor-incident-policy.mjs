import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const PRIMARY_SCHEDULES = new Set(["17 9 * * *", "47 15 * * *"]);
const TRANSIENT_CAUSES = new Set([
  "timeout/UND_ERR_CONNECT_TIMEOUT",
  "timeout/ETIMEDOUT",
  "network/ECONNRESET",
  "network/ECONNREFUSED",
  "network/EHOSTUNREACH",
  "network/ENETUNREACH",
  "network/UND_ERR_SOCKET",
]);

// The failed observation is already published before this decision. Only its
// first notification can wait for the independently scheduled recovery slot.
export function shouldDeferMonitorIncident({
  eventName,
  schedule,
  incidentOpen,
  previous,
  status,
  diagnostics,
  now = Date.now(),
}) {
  if (
    eventName !== "schedule" ||
    !PRIMARY_SCHEDULES.has(schedule) ||
    incidentOpen !== false ||
    !["no_changes", "changes_detected"].includes(previous?.lastResult) ||
    previous.failedSources !== 0 ||
    previous.consecutiveFailures !== 0 ||
    previous.lastSuccessfulCheckAt !== status?.lastSuccessfulCheckAt ||
    status?.lastResult !== "failed" ||
    status.consecutiveFailures !== 1 ||
    status.stale !== false ||
    !Number.isInteger(status.failedSources) ||
    status.failedSources < 1
  ) return false;

  const age = new Date(now).getTime() - Date.parse(status.lastSuccessfulCheckAt);
  if (!Number.isFinite(age) || age < 0 || age > 36 * 60 * 60 * 1_000) return false;

  const causes = diagnostics?.causes;
  if (!Array.isArray(causes) || causes.length === 0) return false;
  if (!causes.every((cause) =>
    TRANSIENT_CAUSES.has(`${cause?.category}/${cause?.code}`) &&
    Number.isInteger(cause?.count) && cause.count > 0
  )) return false;
  return causes.reduce((sum, cause) => sum + cause.count, 0) === status.failedSources;
}

async function main() {
  let status;
  let previous;
  let diagnostics;
  try {
    status = JSON.parse(await readFile(process.argv[2], "utf8"));
    previous = JSON.parse(await readFile(process.argv[3], "utf8"));
    diagnostics = JSON.parse(process.env.MONITOR_DIAGNOSTICS || "null");
  } catch {
    // Missing or malformed evidence must not suppress an incident.
  }
  const defer = shouldDeferMonitorIncident({
    eventName: process.env.EVENT_NAME,
    schedule: process.env.SCHEDULE_EXPRESSION,
    incidentOpen: process.env.INCIDENT_OPEN === "false" ? false : true,
    previous,
    status,
    diagnostics,
  });
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `notify=${!defer}\n`, "utf8");
  }
  console.log(defer
    ? "첫 일시 연결 실패를 기록했습니다. 예약 복구 실행까지 알림을 유예합니다."
    : "법령 감시 실패 알림을 즉시 처리합니다.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
