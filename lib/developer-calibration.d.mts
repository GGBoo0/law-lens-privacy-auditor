export type DeveloperCalibrationSector =
  | "commerce"
  | "finance"
  | "online_platform"
  | "telecom"
  | "healthcare"
  | "education";

export type DeveloperCalibrationDecision =
  | "confirmed"
  | "false_positive"
  | "uncertain";

export type DeveloperCalibrationReasonCode =
  | "disclosure_present"
  | "rule_not_applicable"
  | "evidence_mismatch"
  | "legal_basis_mismatch"
  | "severity_overstated"
  | "insufficient_context"
  | "source_incomplete"
  | "requires_domain_expertise"
  | "legal_change_pending"
  | "missing_rule_output"
  | "wrong_pass_classification"
  | "severity_understated"
  | "finding_type_mismatch";

export type DeveloperCalibrationAssessmentOutcome =
  | "supported"
  | "unsupported"
  | "uncertain";

export type DeveloperCalibrationSha256 = `sha256:${string}`;

export type DeveloperCalibrationPins = {
  analyzerVersion: string;
  rulesetVersion: string;
  analyzerSourceSha256: DeveloperCalibrationSha256;
  ruleCatalogSha256: DeveloperCalibrationSha256;
  legalRuntimeManifestSha256: DeveloperCalibrationSha256;
  legalSourceSnapshotSha256: DeveloperCalibrationSha256;
};

export type DeveloperCalibrationLegalCohort = {
  runtimeLegalStateSha256: DeveloperCalibrationSha256;
  rulesetVersion: string;
};

export type DeveloperCalibrationSourcePins = {
  sourceDocumentSha256: DeveloperCalibrationSha256;
  analysisInputSha256: DeveloperCalibrationSha256;
  analyzerOutputSha256: DeveloperCalibrationSha256;
  analyzerVersion: string;
  rulesetVersion: string;
  legalAsOfDate: string;
  runtimeManifestCanonicalSha256: DeveloperCalibrationSha256;
  runtimeLegalStateSha256: DeveloperCalibrationSha256;
  runtimeManifestSource: "live" | "bundled";
  runtimeManifestStatus: "valid";
  runtimeManifestGeneratedAt: string;
  retrievedAt: string;
  analyzedAt: string;
};

export type DeveloperCalibrationEvidenceAnchor = {
  start: number;
  end: number;
  anchorSha256: DeveloperCalibrationSha256;
};

export type DeveloperCalibrationEvidenceAssessment = {
  outcome: DeveloperCalibrationAssessmentOutcome;
  anchors: DeveloperCalibrationEvidenceAnchor[];
};

export type DeveloperCalibrationLegalBasisRef = {
  sourceId: string;
  provisionId: string;
};

export type DeveloperCalibrationLegalBasisAssessment = {
  outcome: DeveloperCalibrationAssessmentOutcome;
  basisRefs: DeveloperCalibrationLegalBasisRef[];
};

export type DeveloperCalibrationFindingReview = {
  findingId: string;
  ruleId: string;
  decision: DeveloperCalibrationDecision;
  reasonCodes: DeveloperCalibrationReasonCode[];
  severityFit: "appropriate" | "overstated" | "understated" | "uncertain";
  evidenceAssessment: DeveloperCalibrationEvidenceAssessment;
  legalBasisAssessment: DeveloperCalibrationLegalBasisAssessment;
};

export type DeveloperCalibrationManualMissedFinding = {
  missedFindingId: string;
  ruleId: string;
  severity: "high" | "medium" | "low";
  reasonCodes: DeveloperCalibrationReasonCode[];
  evidenceAssessment: DeveloperCalibrationEvidenceAssessment;
  legalBasisAssessment: DeveloperCalibrationLegalBasisAssessment;
};

export type DeveloperCalibrationCaseReview = {
  caseId: string;
  reviewMode: "developer_self_review";
  validationLevel: "not_expert_validated";
  documentCompleteness: "full" | "partial" | "unknown";
  omissionCheckCompleted: boolean;
  analyzerFindingCount: number;
  sourcePins: DeveloperCalibrationSourcePins;
  reviewedAt: string;
  findingReviews: DeveloperCalibrationFindingReview[];
  manualMissedFindings: DeveloperCalibrationManualMissedFinding[];
};

export type DeveloperCalibrationSlot = {
  slotId: `slot-${string}`;
  sector: DeveloperCalibrationSector;
  status: "unassigned" | "in_review" | "completed";
  caseReview: DeveloperCalibrationCaseReview | null;
};

export type DeveloperCalibrationAssessmentCounts = {
  supported: number;
  unsupported: number;
  uncertain: number;
};

export type DeveloperCalibrationAggregate = {
  aggregateVersion: "1.0.0";
  datasetRevision: number;
  calibrationCounts: {
    totalSlots: 24;
    unassignedSlots: number;
    inReviewSlots: number;
    completedSlots: number;
    findingDecisions: number;
    confirmed: number;
    falsePositive: number;
    uncertain: number;
    evidenceAssessments: DeveloperCalibrationAssessmentCounts;
    legalBasisAssessments: DeveloperCalibrationAssessmentCounts;
    manualMissedFindings: number;
    omissionEligibleSlotsWithMisses: number;
    omissionEligibleCompletedSlots: number;
  };
  calibrationRates: {
    slotCompletionRate: number;
    findingConfirmationRate: number | null;
    falsePositiveRate: number | null;
    uncertainDecisionRate: number | null;
    evidenceSupportRate: number | null;
    legalBasisSupportRate: number | null;
    omissionCheckedSlotMissRate: number | null;
  };
};

export type DeveloperCalibrationDataset = {
  schemaVersion: "1.0.0";
  aggregateVersion: "1.0.0";
  datasetId: string;
  datasetRevision: number;
  reviewMode: "developer_self_review";
  validationLevel: "not_expert_validated";
  createdAt: string;
  updatedAt: string;
  sectorPlan: Array<{
    sector: DeveloperCalibrationSector;
    requiredSlotCount: 4;
  }>;
  pins: DeveloperCalibrationPins;
  legalCohort: DeveloperCalibrationLegalCohort | null;
  slots: DeveloperCalibrationSlot[];
  aggregate: DeveloperCalibrationAggregate;
};

export type DeveloperCalibrationValidationOptions = {
  requireComplete?: boolean;
};

export const DEVELOPER_CALIBRATION_SCHEMA_VERSION: "1.0.0";
export const DEVELOPER_CALIBRATION_AGGREGATE_VERSION: "1.0.0";
export const DEVELOPER_CALIBRATION_SLOT_COUNT: 24;
export const DEVELOPER_CALIBRATION_MAX_JSON_BYTES: 5_000_000;
export const DEVELOPER_CALIBRATION_SECTORS: readonly DeveloperCalibrationSector[];
export const DEVELOPER_CALIBRATION_DEFAULT_PINS: Readonly<DeveloperCalibrationPins>;

export class DeveloperCalibrationValidationError extends Error {
  issues: string[];
  constructor(issues: string[]);
}

export function buildDeveloperCalibrationAggregate(
  dataset: DeveloperCalibrationDataset,
): DeveloperCalibrationAggregate;

export function refreshDeveloperCalibrationAggregate(
  dataset: DeveloperCalibrationDataset,
): DeveloperCalibrationDataset;

export function assertDeveloperCalibrationDataset(
  value: unknown,
  options?: DeveloperCalibrationValidationOptions,
): DeveloperCalibrationDataset;

export function parseDeveloperCalibrationDataset(
  json: string,
  options?: DeveloperCalibrationValidationOptions,
): DeveloperCalibrationDataset;

export function serializeDeveloperCalibrationDataset(
  value: unknown,
  options?: DeveloperCalibrationValidationOptions,
): string;

export function createEmptyDeveloperCalibrationDataset(options?: {
  datasetId?: string;
  now?: string;
  pins?: DeveloperCalibrationPins;
}): DeveloperCalibrationDataset;

export function developerCalibrationSchema(): unknown;
