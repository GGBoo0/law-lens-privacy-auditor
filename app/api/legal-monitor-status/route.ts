import fallbackStatus from "../../../data/legal-monitor-status.json";
import {
  mergeRuntimeLegalChanges,
  normalizeLegalAsOfDate,
} from "../../../lib/legal-lifecycle.ts";
import {
  type LegalRuntimeManifest,
  validateLegalRuntimeManifest,
} from "../../../lib/legal-runtime-manifest.ts";

const STATUS_URL =
  "https://raw.githubusercontent.com/GGBoo0/law-lens-privacy-auditor/automation/legal-monitor-status/data/legal-monitor-status.json";
const RUNTIME_MANIFEST_URL =
  "https://raw.githubusercontent.com/GGBoo0/law-lens-privacy-auditor/automation/legal-monitor-status/data/legal-runtime-manifest.json";
const CACHE_MILLISECONDS = 5 * 60 * 1000;
const FALLBACK_CACHE_MILLISECONDS = 30 * 1000;
const RESULTS = new Set(["not_run", "no_changes", "changes_detected", "failed"]);

type MonitorResult = "not_run" | "no_changes" | "changes_detected" | "failed";

type MonitorRun = {
  checkedAt: string;
  result: MonitorResult;
  sourceCount: number;
  failedSources: number;
  workflowRunUrl: string;
  workflowRunAttempt: number;
  consecutiveFailures: number;
  recovered: boolean;
};

type MonitorStatusBase = {
  configured: true;
  lastAttemptAt: string | null;
  lastSuccessfulCheckAt: string | null;
  lastResult: MonitorResult;
  sourceCount: number;
  failedSources: number;
  workflowRunUrl: string;
};

type MonitorStatus =
  | (MonitorStatusBase & { schemaVersion: 1 })
  | (MonitorStatusBase & {
      schemaVersion: 2;
      consecutiveFailures: number;
      recoveredAt: string | null;
      stale: boolean;
      staleAfter: string | null;
      staleAfterHours: number;
      workflowRunAttempt: number | null;
      recentRuns: MonitorRun[];
    });

type RuntimeManifestState =
  | "current"
  | "review_required"
  | "stale"
  | "invalid"
  | "unavailable";

type RuntimeManifestSummary = {
  pendingReviewCount: number;
  effectiveUnreviewedCount: number;
  oldestEffectiveFrom: string | null;
  runtimeManifestGeneratedAt: string | null;
  runtimeManifestState: RuntimeManifestState;
  runtimeManifestSource: "live" | "bundled" | "unavailable";
};

type MonitorStatusResponse = MonitorStatus & RuntimeManifestSummary;

let cached: { expiresAt: number; value: MonitorStatusResponse } | null = null;

function isNullableDate(value: unknown) {
  return (
    value === null ||
    (typeof value === "string" && Number.isFinite(Date.parse(value)))
  );
}

function isWorkflowRunUrl(value: unknown) {
  return typeof value === "string" && value.startsWith("https://github.com/");
}

function isNonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0;
}

function isMonitorRun(value: unknown): value is MonitorRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run.checkedAt === "string" &&
    Number.isFinite(Date.parse(run.checkedAt)) &&
    typeof run.result === "string" &&
    RESULTS.has(run.result) &&
    isPositiveInteger(run.sourceCount) &&
    isNonNegativeInteger(run.failedSources) &&
    Number(run.failedSources) <= Number(run.sourceCount) &&
    isWorkflowRunUrl(run.workflowRunUrl) &&
    isPositiveInteger(run.workflowRunAttempt) &&
    isNonNegativeInteger(run.consecutiveFailures) &&
    typeof run.recovered === "boolean"
  );
}

function isMonitorStatus(value: unknown): value is MonitorStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Record<string, unknown>;
  const validBase =
    (status.schemaVersion === 1 || status.schemaVersion === 2) &&
    status.configured === true &&
    isNullableDate(status.lastAttemptAt) &&
    isNullableDate(status.lastSuccessfulCheckAt) &&
    typeof status.lastResult === "string" &&
    RESULTS.has(status.lastResult) &&
    isPositiveInteger(status.sourceCount) &&
    isNonNegativeInteger(status.failedSources) &&
    Number(status.failedSources) <= Number(status.sourceCount) &&
    isWorkflowRunUrl(status.workflowRunUrl);

  if (!validBase) return false;
  if (status.schemaVersion === 1) return true;

  return (
    isNonNegativeInteger(status.consecutiveFailures) &&
    isNullableDate(status.recoveredAt) &&
    typeof status.stale === "boolean" &&
    isNullableDate(status.staleAfter) &&
    typeof status.staleAfterHours === "number" &&
    Number.isFinite(status.staleAfterHours) &&
    Number(status.staleAfterHours) >= 1 &&
    (status.workflowRunAttempt === null ||
      isPositiveInteger(status.workflowRunAttempt)) &&
    Array.isArray(status.recentRuns) &&
    status.recentRuns.length <= 30 &&
    status.recentRuns.every(isMonitorRun)
  );
}

if (!isMonitorStatus(fallbackStatus)) {
  throw new Error("bundled legal monitor fallback has an invalid schema");
}

function summarizeRuntimeManifest(
  candidate: unknown,
  source: RuntimeManifestSummary["runtimeManifestSource"],
): RuntimeManifestSummary {
  if (source === "unavailable") {
    return {
      pendingReviewCount: 0,
      effectiveUnreviewedCount: 0,
      oldestEffectiveFrom: null,
      runtimeManifestGeneratedAt: null,
      runtimeManifestState: "unavailable",
      runtimeManifestSource: "unavailable",
    };
  }
  const validation = validateLegalRuntimeManifest(candidate);
  if (!validation.valid) {
    return {
      pendingReviewCount: 0,
      effectiveUnreviewedCount: 0,
      oldestEffectiveFrom: null,
      runtimeManifestGeneratedAt: null,
      runtimeManifestState: source === "unavailable" ? "unavailable" : "invalid",
      runtimeManifestSource: source,
    };
  }
  const manifest = candidate as LegalRuntimeManifest;
  const runtimeState = mergeRuntimeLegalChanges(manifest, new Date());
  const asOfDate = normalizeLegalAsOfDate(new Date());
  const effectiveUnreviewedCount = manifest.pendingChanges.filter(
    (change) => change.effectiveFrom <= asOfDate,
  ).length;
  return {
    pendingReviewCount: manifest.pendingChanges.length,
    effectiveUnreviewedCount,
    oldestEffectiveFrom: manifest.pendingChanges[0]?.effectiveFrom ?? null,
    runtimeManifestGeneratedAt: manifest.generatedAt,
    runtimeManifestState:
      runtimeState.status === "stale"
        ? "stale"
        : runtimeState.status === "invalid" ||
            runtimeState.status === "ruleset_mismatch"
          ? "invalid"
          : effectiveUnreviewedCount > 0
            ? "review_required"
            : "current",
    runtimeManifestSource: source,
  };
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "LawLensPrivacyKR/1.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function GET() {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return Response.json(cached.value, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
    });
  }

  let value: MonitorStatus = fallbackStatus;
  let fetchedLiveStatus = false;
  let runtimeManifest: unknown = null;
  let runtimeManifestSource: RuntimeManifestSummary["runtimeManifestSource"] =
    "unavailable";
  const [statusResult, manifestResult] = await Promise.allSettled([
    fetchJson(STATUS_URL),
    fetchJson(RUNTIME_MANIFEST_URL),
  ]);
  if (statusResult.status === "fulfilled" && isMonitorStatus(statusResult.value)) {
    value = statusResult.value;
    fetchedLiveStatus = true;
  }
  if (manifestResult.status === "fulfilled") {
    runtimeManifest = manifestResult.value;
    runtimeManifestSource = "live";
  }

  const responseValue: MonitorStatusResponse = {
    ...value,
    ...summarizeRuntimeManifest(runtimeManifest, runtimeManifestSource),
  };

  cached = {
    expiresAt:
      now +
      (fetchedLiveStatus && runtimeManifestSource === "live"
        ? CACHE_MILLISECONDS
        : FALLBACK_CACHE_MILLISECONDS),
    value: responseValue,
  };
  return Response.json(responseValue, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
  });
}
