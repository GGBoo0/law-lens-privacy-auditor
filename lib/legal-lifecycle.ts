import {
  LEGAL_BASELINE,
  LEGAL_IMPACT_CATEGORIES,
  type LegalImpactCategory,
} from "./legal-baseline.ts";
import {
  ALL_LEGAL_IMPACT_CATEGORIES,
  type LegalRuntimeManifest,
  validateLegalRuntimeManifest,
} from "./legal-runtime-manifest.ts";

export type LegalChangeReview = {
  status: "pending" | "reviewed";
  reviewedAt: string | null;
  reviewedRulesetVersion: string | null;
  outcome: "rule_updated" | "no_analyzer_impact" | null;
};

export type LegalChange = {
  changeId: string;
  sourceId: string;
  versionId?: string;
  documentHash?: string;
  name: string;
  version: string;
  effectiveFrom: string;
  detectedAt: string;
  changeKind: "semantic" | "metadata_only";
  status: string;
  url: string;
  impactCategories: readonly LegalImpactCategory[];
  review: LegalChangeReview;
  officialState?: string;
  observation?: "observed" | "not_observed";
};

export type LegalBaselineForLifecycle = {
  rulesetVersion: string;
  upcomingChanges: readonly LegalChange[];
};

export type LegalChangeRuntimeStatus =
  | "scheduled_review_pending"
  | "scheduled_reviewed"
  | "effective_review_overdue"
  | "effective_reviewed";

export type RuntimeLegalChange = LegalChange & {
  baselineStatus: string;
  isEffective: boolean;
  reviewIsCurrent: boolean;
  lifecycleStatus: LegalChangeRuntimeStatus;
};

export type LegalReviewWarning = {
  code: "LEGAL_RULE_REVIEW_OVERDUE";
  message: string;
  asOfDate: string;
  affectedCategories: Array<{
    key: LegalImpactCategory;
    label: string;
  }>;
  changes: Array<{
    changeId: string;
    sourceId: string;
    name: string;
    version: string;
    effectiveFrom: string;
    url: string;
  }>;
  safeHandling: "impacted_findings_deferred";
};

export const LEGAL_RUNTIME_MANIFEST_STALE_AFTER_HOURS = 36;

function legalVersionKey(
  sourceId: string,
  versionId: string,
  documentHash: string,
) {
  return `${sourceId}\u0000${versionId}\u0000${documentHash}`;
}

function invalidManifestChange(asOfDate: string, reason: string): LegalChange {
  return {
    changeId: "runtime:manifest-untrusted",
    sourceId: "runtime-manifest",
    versionId: "untrusted",
    documentHash: "untrusted",
    name: "실시간 법령 검토 manifest",
    version: reason,
    effectiveFrom: asOfDate,
    detectedAt: `${asOfDate}T00:00:00.000Z`,
    changeKind: "semantic",
    status: "실시간 법령 상태를 신뢰할 수 없어 전체 법률판단 유보",
    url: "",
    impactCategories: [...ALL_LEGAL_IMPACT_CATEGORIES],
    review: {
      status: "pending",
      reviewedAt: null,
      reviewedRulesetVersion: null,
      outcome: null,
    },
  };
}

function legalLifecycleNow(value: string | Date) {
  if (value instanceof Date) return value.getTime();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // Use the end of the KST calendar day so a date-only replay cannot make a
    // stale manifest look newer than it was.
    return Date.parse(`${value}T23:59:59.999+09:00`);
  }
  return Date.parse(value);
}

export function mergeRuntimeLegalChanges(
  runtimeManifest: unknown,
  asOf: string | Date = new Date(),
) {
  const asOfDate = normalizeLegalAsOfDate(asOf);
  if (runtimeManifest === undefined || runtimeManifest === null) {
    return {
      status: "not_provided" as const,
      errors: [] as string[],
      generatedAt: null,
      changes: [...LEGAL_BASELINE.upcomingChanges] as LegalChange[],
    };
  }

  const validation = validateLegalRuntimeManifest(runtimeManifest);
  if (!validation.valid) {
    return {
      status: "invalid" as const,
      errors: validation.errors,
      generatedAt: null,
      changes: [
        ...LEGAL_BASELINE.upcomingChanges,
        invalidManifestChange(asOfDate, "manifest schema validation failed"),
      ] as LegalChange[],
    };
  }

  const manifest = runtimeManifest as LegalRuntimeManifest;
  if (manifest.rulesetVersion !== LEGAL_BASELINE.rulesetVersion) {
    return {
      status: "ruleset_mismatch" as const,
      errors: [
        `runtime ${manifest.rulesetVersion} != analyzer ${LEGAL_BASELINE.rulesetVersion}`,
      ],
      generatedAt: manifest.generatedAt,
      changes: [
        ...LEGAL_BASELINE.upcomingChanges,
        invalidManifestChange(asOfDate, "manifest ruleset version mismatch"),
      ] as LegalChange[],
    };
  }

  const nowMs = legalLifecycleNow(asOf);
  const staleThresholdMs = LEGAL_RUNTIME_MANIFEST_STALE_AFTER_HOURS * 60 * 60 * 1_000;
  // `generatedAt` is the successful official-source check time. The persisted
  // source snapshot itself is intentionally not rewritten on a no-change run,
  // so using its capture time as freshness would falsely degrade a healthy
  // daily monitor after 36 hours.
  if (nowMs - Date.parse(manifest.generatedAt) > staleThresholdMs) {
    return {
      status: "stale" as const,
      errors: [
        `runtime manifest exceeded ${LEGAL_RUNTIME_MANIFEST_STALE_AFTER_HOURS}h freshness window`,
      ],
      generatedAt: manifest.generatedAt,
      changes: [
        ...LEGAL_BASELINE.upcomingChanges,
        invalidManifestChange(asOfDate, "runtime manifest is stale"),
      ] as LegalChange[],
    };
  }

  const reviewedKeys = new Set(
    manifest.reviewedVersions.map((review) =>
      legalVersionKey(review.sourceId, review.versionId, review.documentHash),
    ),
  );
  const merged = new Map<string, LegalChange>();
  const staticKeyByVersion = new Map<string, string>();
  for (const change of LEGAL_BASELINE.upcomingChanges) {
    if (
      change.versionId &&
      change.documentHash &&
      reviewedKeys.has(
        legalVersionKey(change.sourceId, change.versionId, change.documentHash),
      )
    ) {
      continue;
    }
    const key =
      change.versionId && change.documentHash
        ? legalVersionKey(change.sourceId, change.versionId, change.documentHash)
        : legalVersionKey(change.sourceId, change.effectiveFrom, "static");
    merged.set(key, change as LegalChange);
    if (change.versionId) {
      staticKeyByVersion.set(
        `${change.sourceId}\u0000${change.versionId}`,
        key,
      );
    }
  }
  for (const runtimeChange of manifest.pendingChanges) {
    const key = legalVersionKey(
      runtimeChange.sourceId,
      runtimeChange.versionId,
      runtimeChange.documentHash,
    );
    const staticKey = staticKeyByVersion.get(
      `${runtimeChange.sourceId}\u0000${runtimeChange.versionId}`,
    );
    const staticChange = staticKey ? merged.get(staticKey) : undefined;
    if (staticKey) merged.delete(staticKey);
    merged.set(
      key,
      staticChange && staticChange.documentHash === runtimeChange.documentHash
        ? {
            ...runtimeChange,
            impactCategories: [...staticChange.impactCategories],
            review: staticChange.review,
          }
        : runtimeChange,
    );
  }

  return {
    status: "valid" as const,
    errors: [] as string[],
    generatedAt: manifest.generatedAt,
    changes: [...merged.values()],
  };
}

function dateInKorea(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function assertCalendarDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${label} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${label} must be a real calendar date.`);
  }
  return value;
}

export function normalizeLegalAsOfDate(value: string | Date = new Date()) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError("asOf must be a valid date.");
    return dateInKorea(value);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return assertCalendarDate(value, "asOf");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError("asOf must be a valid date.");
  return dateInKorea(parsed);
}

function previousCalendarDate(value: string) {
  const date = new Date(`${assertCalendarDate(value, "effectiveFrom")}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function reviewIsCurrent(
  change: LegalChange,
  rulesetVersion: string,
  asOfDate: string,
) {
  if (change.changeKind === "metadata_only") return true;
  if (change.review.status !== "reviewed") return false;
  if (!change.review.reviewedAt || !change.review.reviewedRulesetVersion) return false;
  if (change.review.reviewedRulesetVersion !== rulesetVersion) return false;
  if (!change.review.outcome) return false;
  return assertCalendarDate(change.review.reviewedAt, "reviewedAt") <= asOfDate;
}

export function evaluateLegalRulesetFreshness(
  asOf: string | Date = new Date(),
  baseline: LegalBaselineForLifecycle = LEGAL_BASELINE,
) {
  const asOfDate = normalizeLegalAsOfDate(asOf);
  const changes: RuntimeLegalChange[] = baseline.upcomingChanges
    .map((change) => {
      const effectiveFrom = assertCalendarDate(change.effectiveFrom, "effectiveFrom");
      const isEffective = effectiveFrom <= asOfDate;
      const isCurrent = reviewIsCurrent(change, baseline.rulesetVersion, asOfDate);
      const lifecycleStatus: LegalChangeRuntimeStatus = isEffective
        ? isCurrent
          ? "effective_reviewed"
          : "effective_review_overdue"
        : isCurrent
          ? "scheduled_reviewed"
          : "scheduled_review_pending";
      const status =
        lifecycleStatus === "effective_review_overdue"
          ? "시행됨 · 분석 규칙 검토 전 · 관련 판단 유보"
          : lifecycleStatus === "effective_reviewed"
            ? "시행 중 · 현재 규칙셋 검토 완료"
            : lifecycleStatus === "scheduled_reviewed"
              ? "시행 전 · 현재 규칙셋 검토 완료"
              : change.status;
      return {
        ...change,
        baselineStatus: change.status,
        status,
        isEffective,
        reviewIsCurrent: isCurrent,
        lifecycleStatus,
      };
    })
    .sort((left, right) =>
      left.effectiveFrom.localeCompare(right.effectiveFrom) ||
      left.changeId.localeCompare(right.changeId),
    );

  const reviewPending = changes.filter(
    (change) => change.changeKind === "semantic" && !change.reviewIsCurrent,
  );
  const effectiveUnreviewedChanges = reviewPending.filter(
    (change) => change.isEffective,
  );
  const reviewRequiredBy = reviewPending[0]?.effectiveFrom ?? null;
  const validThrough = reviewRequiredBy ? previousCalendarDate(reviewRequiredBy) : null;
  const affectedCategoryKeys = [
    ...new Set(effectiveUnreviewedChanges.flatMap((change) => change.impactCategories)),
  ].sort();

  const warnings: LegalReviewWarning[] = effectiveUnreviewedChanges.length
    ? [
        {
          code: "LEGAL_RULE_REVIEW_OVERDUE",
          message:
            "시행된 법령 변경의 의미 검토가 완료되지 않아 영향받는 분석 항목의 판단을 유보합니다.",
          asOfDate,
          affectedCategories: affectedCategoryKeys.map((key) => ({
            key,
            label: LEGAL_IMPACT_CATEGORIES[key],
          })),
          changes: effectiveUnreviewedChanges.map((change) => ({
            changeId: change.changeId,
            sourceId: change.sourceId,
            name: change.name,
            version: change.version,
            effectiveFrom: change.effectiveFrom,
            url: change.url,
          })),
          safeHandling: "impacted_findings_deferred",
        },
      ]
    : [];

  return {
    asOfDate,
    status: effectiveUnreviewedChanges.length
      ? ("review_overdue" as const)
      : reviewPending.length
        ? ("current_with_scheduled_review" as const)
        : ("current" as const),
    validThrough,
    reviewRequiredBy,
    overdueLegalReview: effectiveUnreviewedChanges.length > 0,
    affectedCategoryKeys,
    effectiveUnreviewedChanges,
    changes,
    warnings,
  };
}
