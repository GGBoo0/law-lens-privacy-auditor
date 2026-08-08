import fallbackStatus from "../../../data/legal-monitor-status.json";

const STATUS_URL =
  "https://raw.githubusercontent.com/GGBoo0/law-lens-privacy-auditor/automation/legal-monitor-status/data/legal-monitor-status.json";
const CACHE_MILLISECONDS = 5 * 60 * 1000;
const RESULTS = new Set(["not_run", "no_changes", "changes_detected", "failed"]);

type MonitorStatus = typeof fallbackStatus;

let cached: { expiresAt: number; value: MonitorStatus } | null = null;

function isMonitorStatus(value: unknown): value is MonitorStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Record<string, unknown>;
  return (
    status.schemaVersion === 1 &&
    status.configured === true &&
    (status.lastAttemptAt === null || typeof status.lastAttemptAt === "string") &&
    (status.lastSuccessfulCheckAt === null ||
      typeof status.lastSuccessfulCheckAt === "string") &&
    typeof status.lastResult === "string" &&
    RESULTS.has(status.lastResult) &&
    Number.isInteger(status.sourceCount) &&
    Number(status.sourceCount) > 0 &&
    Number.isInteger(status.failedSources) &&
    Number(status.failedSources) >= 0 &&
    typeof status.workflowRunUrl === "string" &&
    status.workflowRunUrl.startsWith("https://github.com/")
  );
}

export async function GET() {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return Response.json(cached.value, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
    });
  }

  let value: MonitorStatus = fallbackStatus;
  try {
    const response = await fetch(STATUS_URL, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const candidate: unknown = await response.json();
    if (!isMonitorStatus(candidate)) throw new Error("invalid monitor status schema");
    value = candidate;
  } catch {
    value = fallbackStatus;
  }

  cached = { expiresAt: now + CACHE_MILLISECONDS, value };
  return Response.json(value, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
  });
}
