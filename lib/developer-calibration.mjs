import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../data/developer-calibration/calibration.schema.json" with {
  type: "json",
};

export const DEVELOPER_CALIBRATION_SCHEMA_VERSION = "1.0.0";
export const DEVELOPER_CALIBRATION_AGGREGATE_VERSION = "1.0.0";
export const DEVELOPER_CALIBRATION_SLOT_COUNT = 24;
export const DEVELOPER_CALIBRATION_MAX_JSON_BYTES = 5_000_000;
export const DEVELOPER_CALIBRATION_SECTORS = Object.freeze([
  "commerce",
  "finance",
  "online_platform",
  "telecom",
  "healthcare",
  "education",
]);

export const DEVELOPER_CALIBRATION_DEFAULT_PINS = Object.freeze({
  analyzerVersion: "KR-PRIVACY-2026.08.11-r4",
  rulesetVersion: "KR-PRIVACY-2026.08.11-r4",
  analyzerSourceSha256:
    "sha256:a4567d554b87cbb095635ce90ccd4f4ad8eeebacb7df0155aa378b11c493c2a9",
  ruleCatalogSha256:
    "sha256:3959fe16238a181f0356662e2376ad0d8064afde6802ab862683a0bf6e6ad62d",
  legalRuntimeManifestSha256:
    "sha256:3e9c8177780848d9613afc29ebe27220be6360942c15bba4d8d0c88aa8167639",
  legalSourceSnapshotSha256:
    "sha256:4afd5b5447c42e61f82d478f19130462ba4048698f93a815322b1e8d9362a5ed",
});

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

const EXPECTED_SLOT_IDS = new Set(
  Array.from(
    { length: DEVELOPER_CALIBRATION_SLOT_COUNT },
    (_, index) => `slot-${String(index + 1).padStart(2, "0")}`,
  ),
);
const MANUAL_MISS_REASON_CODES = new Set([
  "missing_rule_output",
  "wrong_pass_classification",
  "severity_understated",
  "finding_type_mismatch",
]);
const FORBIDDEN_PERSISTED_KEY =
  /^(?:raw(?:Text|Html|Content)?|text|policyText|policyExcerpt|excerpt|quote|content|html|sourceUrl|policyUrl|url|domain|company|companyName|memo|note|displayLabel)$/i;
const SHA256_PATTERN = /^sha256:([a-f0-9]{64})$/;

export class DeveloperCalibrationValidationError extends Error {
  constructor(issues) {
    super(`Invalid developer calibration dataset: ${issues.join("; ")}`);
    this.name = "DeveloperCalibrationValidationError";
    this.issues = issues;
  }
}

function formatSchemaErrors(errors) {
  return (errors ?? []).map(
    (error) => `${error.instancePath || "/"} ${error.message}`,
  );
}

function roundRate(numerator, denominator) {
  if (denominator === 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

function assessmentCounts() {
  return { supported: 0, unsupported: 0, uncertain: 0 };
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => deepEqual(item, right[index]))
    );
  }
  if (typeof left !== "object") return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && deepEqual(left[key], right[key]),
    )
  );
}

function assertSchema(value) {
  if (!validateSchema(value)) {
    throw new DeveloperCalibrationValidationError(
      formatSchemaErrors(validateSchema.errors),
    );
  }
}

function collectForbiddenKeys(value, path = "$", issues = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectForbiddenKeys(item, `${path}[${index}]`, issues),
    );
    return issues;
  }
  if (!value || typeof value !== "object") return issues;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PERSISTED_KEY.test(key) || /accuracy/i.test(key)) {
      issues.push(`${path}.${key} is not permitted in persisted calibration data`);
    }
    collectForbiddenKeys(child, `${path}.${key}`, issues);
  }
  return issues;
}

function isPlaceholderHash(value) {
  const match = SHA256_PATTERN.exec(value);
  return !match || /^0{64}$/.test(match[1]);
}

function addDuplicateIssue(seen, value, label, issues) {
  if (seen.has(value)) issues.push(`duplicate ${label}: ${value}`);
  seen.add(value);
}

function validateAssessment(assessment, label, issues) {
  if (assessment.outcome === "supported" && assessment.anchors.length === 0) {
    issues.push(`${label} marked supported requires at least one hashed anchor`);
  }
  for (const [index, anchor] of assessment.anchors.entries()) {
    if (anchor.end <= anchor.start) {
      issues.push(`${label}.anchors[${index}] end must be greater than start`);
    }
    if (isPlaceholderHash(anchor.anchorSha256)) {
      issues.push(`${label}.anchors[${index}] uses a placeholder hash`);
    }
  }
}

function validateLegalBasisAssessment(assessment, label, issues) {
  if (assessment.outcome === "supported" && assessment.basisRefs.length === 0) {
    issues.push(`${label} marked supported requires at least one legal basis reference`);
  }
  const seen = new Set();
  for (const basis of assessment.basisRefs) {
    addDuplicateIssue(
      seen,
      `${basis.sourceId}\u0000${basis.provisionId}`,
      `${label} legal basis reference`,
      issues,
    );
  }
}

function validateCaseReview(
  caseReview,
  slot,
  rootUpdatedAt,
  state,
  datasetPins,
  legalCohort,
  issues,
) {
  if (caseReview.reviewMode !== "developer_self_review") {
    issues.push(`${slot.slotId} must remain developer_self_review`);
  }
  if (caseReview.validationLevel !== "not_expert_validated") {
    issues.push(`${slot.slotId} must remain not_expert_validated`);
  }
  if (caseReview.sourcePins.analyzerVersion !== datasetPins.analyzerVersion) {
    issues.push(`${slot.slotId} analyzerVersion does not match dataset pins`);
  }
  if (caseReview.sourcePins.rulesetVersion !== datasetPins.rulesetVersion) {
    issues.push(`${slot.slotId} rulesetVersion does not match dataset pins`);
  }
  if (
    legalCohort &&
    caseReview.sourcePins.runtimeLegalStateSha256 !==
      legalCohort.runtimeLegalStateSha256
  ) {
    issues.push(`${slot.slotId} runtime legal state does not match legal cohort`);
  }
  if (
    legalCohort &&
    caseReview.sourcePins.rulesetVersion !== legalCohort.rulesetVersion
  ) {
    issues.push(`${slot.slotId} rulesetVersion does not match legal cohort`);
  }
  if (state === "completed" && caseReview.documentCompleteness === "unknown") {
    issues.push(`${slot.slotId} completed review must declare full or partial document completeness`);
  }
  if (
    state === "completed" &&
    caseReview.documentCompleteness === "full" &&
    !caseReview.omissionCheckCompleted
  ) {
    issues.push(`${slot.slotId} completed full-document review requires an omission check`);
  }
  if (
    caseReview.omissionCheckCompleted &&
    caseReview.documentCompleteness === "unknown"
  ) {
    issues.push(`${slot.slotId} cannot complete an omission check with unknown document completeness`);
  }
  if (
    caseReview.manualMissedFindings.length > 0 &&
    !caseReview.omissionCheckCompleted
  ) {
    issues.push(`${slot.slotId} manual missed findings require a completed omission check`);
  }
  if (
    state === "completed" &&
    caseReview.findingReviews.length !== caseReview.analyzerFindingCount
  ) {
    issues.push(
      `${slot.slotId} findingReviews length must equal analyzerFindingCount (${caseReview.analyzerFindingCount})`,
    );
  }
  if (
    state === "in_review" &&
    caseReview.findingReviews.length > caseReview.analyzerFindingCount
  ) {
    issues.push(
      `${slot.slotId} draft findingReviews cannot exceed analyzerFindingCount (${caseReview.analyzerFindingCount})`,
    );
  }

  const retrievedAt = Date.parse(caseReview.sourcePins.retrievedAt);
  const analyzedAt = Date.parse(caseReview.sourcePins.analyzedAt);
  const reviewedAt = Date.parse(caseReview.reviewedAt);
  const runtimeManifestGeneratedAt = Date.parse(
    caseReview.sourcePins.runtimeManifestGeneratedAt,
  );
  if (runtimeManifestGeneratedAt > analyzedAt) {
    issues.push(`${slot.slotId} runtime manifest was generated after analysis`);
  }
  if (retrievedAt > analyzedAt) {
    issues.push(`${slot.slotId} analyzedAt precedes retrievedAt`);
  }
  if (analyzedAt > reviewedAt) {
    issues.push(`${slot.slotId} reviewedAt precedes analyzedAt`);
  }
  if (reviewedAt > rootUpdatedAt) {
    issues.push(`${slot.slotId} reviewedAt is later than dataset updatedAt`);
  }

  for (const [pinName, pin] of Object.entries(caseReview.sourcePins)) {
    if (pinName.endsWith("Sha256") && isPlaceholderHash(pin)) {
      issues.push(`${slot.slotId}.${pinName} uses a placeholder hash`);
    }
  }

  const findingIds = new Set();
  for (const [index, finding] of caseReview.findingReviews.entries()) {
    const label = `${slot.slotId}.findingReviews[${index}]`;
    addDuplicateIssue(findingIds, finding.findingId, "findingId in case", issues);
    if (
      (finding.decision === "false_positive" ||
        finding.decision === "uncertain") &&
      finding.reasonCodes.length === 0
    ) {
      issues.push(`${label} requires a structured reason code`);
    }
    validateAssessment(finding.evidenceAssessment, `${label}.evidenceAssessment`, issues);
    validateLegalBasisAssessment(
      finding.legalBasisAssessment,
      `${label}.legalBasisAssessment`,
      issues,
    );
  }

  const missedFindingIds = new Set();
  for (const [index, missed] of caseReview.manualMissedFindings.entries()) {
    const label = `${slot.slotId}.manualMissedFindings[${index}]`;
    addDuplicateIssue(
      missedFindingIds,
      missed.missedFindingId,
      "missedFindingId in case",
      issues,
    );
    if (!missed.reasonCodes.some((code) => MANUAL_MISS_REASON_CODES.has(code))) {
      issues.push(`${label} requires a manual-miss reason code`);
    }
    validateAssessment(missed.evidenceAssessment, `${label}.evidenceAssessment`, issues);
    validateLegalBasisAssessment(
      missed.legalBasisAssessment,
      `${label}.legalBasisAssessment`,
      issues,
    );
  }

  if (state === "completed" && caseReview.reviewedAt.length === 0) {
    issues.push(`${slot.slotId} completed review requires reviewedAt`);
  }
}

function semanticIssues(value, { requireComplete = false } = {}) {
  const issues = collectForbiddenKeys(value);
  const createdAt = Date.parse(value.createdAt);
  const updatedAt = Date.parse(value.updatedAt);
  if (createdAt > updatedAt) issues.push("updatedAt precedes createdAt");

  const planSectors = new Set();
  for (const plan of value.sectorPlan) {
    addDuplicateIssue(planSectors, plan.sector, "sector plan entry", issues);
  }
  for (const sector of DEVELOPER_CALIBRATION_SECTORS) {
    if (!planSectors.has(sector)) issues.push(`sector plan is missing ${sector}`);
  }

  for (const [pinName, pin] of Object.entries(value.pins)) {
    if (pinName.endsWith("Sha256") && isPlaceholderHash(pin)) {
      issues.push(`pins.${pinName} uses a placeholder hash`);
    }
  }
  if (value.legalCohort) {
    if (isPlaceholderHash(value.legalCohort.runtimeLegalStateSha256)) {
      issues.push("legalCohort.runtimeLegalStateSha256 uses a placeholder hash");
    }
    if (value.legalCohort.rulesetVersion !== value.pins.rulesetVersion) {
      issues.push("legalCohort.rulesetVersion does not match dataset pins");
    }
  }

  const slotIds = new Set();
  const sectorCounts = new Map(
    DEVELOPER_CALIBRATION_SECTORS.map((sector) => [sector, 0]),
  );
  const caseIds = new Set();
  const sourceDocumentHashes = new Set();
  const analysisInputHashes = new Set();

  for (const slot of value.slots) {
    addDuplicateIssue(slotIds, slot.slotId, "slotId", issues);
    sectorCounts.set(slot.sector, (sectorCounts.get(slot.sector) ?? 0) + 1);

    if (slot.status === "unassigned" && slot.caseReview !== null) {
      issues.push(`${slot.slotId} unassigned slot must not contain a case review`);
    }
    if (slot.status !== "unassigned" && slot.caseReview === null) {
      issues.push(`${slot.slotId} ${slot.status} slot requires a case review`);
    }
    if (requireComplete && slot.status !== "completed") {
      issues.push(`${slot.slotId} is not completed`);
    }
    if (slot.caseReview) {
      addDuplicateIssue(caseIds, slot.caseReview.caseId, "caseId", issues);
      addDuplicateIssue(
        sourceDocumentHashes,
        slot.caseReview.sourcePins.sourceDocumentSha256,
        "source document hash",
        issues,
      );
      addDuplicateIssue(
        analysisInputHashes,
        slot.caseReview.sourcePins.analysisInputSha256,
        "analysis input hash",
        issues,
      );
      validateCaseReview(
        slot.caseReview,
        slot,
        updatedAt,
        slot.status,
        value.pins,
        value.legalCohort,
        issues,
      );
    }
  }

  for (const expectedId of EXPECTED_SLOT_IDS) {
    if (!slotIds.has(expectedId)) issues.push(`missing required slotId: ${expectedId}`);
  }
  for (const [sector, count] of sectorCounts) {
    if (count !== 4) issues.push(`${sector} must have exactly 4 slots, found ${count}`);
  }
  if (caseIds.size === 0 && value.legalCohort !== null) {
    issues.push("empty dataset must not have a legal cohort");
  }
  if (caseIds.size > 0 && value.legalCohort === null) {
    issues.push("dataset with an active case requires a legal cohort");
  }

  const expectedAggregate = buildDeveloperCalibrationAggregate(value);
  if (!deepEqual(value.aggregate, expectedAggregate)) {
    issues.push("aggregate does not match the dataset; refresh it before import/export");
  }
  return issues;
}

export function buildDeveloperCalibrationAggregate(dataset) {
  assertSchema(dataset);
  const calibrationCounts = {
    totalSlots: DEVELOPER_CALIBRATION_SLOT_COUNT,
    unassignedSlots: 0,
    inReviewSlots: 0,
    completedSlots: 0,
    findingDecisions: 0,
    confirmed: 0,
    falsePositive: 0,
    uncertain: 0,
    evidenceAssessments: assessmentCounts(),
    legalBasisAssessments: assessmentCounts(),
    manualMissedFindings: 0,
    omissionEligibleSlotsWithMisses: 0,
    omissionEligibleCompletedSlots: 0,
  };

  for (const slot of dataset.slots) {
    if (slot.status === "unassigned") calibrationCounts.unassignedSlots += 1;
    if (slot.status === "in_review") calibrationCounts.inReviewSlots += 1;
    if (slot.status !== "completed") continue;

    calibrationCounts.completedSlots += 1;
    const review = slot.caseReview;
    const omissionEligible =
      review.documentCompleteness === "full" && review.omissionCheckCompleted;
    if (omissionEligible) calibrationCounts.omissionEligibleCompletedSlots += 1;
    if (review.manualMissedFindings.length > 0 && omissionEligible) {
      calibrationCounts.omissionEligibleSlotsWithMisses += 1;
    }
    calibrationCounts.manualMissedFindings += review.manualMissedFindings.length;

    for (const finding of review.findingReviews) {
      calibrationCounts.findingDecisions += 1;
      if (finding.decision === "confirmed") calibrationCounts.confirmed += 1;
      if (finding.decision === "false_positive") {
        calibrationCounts.falsePositive += 1;
      }
      if (finding.decision === "uncertain") calibrationCounts.uncertain += 1;
      calibrationCounts.evidenceAssessments[finding.evidenceAssessment.outcome] += 1;
      calibrationCounts.legalBasisAssessments[
        finding.legalBasisAssessment.outcome
      ] += 1;
    }
  }

  const evidenceTotal = Object.values(calibrationCounts.evidenceAssessments).reduce(
    (sum, count) => sum + count,
    0,
  );
  const legalBasisTotal = Object.values(
    calibrationCounts.legalBasisAssessments,
  ).reduce((sum, count) => sum + count, 0);

  return {
    aggregateVersion: DEVELOPER_CALIBRATION_AGGREGATE_VERSION,
    datasetRevision: dataset.datasetRevision,
    calibrationCounts,
    calibrationRates: {
      slotCompletionRate: roundRate(
        calibrationCounts.completedSlots,
        DEVELOPER_CALIBRATION_SLOT_COUNT,
      ),
      findingConfirmationRate: roundRate(
        calibrationCounts.confirmed,
        calibrationCounts.findingDecisions,
      ),
      falsePositiveRate: roundRate(
        calibrationCounts.falsePositive,
        calibrationCounts.findingDecisions,
      ),
      uncertainDecisionRate: roundRate(
        calibrationCounts.uncertain,
        calibrationCounts.findingDecisions,
      ),
      evidenceSupportRate: roundRate(
        calibrationCounts.evidenceAssessments.supported,
        evidenceTotal,
      ),
      legalBasisSupportRate: roundRate(
        calibrationCounts.legalBasisAssessments.supported,
        legalBasisTotal,
      ),
      omissionCheckedSlotMissRate: roundRate(
        calibrationCounts.omissionEligibleSlotsWithMisses,
        calibrationCounts.omissionEligibleCompletedSlots,
      ),
    },
  };
}

export function refreshDeveloperCalibrationAggregate(dataset) {
  assertSchema(dataset);
  const refreshed = structuredClone(dataset);
  refreshed.aggregate = buildDeveloperCalibrationAggregate(refreshed);
  return assertDeveloperCalibrationDataset(refreshed);
}

export function assertDeveloperCalibrationDataset(
  value,
  { requireComplete = false } = {},
) {
  assertSchema(value);
  const issues = semanticIssues(value, { requireComplete });
  if (issues.length > 0) throw new DeveloperCalibrationValidationError(issues);
  return value;
}

export function parseDeveloperCalibrationDataset(
  json,
  { requireComplete = false } = {},
) {
  if (typeof json !== "string") {
    throw new DeveloperCalibrationValidationError(["import must be a JSON string"]);
  }
  if (
    json.length > DEVELOPER_CALIBRATION_MAX_JSON_BYTES ||
    new TextEncoder().encode(json).byteLength > DEVELOPER_CALIBRATION_MAX_JSON_BYTES
  ) {
    throw new DeveloperCalibrationValidationError([
      `import exceeds ${DEVELOPER_CALIBRATION_MAX_JSON_BYTES} UTF-8 bytes`,
    ]);
  }
  let value;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new DeveloperCalibrationValidationError([
      `JSON parsing failed: ${error instanceof Error ? error.message : "unknown error"}`,
    ]);
  }
  return assertDeveloperCalibrationDataset(value, { requireComplete });
}

export function serializeDeveloperCalibrationDataset(
  value,
  { requireComplete = false } = {},
) {
  assertDeveloperCalibrationDataset(value, { requireComplete });
  const json = `${JSON.stringify(value, null, 2)}\n`;
  if (
    json.length > DEVELOPER_CALIBRATION_MAX_JSON_BYTES ||
    new TextEncoder().encode(json).byteLength > DEVELOPER_CALIBRATION_MAX_JSON_BYTES
  ) {
    throw new DeveloperCalibrationValidationError([
      `export exceeds ${DEVELOPER_CALIBRATION_MAX_JSON_BYTES} UTF-8 bytes`,
    ]);
  }
  parseDeveloperCalibrationDataset(json, { requireComplete });
  return json;
}

export function createEmptyDeveloperCalibrationDataset({
  datasetId = "devcal-local-v1",
  now = new Date().toISOString(),
  pins = DEVELOPER_CALIBRATION_DEFAULT_PINS,
} = {}) {
  const slots = DEVELOPER_CALIBRATION_SECTORS.flatMap((sector, sectorIndex) =>
    Array.from({ length: 4 }, (_, offset) => ({
      slotId: `slot-${String(sectorIndex * 4 + offset + 1).padStart(2, "0")}`,
      sector,
      status: "unassigned",
      caseReview: null,
    })),
  );
  const value = {
    schemaVersion: DEVELOPER_CALIBRATION_SCHEMA_VERSION,
    aggregateVersion: DEVELOPER_CALIBRATION_AGGREGATE_VERSION,
    datasetId,
    datasetRevision: 0,
    reviewMode: "developer_self_review",
    validationLevel: "not_expert_validated",
    createdAt: now,
    updatedAt: now,
    sectorPlan: DEVELOPER_CALIBRATION_SECTORS.map((sector) => ({
      sector,
      requiredSlotCount: 4,
    })),
    pins: structuredClone(pins),
    legalCohort: null,
    slots,
    aggregate: null,
  };
  value.aggregate = buildDeveloperCalibrationAggregate({
    ...value,
    aggregate: {
      aggregateVersion: DEVELOPER_CALIBRATION_AGGREGATE_VERSION,
      datasetRevision: 0,
      calibrationCounts: {
        totalSlots: 24,
        unassignedSlots: 24,
        inReviewSlots: 0,
        completedSlots: 0,
        findingDecisions: 0,
        confirmed: 0,
        falsePositive: 0,
        uncertain: 0,
        evidenceAssessments: assessmentCounts(),
        legalBasisAssessments: assessmentCounts(),
        manualMissedFindings: 0,
        omissionEligibleSlotsWithMisses: 0,
        omissionEligibleCompletedSlots: 0,
      },
      calibrationRates: {
        slotCompletionRate: 0,
        findingConfirmationRate: null,
        falsePositiveRate: null,
        uncertainDecisionRate: null,
        evidenceSupportRate: null,
        legalBasisSupportRate: null,
        omissionCheckedSlotMissRate: null,
      },
    },
  });
  return assertDeveloperCalibrationDataset(value);
}

export function developerCalibrationSchema() {
  return structuredClone(schema);
}
