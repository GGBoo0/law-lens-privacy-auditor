import { GET as getLegalMonitorStatus } from "../legal-monitor-status/route";

export const dynamic = "force-dynamic";

const STALE_AFTER_MILLISECONDS = 36 * 60 * 60 * 1000;

type LegalMonitorStatus = {
  lastAttemptAt: string | null;
  lastSuccessfulCheckAt: string | null;
  lastResult: string;
  sourceCount: number;
  failedSources: number;
  workflowRunUrl: string;
  consecutiveFailures?: number;
  recoveredAt?: string | null;
  stale?: boolean;
  staleAfter?: string | null;
  staleAfterHours?: number;
  workflowRunAttempt?: number | null;
  recentRuns?: unknown[];
  pendingReviewCount?: number;
  effectiveUnreviewedCount?: number;
  oldestEffectiveFrom?: string | null;
  runtimeManifestGeneratedAt?: string | null;
  runtimeManifestState?:
    | "current"
    | "review_required"
    | "stale"
    | "invalid"
    | "unavailable";
  runtimeManifestSource?: "live" | "bundled" | "unavailable";
};

type LegalMonitorAssessment = {
  state: "healthy" | "review_required" | "failed" | "stale";
  reason: string;
  stale: boolean;
  ageSeconds: number | null;
};

function assessLegalMonitor(
  status: LegalMonitorStatus,
  now: number,
): LegalMonitorAssessment {
  const lastSuccess = status.lastSuccessfulCheckAt
    ? Date.parse(status.lastSuccessfulCheckAt)
    : Number.NaN;
  const ageMilliseconds = Number.isFinite(lastSuccess)
    ? Math.max(0, now - lastSuccess)
    : null;
  const configuredStaleMilliseconds =
    typeof status.staleAfterHours === "number" &&
    Number.isFinite(status.staleAfterHours) &&
    status.staleAfterHours >= 1
      ? status.staleAfterHours * 60 * 60 * 1_000
      : STALE_AFTER_MILLISECONDS;
  const staleAfter = status.staleAfter ? Date.parse(status.staleAfter) : Number.NaN;
  const stale =
    status.stale === true ||
    (Number.isFinite(staleAfter)
      ? now > staleAfter
      : ageMilliseconds === null || ageMilliseconds > configuredStaleMilliseconds);

  if (status.lastResult === "failed" || status.failedSources > 0) {
    return {
      state: "failed",
      reason: "latest_legal_source_check_failed",
      stale,
      ageSeconds:
        ageMilliseconds === null ? null : Math.floor(ageMilliseconds / 1_000),
    };
  }

  if (stale) {
    return {
      state: "stale",
      reason: "no_successful_check_within_36_hours",
      stale: true,
      ageSeconds:
        ageMilliseconds === null ? null : Math.floor(ageMilliseconds / 1_000),
    };
  }

  if (
    status.runtimeManifestState === "stale" ||
    status.runtimeManifestState === "invalid" ||
    status.runtimeManifestState === "unavailable"
  ) {
    return {
      state: "failed",
      reason: `legal_runtime_manifest_${status.runtimeManifestState}`,
      stale: true,
      ageSeconds:
        ageMilliseconds === null ? null : Math.floor(ageMilliseconds / 1_000),
    };
  }

  if ((status.effectiveUnreviewedCount ?? 0) > 0) {
    return {
      state: "review_required",
      reason: "effective_legal_change_requires_rule_review",
      stale: false,
      ageSeconds: Math.floor(ageMilliseconds! / 1_000),
    };
  }

  if (status.lastResult === "changes_detected") {
    return {
      state: "review_required",
      reason: "official_source_change_detected",
      stale: false,
      ageSeconds: Math.floor(ageMilliseconds! / 1_000),
    };
  }

  return {
    state: "healthy",
    reason: "latest_check_succeeded",
    stale: false,
    ageSeconds: Math.floor(ageMilliseconds! / 1_000),
  };
}

function healthResponse(
  body: Record<string, unknown>,
  status: 200 | 503,
) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(status === 503 ? { "Retry-After": "300" } : {}),
    },
  });
}

export async function GET() {
  const checkedAt = new Date().toISOString();

  try {
    const monitorResponse = await getLegalMonitorStatus();
    if (!monitorResponse.ok) {
      throw new Error(`legal monitor returned HTTP ${monitorResponse.status}`);
    }

    const monitorStatus = (await monitorResponse.json()) as LegalMonitorStatus;
    const assessment = assessLegalMonitor(monitorStatus, Date.now());
    const degraded =
      assessment.state === "failed" || assessment.state === "stale";

    return healthResponse(
      {
        status: degraded ? "degraded" : "ok",
        checkedAt,
        service: { state: "healthy" },
        legalMonitor: {
          ...assessment,
          lastAttemptAt: monitorStatus.lastAttemptAt,
          lastSuccessfulCheckAt: monitorStatus.lastSuccessfulCheckAt,
          lastResult: monitorStatus.lastResult,
          sourceCount: monitorStatus.sourceCount,
          failedSources: monitorStatus.failedSources,
          consecutiveFailures: monitorStatus.consecutiveFailures ?? 0,
          recoveredAt: monitorStatus.recoveredAt ?? null,
          staleAfter: monitorStatus.staleAfter ?? null,
          staleAfterHours: monitorStatus.staleAfterHours ?? 36,
          workflowRunAttempt: monitorStatus.workflowRunAttempt ?? null,
          recentRuns: monitorStatus.recentRuns ?? [],
          workflowRunUrl: monitorStatus.workflowRunUrl,
          pendingReviewCount: monitorStatus.pendingReviewCount ?? 0,
          effectiveUnreviewedCount: monitorStatus.effectiveUnreviewedCount ?? 0,
          oldestEffectiveFrom: monitorStatus.oldestEffectiveFrom ?? null,
          runtimeManifestGeneratedAt:
            monitorStatus.runtimeManifestGeneratedAt ?? null,
          runtimeManifestState: monitorStatus.runtimeManifestState ?? "unavailable",
          runtimeManifestSource:
            monitorStatus.runtimeManifestSource ?? "unavailable",
        },
      },
      degraded ? 503 : 200,
    );
  } catch {
    return healthResponse(
      {
        status: "degraded",
        checkedAt,
        service: { state: "healthy" },
        legalMonitor: {
          state: "failed",
          reason: "legal_monitor_status_unavailable",
          stale: true,
        },
      },
      503,
    );
  }
}
