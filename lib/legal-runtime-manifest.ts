import {
  LEGAL_IMPACT_CATEGORIES,
  type LegalImpactCategory,
} from "./legal-baseline.ts";

export const LEGAL_RUNTIME_MANIFEST_SCHEMA_VERSION = 1 as const;

export const LEGAL_SEMANTIC_HASH_ALGORITHMS = Object.freeze([
  "legal-semantic-text-v1",
  "legal-semantic-text-v2",
] as const);

export type LegalSemanticHashAlgorithm =
  (typeof LEGAL_SEMANTIC_HASH_ALGORITHMS)[number];

export type LegalRuntimeHashAlgorithm =
  | LegalSemanticHashAlgorithm
  | "legacy-document-hash"
  | "source-fingerprint";

export const ALL_LEGAL_IMPACT_CATEGORIES = Object.freeze(
  Object.keys(LEGAL_IMPACT_CATEGORIES) as LegalImpactCategory[],
);

export const DEFAULT_SOURCE_IMPACT_CATEGORIES: Readonly<
  Record<string, readonly LegalImpactCategory[]>
> = Object.freeze({
  pipa: ALL_LEGAL_IMPACT_CATEGORIES,
  "pipa-decree": ALL_LEGAL_IMPACT_CATEGORIES,
  "ecommerce-act": ["ecommerce_retention"],
  "ecommerce-decree": ["ecommerce_retention"],
  "ai-framework-act": ["ai_transparency", "automated_decision"],
  "location-information-act": ["location_information"],
  "credit-information-act": ["credit_information"],
  "privacy-security-standard": ["security_measures"],
  "privacy-policy-evaluation-notice": [
    "core_disclosures",
    "policy_transparency",
  ],
  "pipc-privacy-policy-guideline": ALL_LEGAL_IMPACT_CATEGORIES,
});

export type LegalReviewOutcome =
  | "rule_updated"
  | "no_analyzer_impact"
  | "superseded";

export type LegalRuleReviewRegistry = {
  schemaVersion: 1;
  rulesetVersion: string;
  reviewedAt: string;
  reviews: Array<{
    sourceId: string;
    versionId: string;
    documentHash: string;
    effectiveDate: string;
    outcome: LegalReviewOutcome;
  }>;
};

export type RuntimePendingLegalChange = {
  changeId: string;
  sourceId: string;
  versionId: string;
  documentHash: string;
  hashAlgorithm: LegalRuntimeHashAlgorithm;
  name: string;
  version: string;
  effectiveFrom: string;
  effectiveDateUnknown: boolean;
  detectedAt: string;
  changeKind: "semantic";
  status: string;
  url: string;
  impactCategories: LegalImpactCategory[];
  review: {
    status: "pending";
    reviewedAt: null;
    reviewedRulesetVersion: null;
    outcome: null;
  };
  officialState: string;
  observation: "observed" | "not_observed";
  firstObservedAt: string;
  lastObservedAt: string;
};

export type LegalRuntimeManifest = {
  schemaVersion: 1;
  generatedAt: string;
  asOfDate: string;
  snapshotCapturedAt: string;
  rulesetVersion: string;
  registryReviewedAt: string;
  sourceCount: number;
  reviewedVersions: LegalRuleReviewRegistry["reviews"];
  pendingChanges: RuntimePendingLegalChange[];
  pendingCount: number;
  effectivePendingCount: number;
  nextReviewRequiredBy: string | null;
};

type SnapshotVersion = {
  id?: unknown;
  documentHash?: unknown;
  semanticDocumentHash?: unknown;
  articleHashAlgorithm?: unknown;
  state?: unknown;
  effectiveDate?: unknown;
  promulgationNumber?: unknown;
  stageEffectiveDates?: unknown;
};

type SnapshotSource = {
  id?: unknown;
  name?: unknown;
  officialUrl?: unknown;
  fingerprint?: unknown;
  contentHashAlgorithm?: unknown;
  versions?: unknown;
};

type LegalSnapshot = {
  capturedAt?: unknown;
  sourceCount?: unknown;
  sources?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateInKorea(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("generatedAt must be valid.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function normalizeOfficialEffectiveDate(value: unknown) {
  if (typeof value !== "string") return null;
  const compact = value.trim();
  if (/^\d{8}$/.test(compact)) {
    const normalized = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
    return isCalendarDate(normalized) ? normalized : null;
  }
  return isCalendarDate(compact) ? compact : null;
}

function versionKey(sourceId: string, versionId: string, documentHash: string) {
  return `${sourceId}\u0000${versionId}\u0000${documentHash}`;
}

function semanticHashAlgorithm(
  source: SnapshotSource,
  version: SnapshotVersion,
): LegalSemanticHashAlgorithm {
  const declared = [
    ["version.articleHashAlgorithm", version.articleHashAlgorithm],
    ["source.contentHashAlgorithm", source.contentHashAlgorithm],
  ].filter(([, value]) => value !== undefined && value !== null);

  if (declared.length === 0) {
    // Snapshots written before the algorithm field was introduced used v1.
    return "legal-semantic-text-v1";
  }

  const algorithms = declared.map(([label, value]) => {
    if (
      typeof value !== "string" ||
      !LEGAL_SEMANTIC_HASH_ALGORITHMS.includes(
        value as LegalSemanticHashAlgorithm,
      )
    ) {
      throw new TypeError(`${label} is unsupported: ${String(value)}`);
    }
    return value as LegalSemanticHashAlgorithm;
  });

  if (new Set(algorithms).size !== 1) {
    throw new TypeError(
      `semantic hash algorithm mismatch: ${declared
        .map(([label, value]) => `${label}=${String(value)}`)
        .join(", ")}`,
    );
  }
  return algorithms[0];
}

export function validateLegalRuleReviewRegistry(value: unknown) {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false as const, errors: ["registry must be an object"] };
  if (value.schemaVersion !== 1) errors.push("registry.schemaVersion must be 1");
  if (typeof value.rulesetVersion !== "string" || !value.rulesetVersion) {
    errors.push("registry.rulesetVersion is required");
  }
  if (!isCalendarDate(value.reviewedAt)) errors.push("registry.reviewedAt must be YYYY-MM-DD");
  if (!Array.isArray(value.reviews)) {
    errors.push("registry.reviews must be an array");
  } else {
    const seen = new Set<string>();
    value.reviews.forEach((review, index) => {
      if (!isRecord(review)) {
        errors.push(`registry.reviews[${index}] must be an object`);
        return;
      }
      if (typeof review.sourceId !== "string" || !review.sourceId) {
        errors.push(`registry.reviews[${index}].sourceId is required`);
      }
      if (typeof review.versionId !== "string" || !review.versionId) {
        errors.push(`registry.reviews[${index}].versionId is required`);
      }
      if (typeof review.documentHash !== "string" || !review.documentHash) {
        errors.push(`registry.reviews[${index}].documentHash is required`);
      }
      if (!isCalendarDate(review.effectiveDate)) {
        errors.push(`registry.reviews[${index}].effectiveDate must be YYYY-MM-DD`);
      }
      if (!["rule_updated", "no_analyzer_impact", "superseded"].includes(String(review.outcome))) {
        errors.push(`registry.reviews[${index}].outcome is invalid`);
      }
      if (
        typeof review.sourceId === "string" &&
        typeof review.versionId === "string" &&
        typeof review.documentHash === "string"
      ) {
        const key = versionKey(review.sourceId, review.versionId, review.documentHash);
        if (seen.has(key)) errors.push(`registry contains duplicate review ${key}`);
        seen.add(key);
      }
    });
  }
  return errors.length
    ? { valid: false as const, errors }
    : { valid: true as const, errors: [] };
}

export function assertLegalRuleReviewRegistry(
  value: unknown,
): asserts value is LegalRuleReviewRegistry {
  const result = validateLegalRuleReviewRegistry(value);
  if (!result.valid) throw new TypeError(result.errors.join("; "));
}

function validatePendingChange(change: unknown, index: number, errors: string[]) {
  if (!isRecord(change)) {
    errors.push(`manifest.pendingChanges[${index}] must be an object`);
    return;
  }
  for (const key of [
    "changeId",
    "sourceId",
    "versionId",
    "documentHash",
    "hashAlgorithm",
    "name",
    "version",
    "status",
    "url",
  ]) {
    if (typeof change[key] !== "string" || !change[key]) {
      errors.push(`manifest.pendingChanges[${index}].${key} is required`);
    }
  }
  if (!isCalendarDate(change.effectiveFrom)) {
    errors.push(`manifest.pendingChanges[${index}].effectiveFrom must be YYYY-MM-DD`);
  }
  if (
    ![
      ...LEGAL_SEMANTIC_HASH_ALGORITHMS,
      "legacy-document-hash",
      "source-fingerprint",
    ].includes(change.hashAlgorithm as LegalRuntimeHashAlgorithm)
  ) {
    errors.push(`manifest.pendingChanges[${index}].hashAlgorithm is invalid`);
  }
  if (typeof change.effectiveDateUnknown !== "boolean") {
    errors.push(`manifest.pendingChanges[${index}].effectiveDateUnknown must be boolean`);
  }
  for (const key of ["detectedAt", "firstObservedAt", "lastObservedAt"]) {
    if (typeof change[key] !== "string" || Number.isNaN(Date.parse(change[key]))) {
      errors.push(`manifest.pendingChanges[${index}].${key} must be an ISO date-time`);
    }
  }
  if (change.changeKind !== "semantic") {
    errors.push(`manifest.pendingChanges[${index}].changeKind must be semantic`);
  }
  if (!Array.isArray(change.impactCategories) || change.impactCategories.length === 0) {
    errors.push(`manifest.pendingChanges[${index}].impactCategories is required`);
  } else if (
    change.impactCategories.some(
      (category) => !ALL_LEGAL_IMPACT_CATEGORIES.includes(category as LegalImpactCategory),
    )
  ) {
    errors.push(`manifest.pendingChanges[${index}].impactCategories contains an unknown value`);
  }
  if (!isRecord(change.review) || change.review.status !== "pending") {
    errors.push(`manifest.pendingChanges[${index}].review must remain pending`);
  } else if (
    change.review.reviewedAt !== null ||
    change.review.reviewedRulesetVersion !== null ||
    change.review.outcome !== null
  ) {
    errors.push(`manifest.pendingChanges[${index}].review fields must be null`);
  }
  if (!new Set(["observed", "not_observed"]).has(String(change.observation))) {
    errors.push(`manifest.pendingChanges[${index}].observation is invalid`);
  }
}

export function validateLegalRuntimeManifest(value: unknown) {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false as const, errors: ["manifest must be an object"] };
  if (value.schemaVersion !== LEGAL_RUNTIME_MANIFEST_SCHEMA_VERSION) {
    errors.push(`manifest.schemaVersion must be ${LEGAL_RUNTIME_MANIFEST_SCHEMA_VERSION}`);
  }
  for (const key of ["generatedAt", "snapshotCapturedAt"]) {
    if (typeof value[key] !== "string" || Number.isNaN(Date.parse(value[key]))) {
      errors.push(`manifest.${key} must be an ISO date-time`);
    }
  }
  if (!isCalendarDate(value.asOfDate)) errors.push("manifest.asOfDate must be YYYY-MM-DD");
  if (!isCalendarDate(value.registryReviewedAt)) {
    errors.push("manifest.registryReviewedAt must be YYYY-MM-DD");
  }
  if (typeof value.rulesetVersion !== "string" || !value.rulesetVersion) {
    errors.push("manifest.rulesetVersion is required");
  }
  for (const key of ["sourceCount", "pendingCount", "effectivePendingCount"]) {
    if (!Number.isInteger(value[key]) || Number(value[key]) < 0) {
      errors.push(`manifest.${key} must be a non-negative integer`);
    }
  }
  if (value.nextReviewRequiredBy !== null && !isCalendarDate(value.nextReviewRequiredBy)) {
    errors.push("manifest.nextReviewRequiredBy must be null or YYYY-MM-DD");
  }
  if (!Array.isArray(value.reviewedVersions)) {
    errors.push("manifest.reviewedVersions must be an array");
  } else {
    const registryValidation = validateLegalRuleReviewRegistry({
      schemaVersion: 1,
      rulesetVersion: value.rulesetVersion,
      reviewedAt: value.registryReviewedAt,
      reviews: value.reviewedVersions,
    });
    errors.push(
      ...registryValidation.errors.map((error) =>
        error.replace(/^registry/, "manifest.reviewedVersions"),
      ),
    );
  }
  if (!Array.isArray(value.pendingChanges)) {
    errors.push("manifest.pendingChanges must be an array");
  } else {
    value.pendingChanges.forEach((change, index) =>
      validatePendingChange(change, index, errors),
    );
    if (
      Number.isInteger(value.pendingCount) &&
      value.pendingCount !== value.pendingChanges.length
    ) {
      errors.push("manifest.pendingCount must equal pendingChanges.length");
    }
    const pendingKeys = new Set<string>();
    for (const change of value.pendingChanges) {
      if (!isRecord(change)) continue;
      if (
        typeof change.sourceId !== "string" ||
        typeof change.versionId !== "string" ||
        typeof change.documentHash !== "string"
      ) {
        continue;
      }
      const key = versionKey(change.sourceId, change.versionId, change.documentHash);
      if (pendingKeys.has(key)) errors.push(`manifest contains duplicate pending change ${key}`);
      pendingKeys.add(key);
    }
    if (Array.isArray(value.reviewedVersions)) {
      for (const review of value.reviewedVersions) {
        if (!isRecord(review)) continue;
        if (
          typeof review.sourceId !== "string" ||
          typeof review.versionId !== "string" ||
          typeof review.documentHash !== "string"
        ) {
          continue;
        }
        const key = versionKey(review.sourceId, review.versionId, review.documentHash);
        if (pendingKeys.has(key)) {
          errors.push(`manifest version cannot be both reviewed and pending: ${key}`);
        }
      }
    }
    if (isCalendarDate(value.asOfDate)) {
      const computedEffectiveCount = value.pendingChanges.filter(
        (change) =>
          isRecord(change) &&
          isCalendarDate(change.effectiveFrom) &&
          change.effectiveFrom <= value.asOfDate,
      ).length;
      if (value.effectivePendingCount !== computedEffectiveCount) {
        errors.push("manifest.effectivePendingCount does not match asOfDate");
      }
      const computedNextReview = value.pendingChanges
        .filter((change) => isRecord(change) && isCalendarDate(change.effectiveFrom))
        .map((change) => change.effectiveFrom as string)
        .sort()[0] ?? null;
      if (value.nextReviewRequiredBy !== computedNextReview) {
        errors.push("manifest.nextReviewRequiredBy does not match pendingChanges");
      }
    }
  }
  return errors.length
    ? { valid: false as const, errors }
    : { valid: true as const, errors: [] };
}

export function assertLegalRuntimeManifest(
  value: unknown,
): asserts value is LegalRuntimeManifest {
  const result = validateLegalRuntimeManifest(value);
  if (!result.valid) throw new TypeError(result.errors.join("; "));
}

function snapshotSources(snapshot: LegalSnapshot) {
  if (!isRecord(snapshot.sources)) throw new TypeError("snapshot.sources must be an object.");
  return Object.values(snapshot.sources) as SnapshotSource[];
}

function normalizeGeneratedAt(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("generatedAt must be valid.");
  return date.toISOString();
}

export function buildLegalRuntimeManifest({
  snapshot,
  registry,
  previousManifest,
  generatedAt = new Date(),
  observedAt,
}: {
  snapshot: LegalSnapshot;
  registry: unknown;
  previousManifest?: unknown;
  generatedAt?: string | Date;
  /** Successful official-source observation time, including no-change runs. */
  observedAt?: string | Date;
}): LegalRuntimeManifest {
  assertLegalRuleReviewRegistry(registry);
  const generatedAtIso = normalizeGeneratedAt(generatedAt);
  const asOfDate = dateInKorea(generatedAtIso);
  const snapshotCapturedAt = observedAt
    ? normalizeGeneratedAt(observedAt)
    : typeof snapshot.capturedAt === "string" && !Number.isNaN(Date.parse(snapshot.capturedAt))
      ? new Date(snapshot.capturedAt).toISOString()
      : generatedAtIso;
  const reviewedKeys = new Set(
    registry.reviews.map((review) =>
      versionKey(review.sourceId, review.versionId, review.documentHash),
    ),
  );
  const previousByKey = new Map<string, RuntimePendingLegalChange>();
  if (previousManifest !== undefined) {
    const validation = validateLegalRuntimeManifest(previousManifest);
    if (!validation.valid) {
      throw new TypeError(`previous manifest is invalid: ${validation.errors.join("; ")}`);
    }
    const previous = previousManifest as LegalRuntimeManifest;
    for (const change of previous.pendingChanges) {
      previousByKey.set(
        versionKey(change.sourceId, change.versionId, change.documentHash),
        change,
      );
    }
  }

  const pendingByKey = new Map<string, RuntimePendingLegalChange>();
  const observedVersionIdentities = new Set<string>();
  for (const source of snapshotSources(snapshot)) {
    const sourceId = typeof source.id === "string" && source.id ? source.id : null;
    if (!sourceId) continue;
    const sourceName = typeof source.name === "string" && source.name ? source.name : sourceId;
    const url = typeof source.officialUrl === "string" ? source.officialUrl : "";
    const sourceVersions = Array.isArray(source.versions)
      ? (source.versions as SnapshotVersion[])
      : [];
    const rowEffectiveDates = new Set(
      sourceVersions
        .map((version) =>
          isRecord(version)
            ? normalizeOfficialEffectiveDate(version.effectiveDate)
            : null,
        )
        .filter((date): date is string => date !== null),
    );
    for (const rawVersion of sourceVersions) {
      if (!isRecord(rawVersion)) continue;
      const versionId = typeof rawVersion.id === "string" ? rawVersion.id : "";
      const officialDocumentHash =
        typeof rawVersion.documentHash === "string" && rawVersion.documentHash
          ? rawVersion.documentHash
          : null;
      const semanticDocumentHash =
        typeof rawVersion.semanticDocumentHash === "string" &&
        rawVersion.semanticDocumentHash
          ? rawVersion.semanticDocumentHash
          : null;
      const documentHash =
        semanticDocumentHash ??
        officialDocumentHash ??
        `missing-document-hash:${versionId}`;
      const hashAlgorithm = semanticDocumentHash
        ? semanticHashAlgorithm(source, rawVersion)
        : "legacy-document-hash";
      const officialState = typeof rawVersion.state === "string" ? rawVersion.state : "미상";
      if (
        !versionId || !["현행", "시행예정"].includes(officialState)
      ) {
        continue;
      }
      observedVersionIdentities.add(`${sourceId}\u0000${versionId}`);
      const key = versionKey(sourceId, versionId, documentHash);
      if (reviewedKeys.has(key)) continue;
      const normalizedEffectiveDate = normalizeOfficialEffectiveDate(rawVersion.effectiveDate);
      const effectiveDateUnknown = normalizedEffectiveDate === null;
      const effectiveFrom = normalizedEffectiveDate ?? asOfDate;
      const previous = previousByKey.get(key);
      const defaultImpacts = DEFAULT_SOURCE_IMPACT_CATEGORIES[sourceId];
      const impactCategories = defaultImpacts
        ? [...defaultImpacts]
        : [...ALL_LEGAL_IMPACT_CATEGORIES];
      pendingByKey.set(key, {
        changeId: `runtime:${sourceId}:${versionId}`,
        sourceId,
        versionId,
        documentHash,
        hashAlgorithm,
        name: sourceName,
        version: `${officialState} · 시행 ${effectiveFrom}${
          typeof rawVersion.promulgationNumber === "string" && rawVersion.promulgationNumber
            ? ` · ${rawVersion.promulgationNumber}`
            : ""
        }`,
        effectiveFrom,
        effectiveDateUnknown,
        detectedAt: previous?.detectedAt ?? snapshotCapturedAt,
        changeKind: "semantic",
        status:
          effectiveFrom <= asOfDate
            ? "시행됨 · 분석 규칙 검토 전 · 관련 판단 유보"
            : "시행 예정 · 분석 규칙 영향 검토 필요",
        url,
        impactCategories,
        review: {
          status: "pending",
          reviewedAt: null,
          reviewedRulesetVersion: null,
          outcome: null,
        },
        officialState,
        observation: "observed",
        firstObservedAt: previous?.firstObservedAt ?? generatedAtIso,
        lastObservedAt: generatedAtIso,
      });
    }

    // A single promulgated document can have multiple staged effective dates.
    // The official API does not always expose every stage as its own version
    // row, so represent missing stages with the same stable identity that a
    // later row would use (MST:YYYYMMDD). This keeps a future stage pending
    // until an exact source/version/semantic-hash review is committed.
    for (const rawVersion of sourceVersions) {
      if (!isRecord(rawVersion)) continue;
      const versionId = typeof rawVersion.id === "string" ? rawVersion.id : "";
      const officialState =
        typeof rawVersion.state === "string" ? rawVersion.state : "미상";
      if (!versionId || !["현행", "시행예정"].includes(officialState)) continue;
      if (!Array.isArray(rawVersion.stageEffectiveDates)) continue;

      const officialDocumentHash =
        typeof rawVersion.documentHash === "string" && rawVersion.documentHash
          ? rawVersion.documentHash
          : null;
      const semanticDocumentHash =
        typeof rawVersion.semanticDocumentHash === "string" &&
        rawVersion.semanticDocumentHash
          ? rawVersion.semanticDocumentHash
          : null;
      const documentHash =
        semanticDocumentHash ??
        officialDocumentHash ??
        `missing-document-hash:${versionId}`;
      const hashAlgorithm = semanticDocumentHash
        ? semanticHashAlgorithm(source, rawVersion)
        : "legacy-document-hash";
      const sourceDocumentWasReviewed = registry.reviews.some(
        (review) =>
          review.sourceId === sourceId &&
          review.documentHash === documentHash &&
          review.effectiveDate <= asOfDate,
      );
      const rootVersionId = versionId.split(":", 1)[0] || versionId;

      for (const rawStage of rawVersion.stageEffectiveDates) {
        const stageDate = normalizeOfficialEffectiveDate(
          isRecord(rawStage) ? rawStage.effectiveDate : rawStage,
        );
        if (!stageDate || rowEffectiveDates.has(stageDate)) continue;

        const stageCompactDate = stageDate.replaceAll("-", "");
        const syntheticVersionId = `${rootVersionId}:${stageCompactDate}`;
        observedVersionIdentities.add(
          `${sourceId}\u0000${syntheticVersionId}`,
        );

        // Do not resurrect an already-effective subsidiary stage when the
        // same semantic document has already received a current review. The
        // stage is still observed so an older hash from a previous manifest
        // is retired instead of being preserved as a missing version.
        if (stageDate <= asOfDate && sourceDocumentWasReviewed) continue;

        const key = versionKey(sourceId, syntheticVersionId, documentHash);
        if (reviewedKeys.has(key)) continue;
        const previous = previousByKey.get(key);
        const defaultImpacts = DEFAULT_SOURCE_IMPACT_CATEGORIES[sourceId];
        pendingByKey.set(key, {
          changeId: `runtime:${sourceId}:${syntheticVersionId}`,
          sourceId,
          versionId: syntheticVersionId,
          documentHash,
          hashAlgorithm,
          name: sourceName,
          version: `별도 단계 시행 ${stageDate}${
            typeof rawVersion.promulgationNumber === "string" &&
            rawVersion.promulgationNumber
              ? ` · ${rawVersion.promulgationNumber}`
              : ""
          }`,
          effectiveFrom: stageDate,
          effectiveDateUnknown: false,
          detectedAt: previous?.detectedAt ?? snapshotCapturedAt,
          changeKind: "semantic",
          status:
            stageDate <= asOfDate
              ? "단계 시행됨 · 분석 규칙 검토 전 · 관련 판단 유보"
              : "단계 시행 예정 · 분석 규칙 영향 검토 필요",
          url,
          impactCategories: defaultImpacts
            ? [...defaultImpacts]
            : [...ALL_LEGAL_IMPACT_CATEGORIES],
          review: {
            status: "pending",
            reviewedAt: null,
            reviewedRulesetVersion: null,
            outcome: null,
          },
          officialState: stageDate <= asOfDate ? "단계 시행" : "단계 시행예정",
          observation: "observed",
          firstObservedAt: previous?.firstObservedAt ?? generatedAtIso,
          lastObservedAt: generatedAtIso,
        });
      }
    }

    if (sourceVersions.length === 0 && typeof source.fingerprint === "string") {
      const versionId = `source-fingerprint:${source.fingerprint}`;
      observedVersionIdentities.add(`${sourceId}\u0000${versionId}`);
      const documentHash = source.fingerprint;
      const key = versionKey(sourceId, versionId, documentHash);
      if (reviewedKeys.has(key)) continue;
      const previous = previousByKey.get(key);
      const firstObservedAt = previous?.firstObservedAt ?? snapshotCapturedAt;
      const effectiveFrom = previous?.effectiveFrom ?? dateInKorea(firstObservedAt);
      const defaultImpacts = DEFAULT_SOURCE_IMPACT_CATEGORIES[sourceId];
      pendingByKey.set(key, {
        changeId: `runtime:${sourceId}:${versionId}`,
        sourceId,
        versionId,
        documentHash,
        hashAlgorithm: "source-fingerprint",
        name: sourceName,
        version: `공식 콘텐츠 fingerprint ${source.fingerprint.slice(0, 12)}`,
        effectiveFrom,
        effectiveDateUnknown: true,
        detectedAt: previous?.detectedAt ?? snapshotCapturedAt,
        changeKind: "semantic",
        status: "공식 지침 변경 감지 · 의미 검토 전까지 관련 판단 유보",
        url,
        impactCategories: defaultImpacts
          ? [...defaultImpacts]
          : [...ALL_LEGAL_IMPACT_CATEGORIES],
        review: {
          status: "pending",
          reviewedAt: null,
          reviewedRulesetVersion: null,
          outcome: null,
        },
        officialState: "공식 콘텐츠",
        observation: "observed",
        firstObservedAt,
        lastObservedAt: generatedAtIso,
      });
    }
  }

  for (const [key, previous] of previousByKey) {
    if (
      reviewedKeys.has(key) ||
      pendingByKey.has(key) ||
      observedVersionIdentities.has(
        `${previous.sourceId}\u0000${previous.versionId}`,
      )
    ) {
      continue;
    }
    pendingByKey.set(key, {
      ...previous,
      observation: "not_observed",
      status: "최근 공식 스냅샷에서 미관측 · 사람 검토 전까지 판단 유보",
    });
  }

  const pendingChanges = [...pendingByKey.values()].sort(
    (left, right) =>
      left.effectiveFrom.localeCompare(right.effectiveFrom) ||
      left.sourceId.localeCompare(right.sourceId) ||
      left.versionId.localeCompare(right.versionId),
  );
  const effectivePendingCount = pendingChanges.filter(
    (change) => change.effectiveFrom <= asOfDate,
  ).length;
  const nextReviewRequiredBy = pendingChanges[0]?.effectiveFrom ?? null;
  const sourceCount = Number.isInteger(snapshot.sourceCount)
    ? Number(snapshot.sourceCount)
    : snapshotSources(snapshot).length;

  const manifest: LegalRuntimeManifest = {
    schemaVersion: LEGAL_RUNTIME_MANIFEST_SCHEMA_VERSION,
    generatedAt: generatedAtIso,
    asOfDate,
    snapshotCapturedAt,
    rulesetVersion: registry.rulesetVersion,
    registryReviewedAt: registry.reviewedAt,
    sourceCount,
    reviewedVersions: registry.reviews.map((review) => ({ ...review })),
    pendingChanges,
    pendingCount: pendingChanges.length,
    effectivePendingCount,
    nextReviewRequiredBy,
  };
  assertLegalRuntimeManifest(manifest);
  return manifest;
}
