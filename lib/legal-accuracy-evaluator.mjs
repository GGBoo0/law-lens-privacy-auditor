import { createHash } from "node:crypto";

import {
  LEGAL_ACCURACY_DECISIONS,
  LEGAL_ACCURACY_FINDING_MAP,
  LEGAL_ACCURACY_MODES,
  LEGAL_ACCURACY_OMISSION_RULE_IDS,
  LEGAL_ACCURACY_RULE_BY_ID,
  validateCanonicalRuleIds,
} from "./legal-accuracy-taxonomy.mjs";
import {
  companyClusterBootstrapInterval,
  wilson95Interval,
} from "./legal-accuracy-statistics.mjs";
import { computeLegalReviewerFieldAgreement } from "./legal-reviewer-agreement.mjs";
import { assertLegalEvaluationDecision } from "./legal-evaluation-schema.mjs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^(?:sha256:)?([a-f\d]{64})$/i;

export class LegalAccuracyConfigurationError extends Error {
  constructor(errors) {
    super(`Invalid legal accuracy corpus:\n- ${errors.join("\n- ")}`);
    this.name = "LegalAccuracyConfigurationError";
    this.errors = errors;
  }
}

export function sha256Text(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizedHash(value) {
  if (typeof value !== "string") return null;
  return SHA256.exec(value)?.[1].toLowerCase() ?? null;
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length
    ? usable.reduce((sum, value) => sum + value, 0) / usable.length
    : null;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

export function computeBinaryMetrics({ tp = 0, fp = 0, fn = 0, tn = 0 }) {
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 =
    precision === null || recall === null
      ? tp + fn > 0 && tp === 0
        ? 0
        : null
      : precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : 0;
  return {
    tp,
    fp,
    fn,
    tn,
    positiveSupport: tp + fn,
    negativeSupport: tn + fp,
    precision,
    recall,
    f1,
  };
}

function normalizeDecision(value) {
  return LEGAL_ACCURACY_DECISIONS.includes(value) ? value : null;
}

function keyOf(caseId, mode, ruleId) {
  return `${caseId}\u0000${mode}\u0000${ruleId}`;
}

function annotationReviewerId(annotation) {
  return annotation.reviewerId ?? annotation.annotatorId ?? null;
}

function adjudicationReviewers(gold) {
  const adjudication = gold.adjudication ?? {};
  const reviewers =
    adjudication.reviewerIds ??
    adjudication.annotatorIds ??
    gold.reviewerIds ??
    gold.adjudicatedBy ??
    [];
  return Array.isArray(reviewers) ? [...new Set(reviewers.filter(Boolean))] : [];
}

function isAdjudicated(gold) {
  const status = gold.adjudication?.status ?? gold.status;
  const inputAnnotationIds = gold.adjudication?.inputAnnotationIds ?? [];
  return (
    (status === "adjudicated" || status === "final") &&
    adjudicationReviewers(gold).length >= 2 &&
    Array.isArray(inputAnnotationIds) &&
    new Set(inputAnnotationIds).size >= 2
  );
}

function hasMatchingIndependentAnnotations(gold, testCase, annotations) {
  const expectedReviewers = adjudicationReviewers(gold);
  const inputAnnotationIds = new Set(gold.adjudication?.inputAnnotationIds ?? []);
  const expectedDate = gold.legalAsOfDate ?? testCase?.legalAsOfDate;
  const expectedRuleset = gold.rulesetVersion ?? testCase?.rulesetVersion;
  const expectedDocumentHash = normalizedHash(
    gold.evaluationTextSha256 ?? testCase?.documentHash,
  );
  if (expectedReviewers.length < 2) return false;
  const matching = annotations.filter(
    (annotation) =>
      annotation.caseId === gold.caseId &&
      annotation.mode === gold.mode &&
      annotation.ruleId === gold.ruleId &&
      annotation.eligibleForMetrics !== false &&
      annotation.synthetic !== true &&
      inputAnnotationIds.has(annotation.annotationId) &&
      annotation.reviewMode?.independent === true &&
      annotation.reviewMode?.blindToSystemOutput === true &&
      annotation.reviewMode?.systemOutputViewed === false &&
      annotation.legalAsOfDate === expectedDate &&
      annotation.rulesetVersion === expectedRuleset &&
      normalizedHash(annotation.evaluationTextSha256) === expectedDocumentHash &&
      normalizeDecision(annotation.decision),
  );
  const actualReviewers = new Set(matching.map(annotationReviewerId));
  const actualAnnotationIds = new Set(matching.map((item) => item.annotationId));
  return (
    expectedReviewers.every((reviewerId) => actualReviewers.has(reviewerId)) &&
    [...inputAnnotationIds].every((id) => actualAnnotationIds.has(id))
  );
}

function isEligibleExpertGold(gold, testCase, annotations) {
  if (
    !isAdjudicated(gold) ||
    !hasMatchingIndependentAnnotations(gold, testCase, annotations)
  ) {
    return false;
  }
  if (
    gold.eligibleForMetrics === false ||
    gold.synthetic === true ||
    testCase?.eligibleForMetrics === false ||
    testCase?.synthetic === true
  ) {
    return false;
  }
  return true;
}

function isOmissionMetricExcluded(gold, testCase) {
  return (
    LEGAL_ACCURACY_OMISSION_RULE_IDS.has(gold.ruleId) &&
    (documentScope(testCase) !== "full_policy" ||
      testCase?.metricEligibility?.omissionRules === false)
  );
}

function isExpertMetricGold(gold, testCase, annotations) {
  if (!isEligibleExpertGold(gold, testCase, annotations)) return false;
  if (
    isOmissionMetricExcluded(gold, testCase)
  ) {
    return false;
  }
  return true;
}

function documentScope(testCase) {
  return testCase.documentScope ?? testCase.scope ?? "unknown";
}

function contextForCase(testCase) {
  return testCase.contexts ?? testCase.contextOverrides ?? {};
}

function normalizedMode(value) {
  return value === "policyOnly"
    ? "policy_only"
    : value === "contextAssisted"
      ? "context_assisted"
      : value;
}

function modesForCase(testCase, corpusModes) {
  const declared = testCase.modes ?? (testCase.track ? [testCase.track] : null);
  if (!declared) return corpusModes;
  return [...new Set(declared.map(normalizedMode))].filter((mode) =>
    corpusModes.includes(mode),
  );
}

function verifiedSpanEvidence(gold, testCase) {
  const evidence = gold.evidence ?? gold.expectedEvidence ?? [];
  return (Array.isArray(evidence) ? evidence : [evidence]).filter((entry) => {
    if (!entry || typeof entry !== "object" || entry.kind !== "span") return false;
    if (entry.support !== "direct") return false;
    if (!Number.isInteger(entry.start) || !Number.isInteger(entry.end)) return false;
    if (entry.start < 0 || entry.end <= entry.start) return false;
    const quote = testCase?.text?.slice(entry.start, entry.end);
    return normalizeComparableText(quote) === normalizeComparableText(entry.quote);
  });
}

function normalizeComparableText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceIsGrounded(evidence, documentText) {
  const normalizedEvidence = normalizeComparableText(evidence);
  if (!normalizedEvidence) return false;
  return normalizeComparableText(documentText).includes(normalizedEvidence);
}

function evidenceMatchesAnchors(evidence, anchors) {
  const normalizedEvidence = normalizeComparableText(evidence);
  if (!normalizedEvidence) return false;
  return anchors.some(
    (anchor) => normalizeComparableText(anchor) === normalizedEvidence,
  );
}

function predictionRequiresStrictEvidence(finding) {
  return finding?.findingType !== "possible_missing_disclosure";
}

function predictionHasDirectGrounding(finding, row) {
  if (!predictionRequiresStrictEvidence(finding)) return false;
  if (row.goldDecision !== "finding") return false;
  return (
    typeof finding?.evidence === "string" &&
    evidenceIsGrounded(finding.evidence, row.documentText) &&
    row.evidenceAnchors.length > 0 &&
    evidenceMatchesAnchors(finding.evidence, row.evidenceAnchors)
  );
}

function normalizedLegalBasisKey(value) {
  if (!value || typeof value !== "object") return null;
  if (value.fit === "incorrect") return null;
  const sourceId = String(value.sourceId ?? "").trim().toLowerCase();
  const article = normalizeComparableText(value.article);
  return sourceId && article ? `${sourceId}\u0000${article}` : null;
}

function legalBasisCountsForRow(row) {
  const predicted = new Set(
    row.predictions
      .flatMap((finding) => finding.legalBasis ?? [])
      .map(normalizedLegalBasisKey)
      .filter(Boolean),
  );
  const expected = new Set(
    (row.gold?.legalBases ?? [])
      .map(normalizedLegalBasisKey)
      .filter(Boolean),
  );
  let tp = 0;
  for (const key of predicted) if (expected.has(key)) tp += 1;
  return {
    tp,
    fp: predicted.size - tp,
    fn: expected.size - tp,
    tn: 0,
    exact: predicted.size === expected.size && tp === predicted.size,
    comparable: predicted.size > 0 || expected.size > 0,
  };
}

function expectedFindingIds(gold) {
  const value = gold.expectedFindingIds ?? gold.findingIds ?? [];
  return Array.isArray(value) ? value : [value];
}

function expectedFindingType(gold) {
  return gold.expectedFindingType ?? gold.findingType ?? null;
}

function expectedSeverity(gold) {
  return gold.expectedSeverity ?? gold.severity ?? null;
}

function expectedFactualVerification(gold) {
  return (
    gold.expectedRequiresFactualVerification ??
    gold.requiresFactualVerification ??
    null
  );
}

function isGoldHighStrictActionable(gold) {
  return (
    gold.decision === "finding" &&
    expectedSeverity(gold) === "high" &&
    !["confirmed_disclosure", "insufficient_evidence"].includes(
      expectedFindingType(gold),
    ) &&
    expectedFactualVerification(gold) === false
  );
}

function isPredictedHighStrictActionable(finding) {
  return (
    finding?.severity === "high" &&
    finding?.findingType !== "confirmed_disclosure" &&
    finding?.requiresFactualVerification === false &&
    finding?.legalJudgmentStatus !== "deferred_pending_legal_review"
  );
}

export function mapAnalysisFindings(findings) {
  const byRule = new Map();
  const unknown = [];
  for (const finding of findings ?? []) {
    const mapping = LEGAL_ACCURACY_FINDING_MAP.get(finding?.id);
    if (!mapping) {
      if (finding?.severity !== "na") unknown.push(finding?.id ?? "<missing-id>");
      continue;
    }
    const entry = byRule.get(mapping.ruleId) ?? {
      findings: [],
      noFindings: [],
    };
    (mapping.isFinding ? entry.findings : entry.noFindings).push(finding);
    byRule.set(mapping.ruleId, entry);
  }
  return { byRule, unknown };
}

/**
 * Cohen's kappa for two reviewers.  Items not labeled by both reviewers are
 * excluded.  A one-category sample is reported as not calculable instead of
 * being presented as perfect agreement.
 */
export function computeCohenKappa(items, reviewerA, reviewerB) {
  const reviewers = [
    ...new Set(items.map(annotationReviewerId).filter(Boolean)),
  ].sort();
  const left = reviewerA ?? reviewers[0];
  const right = reviewerB ?? reviewers[1];
  if (!left || !right || left === right) {
    return {
      status: "insufficient_reviewers",
      reviewerIds: [left, right].filter(Boolean),
      itemCount: 0,
      observedAgreement: null,
      expectedAgreement: null,
      kappa: null,
    };
  }

  const labelsByKey = new Map();
  for (const item of items) {
    const reviewerId = annotationReviewerId(item);
    if (reviewerId !== left && reviewerId !== right) continue;
    const decision = normalizeDecision(item.decision);
    if (!decision) continue;
    const itemKey = keyOf(item.caseId, item.mode, item.ruleId);
    const labels = labelsByKey.get(itemKey) ?? new Map();
    labels.set(reviewerId, decision);
    labelsByKey.set(itemKey, labels);
  }

  const pairs = [...labelsByKey.values()]
    .filter((labels) => labels.has(left) && labels.has(right))
    .map((labels) => [labels.get(left), labels.get(right)]);
  if (pairs.length < 2) {
    return {
      status: "insufficient_items",
      reviewerIds: [left, right],
      itemCount: pairs.length,
      observedAgreement: null,
      expectedAgreement: null,
      kappa: null,
    };
  }

  const categories = [...new Set(pairs.flat())];
  const agreementCount = pairs.filter(([a, b]) => a === b).length;
  const observedAgreement = agreementCount / pairs.length;
  const expectedAgreement = categories.reduce((sum, category) => {
    const leftRate = pairs.filter(([value]) => value === category).length / pairs.length;
    const rightRate =
      pairs.filter(([, value]) => value === category).length / pairs.length;
    return sum + leftRate * rightRate;
  }, 0);

  if (expectedAgreement === 1) {
    return {
      status: "not_calculable_single_category",
      reviewerIds: [left, right],
      itemCount: pairs.length,
      observedAgreement,
      expectedAgreement,
      kappa: null,
    };
  }
  return {
    status: "ok",
    reviewerIds: [left, right],
    itemCount: pairs.length,
    observedAgreement,
    expectedAgreement,
    kappa: (observedAgreement - expectedAgreement) / (1 - expectedAgreement),
  };
}

function agreementReport(annotations, modes) {
  const reviewers = [
    ...new Set(annotations.map(annotationReviewerId).filter(Boolean)),
  ].sort();
  const pairs = [];
  for (let left = 0; left < reviewers.length; left += 1) {
    for (let right = left + 1; right < reviewers.length; right += 1) {
      pairs.push(computeCohenKappa(annotations, reviewers[left], reviewers[right]));
    }
  }
  const usable = pairs.filter((pair) => pair.status === "ok");
  return {
    status: usable.length ? "ok" : "insufficient_support",
    reviewerCount: reviewers.length,
    reviewerIds: reviewers,
    pairwise: pairs,
    meanPairwiseKappa: average(usable.map((pair) => pair.kappa)),
    byMode: Object.fromEntries(
      modes.map((mode) => {
        const modeAnnotations = annotations.filter((item) => item.mode === mode);
        const modePairs = [];
        for (let left = 0; left < reviewers.length; left += 1) {
          for (let right = left + 1; right < reviewers.length; right += 1) {
            modePairs.push(
              computeCohenKappa(
                modeAnnotations,
                reviewers[left],
                reviewers[right],
              ),
            );
          }
        }
        const modeUsable = modePairs.filter((pair) => pair.status === "ok");
        return [
          mode,
          {
            status: modeUsable.length ? "ok" : "insufficient_support",
            meanPairwiseKappa: average(modeUsable.map((pair) => pair.kappa)),
            pairwise: modePairs,
          },
        ];
      }),
    ),
  };
}

function structuredDecisionOf(annotation) {
  if (
    annotation?.structuredDecision &&
    typeof annotation.structuredDecision === "object" &&
    !Array.isArray(annotation.structuredDecision)
  ) {
    return annotation.structuredDecision;
  }
  return annotation?.decision &&
    typeof annotation.decision === "object" &&
    !Array.isArray(annotation.decision)
    ? annotation.decision
    : null;
}

function reviewerPairSide(annotation) {
  if (!annotation) return null;
  return {
    reviewerId: annotationReviewerId(annotation),
    reviewMode: annotation.reviewMode,
    decision: structuredDecisionOf(annotation),
  };
}

function buildStructuredReviewerPairs(goldItems, annotations, caseById) {
  const annotationsByKey = new Map();
  for (const annotation of annotations) {
    const itemKey = keyOf(annotation.caseId, annotation.mode, annotation.ruleId);
    const items = annotationsByKey.get(itemKey) ?? [];
    items.push(annotation);
    annotationsByKey.set(itemKey, items);
  }

  return goldItems.map((gold) => {
    const itemKey = keyOf(gold.caseId, gold.mode, gold.ruleId);
    const expectedAnnotationIds = new Set(
      gold.adjudication?.inputAnnotationIds ?? [],
    );
    const matching = (annotationsByKey.get(itemKey) ?? [])
      .filter((annotation) => expectedAnnotationIds.has(annotation.annotationId))
      .sort((left, right) =>
        String(annotationReviewerId(left)).localeCompare(
          String(annotationReviewerId(right)),
        ),
      );
    const expectedReviewerIds = new Set(adjudicationReviewers(gold));
    const actualReviewerIds = new Set(matching.map(annotationReviewerId));
    const exactlyTwo =
      expectedAnnotationIds.size === 2 &&
      expectedReviewerIds.size === 2 &&
      matching.length === 2 &&
      actualReviewerIds.size === 2 &&
      [...expectedReviewerIds].every((reviewerId) =>
        actualReviewerIds.has(reviewerId),
      );
    const testCase = caseById.get(gold.caseId);
    return {
      caseId: gold.caseId,
      companyId: testCase?.companyId ?? null,
      ruleId: gold.ruleId,
      track: gold.mode,
      left: exactlyTwo ? reviewerPairSide(matching[0]) : null,
      right: exactlyTwo ? reviewerPairSide(matching[1]) : null,
    };
  });
}

function fieldAgreementForPairs(pairs) {
  return computeLegalReviewerFieldAgreement(pairs, {
    expectedPairCount: pairs.length,
  });
}

export function validateLegalAccuracyCorpus(corpus, options = {}) {
  const errors = [];
  const warnings = [];
  if (!corpus || typeof corpus !== "object" || Array.isArray(corpus)) {
    return { valid: false, errors: ["Corpus must be an object"], warnings };
  }
  if (corpus.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (typeof corpus.corpusVersion !== "string" || !corpus.corpusVersion) {
    errors.push("corpusVersion is required");
  }
  if (typeof corpus.evaluationId !== "string" || !corpus.evaluationId) {
    errors.push("evaluationId is required");
  }
  if (typeof corpus.rulesetVersion !== "string" || !corpus.rulesetVersion) {
    errors.push("rulesetVersion is required");
  }
  if (!ISO_DATE.test(corpus.legalAsOfDate ?? "")) {
    errors.push("legalAsOfDate must be an ISO calendar date");
  } else if (
    new Date(`${corpus.legalAsOfDate}T00:00:00.000Z`).toISOString().slice(0, 10) !==
    corpus.legalAsOfDate
  ) {
    errors.push("legalAsOfDate must be a real calendar date");
  }

  const modes = corpus.modes ?? LEGAL_ACCURACY_MODES;
  if (!Array.isArray(modes) || modes.length === 0) {
    errors.push("modes must be a non-empty array");
  } else {
    for (const mode of modes) {
      if (!LEGAL_ACCURACY_MODES.includes(mode)) errors.push(`Unknown mode: ${mode}`);
    }
  }
  const ruleIds = corpus.ruleIds ?? [];
  if (!Array.isArray(ruleIds) || ruleIds.length === 0) {
    errors.push("ruleIds must be a non-empty array");
  } else {
    errors.push(...validateCanonicalRuleIds(ruleIds));
  }
  if (!Array.isArray(corpus.cases) || corpus.cases.length === 0) {
    errors.push("cases must be a non-empty array");
  }
  if (!Array.isArray(corpus.gold)) errors.push("gold must be an array");
  if (corpus.annotations !== undefined && !Array.isArray(corpus.annotations)) {
    errors.push("annotations must be an array when present");
  }

  if (
    options.activeRulesetVersion &&
    corpus.rulesetVersion !== options.activeRulesetVersion
  ) {
    errors.push(
      `Corpus ruleset ${corpus.rulesetVersion} does not match active ruleset ${options.activeRulesetVersion}`,
    );
  }
  const expectedRuntimeHash = normalizedHash(
    corpus.runtimeManifestHash ?? corpus.runtimeManifestSha256,
  );
  const actualRuntimeHash = normalizedHash(options.runtimeManifestHash);
  if (!expectedRuntimeHash) {
    errors.push("runtimeManifestHash must be a SHA-256 digest");
  } else if (actualRuntimeHash && expectedRuntimeHash !== actualRuntimeHash) {
    errors.push("Runtime legal manifest hash does not match the corpus pin");
  } else if (!actualRuntimeHash) {
    warnings.push("Runtime legal manifest hash was not supplied for verification");
  }

  const caseById = new Map();
  for (const testCase of corpus.cases ?? []) {
    if (typeof testCase?.id !== "string" || !testCase.id) {
      errors.push("Every case requires a non-empty id");
      continue;
    }
    if (caseById.has(testCase.id)) errors.push(`Duplicate case id: ${testCase.id}`);
    caseById.set(testCase.id, testCase);
    if (testCase.legalAsOfDate !== corpus.legalAsOfDate) {
      errors.push(
        `${testCase.id}: legalAsOfDate must match corpus pin ${corpus.legalAsOfDate}`,
      );
    }
    if (testCase.rulesetVersion !== corpus.rulesetVersion) {
      errors.push(
        `${testCase.id}: rulesetVersion must match corpus pin ${corpus.rulesetVersion}`,
      );
    }
    if (typeof testCase.text !== "string" || testCase.text.length < 120) {
      errors.push(`${testCase.id}: text must contain at least 120 characters`);
      continue;
    }
    const expectedHash = normalizedHash(testCase.documentHash);
    if (!expectedHash) {
      errors.push(`${testCase.id}: documentHash must be a SHA-256 digest`);
    } else if (sha256Text(testCase.text) !== expectedHash) {
      errors.push(`${testCase.id}: documentHash does not match text`);
    }
  }

  const goldKeys = new Set();
  for (const gold of corpus.gold ?? []) {
    const itemKey = keyOf(gold?.caseId, gold?.mode, gold?.ruleId);
    if (goldKeys.has(itemKey)) errors.push(`Duplicate gold item: ${itemKey}`);
    goldKeys.add(itemKey);
    const testCase = caseById.get(gold?.caseId);
    if (!testCase) errors.push(`Gold references unknown case: ${gold?.caseId}`);
    if (gold?.evaluationId !== corpus.evaluationId) {
      errors.push(`${itemKey}: gold evaluationId does not match the corpus`);
    }
    if (gold?.corpusVersion !== corpus.corpusVersion) {
      errors.push(`${itemKey}: gold corpusVersion does not match the corpus`);
    }
    if (
      normalizedHash(gold?.evaluationTextSha256) !==
      normalizedHash(testCase?.documentHash)
    ) {
      errors.push(`${itemKey}: gold evaluationTextSha256 does not match the case`);
    }
    if (
      normalizedHash(gold?.runtimeManifestHash) !==
      normalizedHash(corpus.runtimeManifestHash)
    ) {
      errors.push(`${itemKey}: gold runtimeManifestHash does not match the corpus`);
    }
    const goldLegalAsOfDate = gold?.legalAsOfDate ?? testCase?.legalAsOfDate;
    const goldRulesetVersion = gold?.rulesetVersion ?? testCase?.rulesetVersion;
    if (goldLegalAsOfDate !== corpus.legalAsOfDate) {
      errors.push(`${itemKey}: gold legalAsOfDate does not match the corpus pin`);
    }
    if (goldRulesetVersion !== corpus.rulesetVersion) {
      errors.push(`${itemKey}: gold rulesetVersion does not match the corpus pin`);
    }
    if (!modes.includes(gold?.mode)) errors.push(`Gold has unknown mode: ${gold?.mode}`);
    if (!LEGAL_ACCURACY_RULE_BY_ID.has(gold?.ruleId)) {
      errors.push(`Gold has unknown rule id: ${gold?.ruleId}`);
    }
    if (!normalizeDecision(gold?.decision)) {
      errors.push(`Gold has invalid decision for ${itemKey}`);
    }
    const expectedIds = expectedFindingIds(gold);
    for (const findingId of expectedIds) {
      const mapping = LEGAL_ACCURACY_FINDING_MAP.get(findingId);
      if (!mapping || !mapping.isFinding || mapping.ruleId !== gold.ruleId) {
        errors.push(`${itemKey}: expected finding id is not mapped to this rule: ${findingId}`);
      }
    }
    const missingDisclosure =
      expectedFindingType(gold) === "possible_missing_disclosure" ||
      expectedIds.some((id) => /(?:^|-)missing(?:-|$)/.test(id));
    if (
      testCase &&
      gold.decision === "finding" &&
      missingDisclosure &&
      documentScope(testCase) !== "full_policy"
    ) {
      warnings.push(`${itemKey}: partial-document omission label is excluded`);
    }
  }

  for (const annotation of corpus.annotations ?? []) {
    const itemKey = keyOf(
      annotation?.caseId,
      annotation?.mode,
      annotation?.ruleId,
    );
    if (annotation?.legalAsOfDate !== corpus.legalAsOfDate) {
      errors.push(`${itemKey}: annotation legalAsOfDate does not match the corpus pin`);
    }
    if (annotation?.rulesetVersion !== corpus.rulesetVersion) {
      errors.push(`${itemKey}: annotation rulesetVersion does not match the corpus pin`);
    }
    const testCase = caseById.get(annotation?.caseId);
    if (annotation?.evaluationId !== corpus.evaluationId) {
      errors.push(`${itemKey}: annotation evaluationId does not match the corpus`);
    }
    if (annotation?.corpusVersion !== corpus.corpusVersion) {
      errors.push(`${itemKey}: annotation corpusVersion does not match the corpus`);
    }
    if (
      normalizedHash(annotation?.evaluationTextSha256) !==
      normalizedHash(testCase?.documentHash)
    ) {
      errors.push(`${itemKey}: annotation evaluationTextSha256 does not match the case`);
    }
    if (
      normalizedHash(annotation?.runtimeManifestHash) !==
      normalizedHash(corpus.runtimeManifestHash)
    ) {
      errors.push(`${itemKey}: annotation runtimeManifestHash does not match the corpus`);
    }
    const structuredDecision = Object.hasOwn(
      annotation ?? {},
      "structuredDecision",
    )
      ? annotation.structuredDecision
      : structuredDecisionOf(annotation);
    if (structuredDecision !== null && structuredDecision !== undefined) {
      try {
        assertLegalEvaluationDecision(
          structuredDecision,
          `${itemKey} structured annotation decision`,
        );
      } catch (error) {
        errors.push(
          error instanceof Error
            ? error.message
            : `${itemKey}: structured annotation decision is invalid`,
        );
      }
    }
  }

  const requiredKeys = [];
  for (const testCase of corpus.cases ?? []) {
    for (const mode of modesForCase(testCase, modes)) {
      for (const ruleId of ruleIds) requiredKeys.push(keyOf(testCase.id, mode, ruleId));
    }
  }
  const missingGoldKeys = requiredKeys.filter((itemKey) => !goldKeys.has(itemKey));
  if (missingGoldKeys.length > 0) {
    const message = `${missingGoldKeys.length} case × mode × rule gold labels are missing`;
    if ((corpus.gate?.mode ?? "calibration") === "enforced") errors.push(message);
    else warnings.push(message);
  }

  if (
    (corpus.gate?.mode ?? "calibration") === "enforced" &&
    corpus.datasetKind === "synthetic"
  ) {
    errors.push("Synthetic self-test data cannot enforce an expert accuracy gate");
  }
  return { valid: errors.length === 0, errors, warnings, missingGoldKeys };
}

function metricsForRows(rows, supportPolicy) {
  const counts = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const row of rows) {
    if (row.goldDecision === "finding") {
      counts[row.predictedPositive ? "tp" : "fn"] += 1;
    } else if (row.goldDecision === "no_finding") {
      counts[row.predictedPositive ? "fp" : "tn"] += 1;
    }
  }
  const metrics = computeBinaryMetrics(counts);
  const sufficient =
    metrics.positiveSupport >= supportPolicy.minPositivePerRule &&
    metrics.negativeSupport >= supportPolicy.minNegativePerRule &&
    metrics.tp + metrics.fp >= supportPolicy.minPredictedPositivePerRule;
  return {
    ...metrics,
    predictedPositiveSupport: metrics.tp + metrics.fp,
    supportStatus: sufficient ? "sufficient" : "insufficient_support",
  };
}

function buildMetricReport(rows, ruleIds, modes, supportPolicy) {
  const scored = rows.filter((row) =>
    ["finding", "no_finding"].includes(row.goldDecision),
  );
  const perRule = Object.fromEntries(
    ruleIds.map((ruleId) => [
      ruleId,
      metricsForRows(
        scored.filter((row) => row.ruleId === ruleId),
        supportPolicy,
      ),
    ]),
  );
  const eligibleRules = Object.entries(perRule)
    .filter(([, metrics]) => metrics.supportStatus === "sufficient")
    .map(([ruleId]) => ruleId);
  const macro = {
    eligibleRuleCount: eligibleRules.length,
    insufficientRuleIds: ruleIds.filter((ruleId) => !eligibleRules.includes(ruleId)),
    precision: average(eligibleRules.map((ruleId) => perRule[ruleId].precision)),
    recall: average(eligibleRules.map((ruleId) => perRule[ruleId].recall)),
    f1: average(eligibleRules.map((ruleId) => perRule[ruleId].f1)),
  };
  const byMode = Object.fromEntries(
    modes.map((mode) => {
      const modeRows = scored.filter((row) => row.mode === mode);
      const modePerRule = Object.fromEntries(
        ruleIds.map((ruleId) => [
          ruleId,
          metricsForRows(
            modeRows.filter((row) => row.ruleId === ruleId),
            supportPolicy,
          ),
        ]),
      );
      const modeEligible = Object.entries(modePerRule)
        .filter(([, metrics]) => metrics.supportStatus === "sufficient")
        .map(([ruleId]) => ruleId);
      return [
        mode,
        {
          micro: metricsForRows(modeRows, {
            minPositivePerRule: 0,
            minNegativePerRule: 0,
            minPredictedPositivePerRule: 0,
          }),
          macro: {
            eligibleRuleCount: modeEligible.length,
            insufficientRuleIds: ruleIds.filter(
              (ruleId) => !modeEligible.includes(ruleId),
            ),
            precision: average(
              modeEligible.map((ruleId) => modePerRule[ruleId].precision),
            ),
            recall: average(modeEligible.map((ruleId) => modePerRule[ruleId].recall)),
            f1: average(modeEligible.map((ruleId) => modePerRule[ruleId].f1)),
          },
          perRule: modePerRule,
        },
      ];
    }),
  );
  return {
    scoredItemCount: scored.length,
    skippedItemCount: rows.length - scored.length,
    micro: metricsForRows(scored, {
      minPositivePerRule: 0,
      minNegativePerRule: 0,
      minPredictedPositivePerRule: 0,
    }),
    macro,
    perRule,
    byMode,
  };
}

function buildSpecialReport(rows, unsafeGuardrailRows = []) {
  const possibleMissingCounts = { tp: 0, fp: 0, fn: 0, tn: 0 };
  const strictCounts = { tp: 0, fp: 0, fn: 0, tn: 0 };
  const legalBasisCounts = { tp: 0, fp: 0, fn: 0, tn: 0 };
  let legalBasisComparableRowCount = 0;
  let legalBasisExactRowCount = 0;
  let unsafeHighEligibleCount = 0;
  let unsafeHighEscalationCount = 0;
  let highOverstatementEligibleCount = 0;
  let highOverstatementCount = 0;
  let partialOmissionEligibleCount = 0;
  let partialUnsupportedOmissionCount = 0;
  let partialUnsafeHighCount = 0;
  let documentEvidenceCount = 0;
  let groundedEvidenceCount = 0;
  let anchoredTruePositiveCount = 0;
  let anchorHitCount = 0;
  let strictEvidencePredictionCount = 0;
  let strictEvidenceGroundedCount = 0;
  let exactVariantTruePositiveCount = 0;
  let allTruePositiveCount = 0;
  for (const row of rows) {
    const possibleMissing = row.predictions.some(
      (finding) => finding.findingType === "possible_missing_disclosure",
    );
    const possibleMissingGold =
      row.goldDecision === "finding" &&
      expectedFindingType(row.gold) === "possible_missing_disclosure";
    if (row.documentScope === "full_policy") {
      possibleMissingCounts[
        possibleMissingGold
          ? possibleMissing
            ? "tp"
            : "fn"
          : possibleMissing
            ? "fp"
            : "tn"
      ] += 1;
    }

    const strictPrediction = row.predictions.some(isPredictedHighStrictActionable);
    const strictGold = isGoldHighStrictActionable(row.gold);
    strictCounts[
      strictGold
        ? strictPrediction
          ? "tp"
          : "fn"
        : strictPrediction
          ? "fp"
          : "tn"
    ] += 1;
    if (row.goldDecision === "finding" && !strictGold) {
      highOverstatementEligibleCount += 1;
      if (strictPrediction) highOverstatementCount += 1;
    }

    const legalBasis = legalBasisCountsForRow(row);
    addCounts(legalBasisCounts, legalBasis);
    if (legalBasis.comparable) {
      legalBasisComparableRowCount += 1;
      if (legalBasis.exact) legalBasisExactRowCount += 1;
    }

    for (const finding of row.predictions) {
      if (predictionRequiresStrictEvidence(finding)) {
        strictEvidencePredictionCount += 1;
        if (predictionHasDirectGrounding(finding, row)) {
          strictEvidenceGroundedCount += 1;
        }
      }
      if (typeof finding.evidence !== "string" || !finding.evidence.trim()) continue;
      documentEvidenceCount += 1;
      if (evidenceIsGrounded(finding.evidence, row.documentText)) {
        groundedEvidenceCount += 1;
      }
    }
    if (
      row.goldDecision === "finding" &&
      row.predictedPositive &&
      row.expectedFindingIds.length > 0
    ) {
      allTruePositiveCount += 1;
      if (row.variantMatches) exactVariantTruePositiveCount += 1;
      if (row.evidenceAnchors.length > 0) {
        anchoredTruePositiveCount += 1;
        if (
          row.predictions.some((finding) =>
            evidenceMatchesAnchors(finding.evidence, row.evidenceAnchors),
          )
        ) {
          anchorHitCount += 1;
        }
      }
    }
  }
  for (const row of unsafeGuardrailRows) {
    partialOmissionEligibleCount += 1;
    const predictions = row.rawPredictions ?? row.predictions;
    if (
      predictions.some(
        (finding) => finding.findingType === "possible_missing_disclosure",
      )
    ) {
      partialUnsupportedOmissionCount += 1;
    }
    if (predictions.some(isPredictedHighStrictActionable)) {
      partialUnsafeHighCount += 1;
    }
  }
  for (const row of [...rows, ...unsafeGuardrailRows]) {
    if (!["no_finding", "not_applicable", "uncertain"].includes(row.goldDecision)) {
      continue;
    }
    unsafeHighEligibleCount += 1;
    const predictions = row.rawPredictions ?? row.predictions;
    if (
      predictions.some(
        (finding) =>
          finding.severity === "high" &&
          finding.legalJudgmentStatus !== "deferred_pending_legal_review",
      )
    ) {
      unsafeHighEscalationCount += 1;
    }
  }
  return {
    special: {
      possibleMissing: computeBinaryMetrics(possibleMissingCounts),
      highStrictActionable: computeBinaryMetrics(strictCounts),
      legalBasis: {
        ...computeBinaryMetrics(legalBasisCounts),
        comparableRowCount: legalBasisComparableRowCount,
        exactRowCount: legalBasisExactRowCount,
        exactRowRate: ratio(legalBasisExactRowCount, legalBasisComparableRowCount),
      },
      unsafeHighEscalation: {
        count: unsafeHighEscalationCount,
        support: unsafeHighEligibleCount,
        rate: ratio(unsafeHighEscalationCount, unsafeHighEligibleCount),
      },
      highOverstatement: {
        count: highOverstatementCount,
        support: highOverstatementEligibleCount,
        rate: ratio(highOverstatementCount, highOverstatementEligibleCount),
      },
      partialUnsupportedOmission: {
        count: partialUnsupportedOmissionCount,
        support: partialOmissionEligibleCount,
        rate: ratio(partialUnsupportedOmissionCount, partialOmissionEligibleCount),
      },
      partialUnsafeHigh: {
        count: partialUnsafeHighCount,
        support: partialOmissionEligibleCount,
        rate: ratio(partialUnsafeHighCount, partialOmissionEligibleCount),
      },
      findingVariantAccuracy: ratio(
        exactVariantTruePositiveCount,
        allTruePositiveCount,
      ),
    },
    evidence: {
      documentEvidenceCount,
      groundedEvidenceCount,
      documentGroundingRate: ratio(
        groundedEvidenceCount,
        documentEvidenceCount,
      ),
      anchoredTruePositiveCount,
      anchorHitCount,
      goldEvidenceHitRate: ratio(anchorHitCount, anchoredTruePositiveCount),
      strictEvidencePredictionCount,
      strictEvidenceGroundedCount,
      strictEvidenceGroundingRate: ratio(
        strictEvidenceGroundedCount,
        strictEvidencePredictionCount,
      ),
    },
  };
}

function binaryCountsForRow(row) {
  if (row.goldDecision === "finding") {
    return row.predictedPositive
      ? { tp: 1, fp: 0, fn: 0, tn: 0 }
      : { tp: 0, fp: 0, fn: 1, tn: 0 };
  }
  if (row.goldDecision === "no_finding") {
    return row.predictedPositive
      ? { tp: 0, fp: 1, fn: 0, tn: 0 }
      : { tp: 0, fp: 0, fn: 0, tn: 1 };
  }
  return { tp: 0, fp: 0, fn: 0, tn: 0 };
}

function addCounts(target, source) {
  for (const key of ["tp", "fp", "fn", "tn"]) target[key] += source[key] ?? 0;
}

function emptyCounts() {
  return { tp: 0, fp: 0, fn: 0, tn: 0 };
}

function companySummaryRows(rows, unsafeGuardrailRows, ruleIds) {
  const summaries = new Map();
  const ensure = (companyId) => {
    if (typeof companyId !== "string" || !companyId.trim()) return null;
    const normalized = companyId.trim();
    const existing = summaries.get(normalized);
    if (existing) return existing;
    const created = {
      companyId: normalized,
      perRule: Object.fromEntries(ruleIds.map((ruleId) => [ruleId, emptyCounts()])),
      possibleMissing: emptyCounts(),
      highStrictActionable: emptyCounts(),
      legalBasis: emptyCounts(),
      strictEvidence: { successes: 0, total: 0 },
      unsafeHigh: { successes: 0, total: 0 },
      highOverstatement: { successes: 0, total: 0 },
      partialUnsupportedOmission: { successes: 0, total: 0 },
      partialUnsafeHigh: { successes: 0, total: 0 },
    };
    summaries.set(normalized, created);
    return created;
  };

  for (const row of rows) {
    const summary = ensure(row.companyId);
    if (!summary) continue;
    if (["finding", "no_finding"].includes(row.goldDecision)) {
      addCounts(summary.perRule[row.ruleId], binaryCountsForRow(row));
    }
    const possibleMissing = row.predictions.some(
      (finding) => finding.findingType === "possible_missing_disclosure",
    );
    const possibleMissingGold =
      row.goldDecision === "finding" &&
      expectedFindingType(row.gold) === "possible_missing_disclosure";
    if (row.documentScope === "full_policy") {
      addCounts(summary.possibleMissing, {
        tp: possibleMissingGold && possibleMissing ? 1 : 0,
        fp: !possibleMissingGold && possibleMissing ? 1 : 0,
        fn: possibleMissingGold && !possibleMissing ? 1 : 0,
        tn: !possibleMissingGold && !possibleMissing ? 1 : 0,
      });
    }

    const strictPrediction = row.predictions.some(isPredictedHighStrictActionable);
    const strictGold = isGoldHighStrictActionable(row.gold);
    addCounts(summary.highStrictActionable, {
      tp: strictGold && strictPrediction ? 1 : 0,
      fp: !strictGold && strictPrediction ? 1 : 0,
      fn: strictGold && !strictPrediction ? 1 : 0,
      tn: !strictGold && !strictPrediction ? 1 : 0,
    });
    if (row.goldDecision === "finding" && !strictGold) {
      summary.highOverstatement.total += 1;
      if (strictPrediction) summary.highOverstatement.successes += 1;
    }
    addCounts(summary.legalBasis, legalBasisCountsForRow(row));

    for (const finding of row.predictions) {
      if (!predictionRequiresStrictEvidence(finding)) continue;
      summary.strictEvidence.total += 1;
      if (predictionHasDirectGrounding(finding, row)) {
        summary.strictEvidence.successes += 1;
      }
    }
  }

  for (const row of unsafeGuardrailRows) {
    const summary = ensure(row.companyId);
    if (!summary) continue;
    const predictions = row.rawPredictions ?? row.predictions;
    summary.partialUnsupportedOmission.total += 1;
    summary.partialUnsafeHigh.total += 1;
    if (
      predictions.some(
        (finding) => finding.findingType === "possible_missing_disclosure",
      )
    ) {
      summary.partialUnsupportedOmission.successes += 1;
    }
    if (predictions.some(isPredictedHighStrictActionable)) {
      summary.partialUnsafeHigh.successes += 1;
    }
  }

  for (const row of [...rows, ...unsafeGuardrailRows]) {
    if (!['no_finding', 'not_applicable', 'uncertain'].includes(row.goldDecision)) {
      continue;
    }
    const summary = ensure(row.companyId);
    if (!summary) continue;
    summary.unsafeHigh.total += 1;
    const predictions = row.rawPredictions ?? row.predictions;
    if (
      predictions.some(
        (finding) =>
          finding.severity === "high" &&
          finding.legalJudgmentStatus !== "deferred_pending_legal_review",
      )
    ) {
      summary.unsafeHigh.successes += 1;
    }
  }
  return [...summaries.values()];
}

function sumSummaryCounts(summaries, selector) {
  const result = emptyCounts();
  for (const summary of summaries) addCounts(result, selector(summary));
  return result;
}

function sumSummaryProportion(summaries, selector) {
  return summaries.reduce(
    (result, summary) => {
      const value = selector(summary);
      result.successes += value.successes;
      result.total += value.total;
      return result;
    },
    { successes: 0, total: 0 },
  );
}

function contributingCompanyCount(summaries, selector) {
  return summaries.filter((summary) => selector(summary) > 0).length;
}

function metricSupportReport(rows, unsafeGuardrailRows, summaries, ruleIds) {
  const perRule = Object.fromEntries(
    ruleIds.map((ruleId) => {
      const counts = sumSummaryCounts(
        summaries,
        (summary) => summary.perRule[ruleId],
      );
      return [
        ruleId,
        {
          goldPositiveRows: counts.tp + counts.fn,
          predictedPositiveRows: counts.tp + counts.fp,
          goldNegativeRows: counts.tn + counts.fp,
          goldPositiveCompanies: contributingCompanyCount(
            summaries,
            (summary) =>
              summary.perRule[ruleId].tp + summary.perRule[ruleId].fn,
          ),
          predictedPositiveCompanies: contributingCompanyCount(
            summaries,
            (summary) =>
              summary.perRule[ruleId].tp + summary.perRule[ruleId].fp,
          ),
          goldNegativeCompanies: contributingCompanyCount(
            summaries,
            (summary) =>
              summary.perRule[ruleId].tn + summary.perRule[ruleId].fp,
          ),
        },
      ];
    }),
  );
  const proportionSupport = (selector) => {
    const totals = sumSummaryProportion(summaries, selector);
    return {
      denominator: totals.total,
      contributingCompanyCount: contributingCompanyCount(
        summaries,
        (summary) => selector(summary).total,
      ),
    };
  };
  const binarySupport = (selector, denominator) => {
    const totals = sumSummaryCounts(summaries, selector);
    const value = (counts) =>
      denominator === "predicted"
        ? counts.tp + counts.fp
        : counts.tp + counts.fn;
    return {
      denominator: value(totals),
      contributingCompanyCount: contributingCompanyCount(
        summaries,
        (summary) => value(selector(summary)),
      ),
    };
  };
  return {
    caseCount: new Set(
      [...rows, ...unsafeGuardrailRows].map((row) => row.caseId),
    ).size,
    companyCount: summaries.length,
    perRule,
    possibleMissingPrecision: binarySupport(
      (summary) => summary.possibleMissing,
      "predicted",
    ),
    highStrictActionableRecall: binarySupport(
      (summary) => summary.highStrictActionable,
      "gold",
    ),
    legalBasisPrecision: binarySupport(
      (summary) => summary.legalBasis,
      "predicted",
    ),
    legalBasisRecall: binarySupport(
      (summary) => summary.legalBasis,
      "gold",
    ),
    strictEvidenceGroundingRate: proportionSupport(
      (summary) => summary.strictEvidence,
    ),
    unsafeHighEscalationRate: proportionSupport(
      (summary) => summary.unsafeHigh,
    ),
    highOverstatementRate: proportionSupport(
      (summary) => summary.highOverstatement,
    ),
    partialUnsupportedOmissionRate: proportionSupport(
      (summary) => summary.partialUnsupportedOmission,
    ),
    partialUnsafeHighRate: proportionSupport(
      (summary) => summary.partialUnsafeHigh,
    ),
  };
}

function bootstrapNotRun(estimate, reason = "calibration_mode") {
  return {
    status: "not_run",
    reason,
    estimate: Number.isFinite(estimate) ? estimate : null,
    lower: null,
    upper: null,
    method: "company_cluster_percentile_bootstrap",
    confidenceLevel: 0.95,
  };
}

function bootstrapSettings(corpus, scope, metricName) {
  const configured =
    corpus.metrics?.confidenceIntervals?.companyClusterBootstrap ?? {};
  const replicates = configured.replicates ?? 10_000;
  const minimumValidFraction =
    configured.minimumValidReplicateFraction ?? 0.99;
  return {
    confidenceLevel:
      corpus.metrics?.confidenceIntervals?.confidenceLevel ?? 0.95,
    replicates,
    minimumClusters: configured.minimumClusters ?? 30,
    minimumReplicates: Math.ceil(replicates * minimumValidFraction),
    minimumValidFraction,
    seed: `${configured.seed ?? "law-lens-legal-accuracy-v1"}:${corpus.evaluationId}:${scope}:${metricName}`,
  };
}

function clusterBootstrap(corpus, summaries, scope, metricName, metric) {
  const estimate = metric(summaries);
  if ((corpus.gate?.mode ?? "calibration") !== "enforced") {
    return bootstrapNotRun(estimate);
  }
  const isLockedCertificationScope =
    scope === "lockedTest" ||
    scope.startsWith("lockedTest:") ||
    scope === "reviewer:lockedTest" ||
    scope.startsWith("reviewer:lockedTest:");
  if (!isLockedCertificationScope) {
    return bootstrapNotRun(estimate, "not_locked_test_scope");
  }
  if (
    summaries.some(
      (summary) =>
        typeof summary.companyId !== "string" || !summary.companyId.trim(),
    )
  ) {
    return bootstrapNotRun(estimate, "missing_company_id");
  }
  return companyClusterBootstrapInterval(
    summaries,
    (sample) => metric(sample),
    bootstrapSettings(corpus, scope, metricName),
  );
}

function macroF1ForSummaries(summaries, ruleIds, supportPolicy) {
  const values = [];
  for (const ruleId of ruleIds) {
    const metrics = computeBinaryMetrics(
      sumSummaryCounts(summaries, (summary) => summary.perRule[ruleId]),
    );
    const supportIsSufficient =
      metrics.positiveSupport >= supportPolicy.minPositivePerRule &&
      metrics.negativeSupport >= supportPolicy.minNegativePerRule &&
      metrics.tp + metrics.fp >= supportPolicy.minPredictedPositivePerRule;
    if (!supportIsSufficient || !Number.isFinite(metrics.f1)) return null;
    values.push(metrics.f1);
  }
  return average(values);
}

function confidenceIntervalReport(
  corpus,
  rows,
  unsafeGuardrailRows,
  ruleIds,
  supportPolicy,
  scope,
) {
  const summaries = companySummaryRows(rows, unsafeGuardrailRows, ruleIds);
  const special = buildSpecialReport(rows, unsafeGuardrailRows);
  const possibleMissing = special.special.possibleMissing;
  const highStrict = special.special.highStrictActionable;
  const legalBasis = special.special.legalBasis;
  const strictEvidence = special.evidence;
  const unsafeHigh = special.special.unsafeHighEscalation;
  const highOverstatement = special.special.highOverstatement;
  const partialUnsupported = special.special.partialUnsupportedOmission;
  const partialUnsafeHigh = special.special.partialUnsafeHigh;
  const proportionMetric = (selector) => (sample) => {
    const counts = sumSummaryProportion(sample, selector);
    return ratio(counts.successes, counts.total);
  };
  const binaryMetric = (selector, metricName) => (sample) => {
    const counts = sumSummaryCounts(sample, selector);
    return computeBinaryMetrics(counts)[metricName];
  };
  return {
    status:
      (corpus.gate?.mode ?? "calibration") === "enforced"
        ? "computed_or_fail_closed"
        : "diagnostic_only",
    scope,
    companyCount: summaries.length,
    support: metricSupportReport(
      rows,
      unsafeGuardrailRows,
      summaries,
      ruleIds,
    ),
    macroF1: clusterBootstrap(
      corpus,
      summaries,
      scope,
      "macro_f1",
      (sample) => macroF1ForSummaries(sample, ruleIds, supportPolicy),
    ),
    possibleMissingPrecision: {
      wilson: wilson95Interval(
        possibleMissing.tp,
        possibleMissing.tp + possibleMissing.fp,
      ),
      companyClusterBootstrap: clusterBootstrap(
        corpus,
        summaries,
        scope,
        "possible_missing_precision",
        binaryMetric((summary) => summary.possibleMissing, "precision"),
      ),
    },
    highStrictActionableRecall: {
      wilson: wilson95Interval(
        highStrict.tp,
        highStrict.tp + highStrict.fn,
      ),
      companyClusterBootstrap: clusterBootstrap(
        corpus,
        summaries,
        scope,
        "high_strict_actionable_recall",
        binaryMetric((summary) => summary.highStrictActionable, "recall"),
      ),
    },
    legalBasisPrecision: {
      wilson: wilson95Interval(
        legalBasis.tp,
        legalBasis.tp + legalBasis.fp,
      ),
      companyClusterBootstrap: clusterBootstrap(
        corpus,
        summaries,
        scope,
        "legal_basis_precision",
        binaryMetric((summary) => summary.legalBasis, "precision"),
      ),
    },
    legalBasisRecall: {
      wilson: wilson95Interval(
        legalBasis.tp,
        legalBasis.tp + legalBasis.fn,
      ),
      companyClusterBootstrap: clusterBootstrap(
        corpus,
        summaries,
        scope,
        "legal_basis_recall",
        binaryMetric((summary) => summary.legalBasis, "recall"),
      ),
    },
    strictEvidenceGroundingRate: {
      wilson: wilson95Interval(
        strictEvidence.strictEvidenceGroundedCount,
        strictEvidence.strictEvidencePredictionCount,
      ),
      companyClusterBootstrap: clusterBootstrap(
        corpus,
        summaries,
        scope,
        "strict_evidence_grounding_rate",
        proportionMetric((summary) => summary.strictEvidence),
      ),
    },
    unsafeHighEscalationRate: {
      observedCount: unsafeHigh.count,
      wilson: wilson95Interval(unsafeHigh.count, unsafeHigh.support),
      companyClusterBootstrap: clusterBootstrap(
        corpus,
        summaries,
        scope,
        "unsafe_high_escalation_rate",
        proportionMetric((summary) => summary.unsafeHigh),
      ),
    },
    highOverstatementRate: {
      wilson: wilson95Interval(
        highOverstatement.count,
        highOverstatement.support,
      ),
      companyClusterBootstrap: clusterBootstrap(
        corpus,
        summaries,
        scope,
        "high_overstatement_rate",
        proportionMetric((summary) => summary.highOverstatement),
      ),
    },
    partialUnsupportedOmissionRate: {
      wilson: wilson95Interval(
        partialUnsupported.count,
        partialUnsupported.support,
      ),
      companyClusterBootstrap: clusterBootstrap(
        corpus,
        summaries,
        scope,
        "partial_unsupported_omission_rate",
        proportionMetric((summary) => summary.partialUnsupportedOmission),
      ),
    },
    partialUnsafeHighRate: {
      wilson: wilson95Interval(
        partialUnsafeHigh.count,
        partialUnsafeHigh.support,
      ),
      companyClusterBootstrap: clusterBootstrap(
        corpus,
        summaries,
        scope,
        "partial_unsafe_high_rate",
        proportionMetric((summary) => summary.partialUnsafeHigh),
      ),
    },
  };
}

const FIELD_NOMINAL_CATEGORIES = Object.freeze({
  applicability: ["applicable", "notApplicable", "unknown"],
  operationalOutcome: [
    "applicable:confirmed_disclosure",
    "applicable:possible_missing_disclosure",
    "applicable:ambiguity_or_inconsistency",
    "applicable:factual_verification",
    "applicable:insufficient_evidence",
    "notApplicable",
    "unknown",
  ],
  goldLabel: [
    "confirmed_disclosure",
    "possible_missing_disclosure",
    "ambiguity_or_inconsistency",
    "factual_verification",
    "insufficient_evidence",
  ],
  requiresFactualVerification: ["true", "false"],
  severity: ["pass", "low", "medium", "high"],
});

function fieldCategoryPair(pair, metricName) {
  const left = pair?.left?.decision;
  const right = pair?.right?.decision;
  if (!left || !right) return null;
  if (metricName === "applicability") {
    return FIELD_NOMINAL_CATEGORIES.applicability.includes(left.applicability) &&
      FIELD_NOMINAL_CATEGORIES.applicability.includes(right.applicability)
      ? [left.applicability, right.applicability]
      : null;
  }
  if (metricName === "operationalOutcome") {
    const outcome = (decision) =>
      decision.applicability === "applicable"
        ? `applicable:${decision.goldLabel}`
        : decision.applicability;
    const values = [outcome(left), outcome(right)];
    return values.every((value) =>
      FIELD_NOMINAL_CATEGORIES.operationalOutcome.includes(value),
    )
      ? values
      : null;
  }
  if (left.applicability !== "applicable" || right.applicability !== "applicable") {
    return null;
  }
  if (metricName === "goldLabel") {
    return FIELD_NOMINAL_CATEGORIES.goldLabel.includes(left.goldLabel) &&
      FIELD_NOMINAL_CATEGORIES.goldLabel.includes(right.goldLabel)
      ? [left.goldLabel, right.goldLabel]
      : null;
  }
  if (metricName === "requiresFactualVerification") {
    return typeof left.requiresFactualVerification === "boolean" &&
      typeof right.requiresFactualVerification === "boolean"
      ? [String(left.requiresFactualVerification), String(right.requiresFactualVerification)]
      : null;
  }
  if (metricName === "severity") {
    return FIELD_NOMINAL_CATEGORIES.severity.includes(left.severity) &&
      FIELD_NOMINAL_CATEGORIES.severity.includes(right.severity)
      ? [left.severity, right.severity]
      : null;
  }
  return null;
}

function fieldKappa(pairs, metricName) {
  const values = pairs
    .map((pair) => fieldCategoryPair(pair, metricName))
    .filter(Boolean);
  if (values.length < 2) return null;
  const categories = FIELD_NOMINAL_CATEGORIES[metricName];
  const observedCategories = new Set(values.flat());
  if (observedCategories.size < 2) return null;
  const weight = (left, right) => {
    if (metricName !== "severity") return left === right ? 1 : 0;
    const leftIndex = categories.indexOf(left);
    const rightIndex = categories.indexOf(right);
    return 1 - Math.abs(leftIndex - rightIndex) / (categories.length - 1);
  };
  const observed = average(values.map(([left, right]) => weight(left, right)));
  const expected = categories.reduce((outer, leftCategory) => {
    const leftRate =
      values.filter(([left]) => left === leftCategory).length / values.length;
    return (
      outer +
      categories.reduce((inner, rightCategory) => {
        const rightRate =
          values.filter(([, right]) => right === rightCategory).length /
          values.length;
        return inner + leftRate * rightRate * weight(leftCategory, rightCategory);
      }, 0)
    );
  }, 0);
  return expected === 1 ? null : (observed - expected) / (1 - expected);
}

function perPairStructuralMetrics(pair) {
  if (!pair?.left || !pair?.right) {
    return { evidence: null, defectCodes: null, legalBases: null };
  }
  const duplicate = {
    ...pair,
    caseId: `${pair.caseId}\u0000agreement-copy`,
  };
  const report = computeLegalReviewerFieldAgreement([pair, duplicate], {
    expectedPairCount: 2,
  });
  return {
    evidence: report.evidenceGrounding.structuralAgreementRate,
    defectCodes: report.defectCodes.nonEmptyMeanJaccard,
    legalBases: report.legalBases.nonEmptyMeanJaccard,
  };
}

function agreementCompanySummaries(pairs) {
  const byCompany = new Map();
  for (const pair of pairs) {
    if (typeof pair.companyId !== "string" || !pair.companyId.trim()) continue;
    const companyId = pair.companyId.trim();
    const summary = byCompany.get(companyId) ?? {
      companyId,
      pairs: [],
      structural: {
        evidence: { sum: 0, count: 0 },
        defectCodes: { sum: 0, count: 0 },
        legalBases: { sum: 0, count: 0 },
      },
    };
    summary.pairs.push(pair);
    const structural = perPairStructuralMetrics(pair);
    for (const key of ["evidence", "defectCodes", "legalBases"]) {
      if (!Number.isFinite(structural[key])) continue;
      summary.structural[key].sum += structural[key];
      summary.structural[key].count += 1;
    }
    byCompany.set(companyId, summary);
  }
  return [...byCompany.values()];
}

function fieldAgreementConfidenceIntervals(corpus, pairs, scope) {
  const summaries = agreementCompanySummaries(pairs);
  const flattenedPairs = (sample) => sample.flatMap((summary) => summary.pairs);
  const kappaInterval = (metricName) => {
    const interval = clusterBootstrap(
      corpus,
      summaries,
      scope,
      `reviewer_${metricName}`,
      (sample) => fieldKappa(flattenedPairs(sample), metricName),
    );
    return {
      ...interval,
      contributingCompanyCount: summaries.filter((summary) =>
        summary.pairs.some((pair) => fieldCategoryPair(pair, metricName)),
      ).length,
    };
  };
  const meanInterval = (metricName) => {
    const interval = clusterBootstrap(
      corpus,
      summaries,
      scope,
      `reviewer_${metricName}`,
      (sample) => {
        const totals = sample.reduce(
          (result, summary) => {
            result.sum += summary.structural[metricName].sum;
            result.count += summary.structural[metricName].count;
            return result;
          },
          { sum: 0, count: 0 },
        );
        return ratio(totals.sum, totals.count);
      },
    );
    return {
      ...interval,
      contributingCompanyCount: summaries.filter(
        (summary) => summary.structural[metricName].count > 0,
      ).length,
    };
  };
  return {
    applicabilityCohenKappa: kappaInterval("applicability"),
    operationalOutcomeCohenKappa: kappaInterval("operationalOutcome"),
    goldLabelCohenKappa: kappaInterval("goldLabel"),
    requiresFactualVerificationCohenKappa: kappaInterval(
      "requiresFactualVerification",
    ),
    severityLinearWeightedKappa: kappaInterval("severity"),
    evidenceStructuralAgreementRate: meanInterval("evidence"),
    defectCodeNonEmptyMeanJaccard: meanInterval("defectCodes"),
    legalBasisNonEmptyMeanJaccard: meanInterval("legalBases"),
  };
}

function structuredFieldAgreementReport(corpus, pairs, modes, scope) {
  const point = fieldAgreementForPairs(pairs);
  return {
    ...point,
    confidenceIntervals: fieldAgreementConfidenceIntervals(corpus, pairs, scope),
    byMode: Object.fromEntries(
      modes.map((mode) => {
        const modePairs = pairs.filter((pair) => pair.track === mode);
        return [
          mode,
          {
            ...fieldAgreementForPairs(modePairs),
            confidenceIntervals: fieldAgreementConfidenceIntervals(
              corpus,
              modePairs,
              `${scope}:${mode}`,
            ),
          },
        ];
      }),
    ),
  };
}

function highRiskDistribution(rows) {
  const highRows = rows.filter((row) => isGoldHighStrictActionable(row.gold));
  const byFamily = new Map();
  for (const row of highRows) {
    const family = LEGAL_ACCURACY_RULE_BY_ID.get(row.ruleId)?.family ?? "unknown";
    byFamily.set(family, (byFamily.get(family) ?? 0) + 1);
  }
  const largestFamilyCount = Math.max(0, ...byFamily.values());
  return {
    goldPositiveCount: highRows.length,
    ruleFamilyCount: byFamily.size,
    largestFamilyFraction: ratio(largestFamilyCount, highRows.length),
  };
}

function bootstrapIntervalFailure(
  failures,
  label,
  interval,
  minimumLower95,
  minimumClusters = 30,
) {
  if (!interval || interval.status !== "ok") {
    failures.push(`${label} confidence intervals are unavailable`);
    return;
  }
  const validFraction = ratio(
    interval.validReplicates,
    interval.requestedReplicates,
  );
  if (
    interval.method !== "company_cluster_percentile_bootstrap" ||
    interval.methodVersion !== "1.0.0" ||
    interval.confidenceLevel !== 0.95 ||
    interval.seedAlgorithm !== "fnv1a-32-utf16+mulberry32" ||
    interval.requestedReplicates < 10_000 ||
    validFraction === null ||
    validFraction < 0.99 ||
    interval.clusterCount < minimumClusters ||
    (Number.isFinite(interval.contributingCompanyCount) &&
      interval.contributingCompanyCount < minimumClusters) ||
    !Number.isFinite(interval.lower) ||
    !Number.isFinite(interval.upper)
  ) {
    failures.push(`${label} confidence interval contract is incomplete`);
    return;
  }
  if (!Number.isFinite(minimumLower95)) {
    failures.push(`${label} lower-95 threshold is missing`);
  } else if (interval.lower < minimumLower95) {
    failures.push(
      `${label} lower 95% bound ${interval.lower.toFixed(4)} is below ${minimumLower95}`,
    );
  }
}

function wilsonUpperFailure(
  failures,
  label,
  interval,
  observedCount,
  maximumObservedCount,
  maximumUpper95,
) {
  if (
    !interval ||
    interval.status !== "ok" ||
    interval.method !== "wilson_score" ||
    interval.confidenceLevel !== 0.95 ||
    !Number.isFinite(interval.upper)
  ) {
    failures.push(`${label} Wilson confidence interval is unavailable`);
    return;
  }
  if (!Number.isInteger(maximumObservedCount) || maximumObservedCount < 0) {
    failures.push(`${label} observed-count threshold is missing`);
  } else if (observedCount > maximumObservedCount) {
    failures.push(
      `${label} observed count ${observedCount} exceeds ${maximumObservedCount}`,
    );
  }
  if (!Number.isFinite(maximumUpper95)) {
    failures.push(`${label} upper-95 threshold is missing`);
  } else if (interval.upper > maximumUpper95) {
    failures.push(
      `${label} upper 95% bound ${interval.upper.toFixed(4)} exceeds ${maximumUpper95}`,
    );
  }
}

function wilsonLowerFailure(failures, label, interval, minimumLower95) {
  if (
    !interval ||
    interval.status !== "ok" ||
    interval.method !== "wilson_score" ||
    interval.confidenceLevel !== 0.95 ||
    !Number.isFinite(interval.lower)
  ) {
    failures.push(`${label} Wilson confidence interval is unavailable`);
    return;
  }
  if (!Number.isFinite(minimumLower95)) {
    failures.push(`${label} lower-95 threshold is missing`);
  } else if (interval.lower < minimumLower95) {
    failures.push(
      `${label} Wilson lower 95% bound ${interval.lower.toFixed(4)} is below ${minimumLower95}`,
    );
  }
}

function minimumSupportFailure(failures, label, value, minimum) {
  if (!Number.isFinite(minimum)) {
    failures.push(`${label} minimum support is not configured`);
  } else if (!Number.isFinite(value) || value < minimum) {
    failures.push(`${label} support ${value ?? "n/a"} is below ${minimum}`);
  }
}

function supportGateFailures(failures, label, support, policy, ruleIds) {
  if (!support || !policy) {
    failures.push(`${label} metric support contract is unavailable`);
    return;
  }
  minimumSupportFailure(
    failures,
    `${label} policy`,
    support.caseCount,
    policy.minimumMetricEligiblePolicies,
  );
  minimumSupportFailure(
    failures,
    `${label} company`,
    support.companyCount,
    policy.minimumDistinctCompanies,
  );
  for (const ruleId of ruleIds) {
    const rule = support.perRule?.[ruleId];
    minimumSupportFailure(
      failures,
      `${label} ${ruleId} gold-positive row`,
      rule?.goldPositiveRows,
      policy.perRuleGoldPositiveForRecall,
    );
    minimumSupportFailure(
      failures,
      `${label} ${ruleId} predicted-positive row`,
      rule?.predictedPositiveRows,
      policy.perRulePredictedPositiveForPrecision,
    );
    minimumSupportFailure(
      failures,
      `${label} ${ruleId} gold-negative row`,
      rule?.goldNegativeRows,
      policy.perRuleGoldNegativeForF1,
    );
    minimumSupportFailure(
      failures,
      `${label} ${ruleId} gold-positive company`,
      rule?.goldPositiveCompanies,
      policy.minimumGoldPositiveCompaniesPerRule,
    );
    minimumSupportFailure(
      failures,
      `${label} ${ruleId} predicted-positive company`,
      rule?.predictedPositiveCompanies,
      policy.minimumPredictedPositiveCompaniesPerRule,
    );
    minimumSupportFailure(
      failures,
      `${label} ${ruleId} gold-negative company`,
      rule?.goldNegativeCompanies,
      policy.minimumGoldNegativeCompaniesPerRule,
    );
  }
  const metricRequirements = [
    [
      "high-risk",
      "highStrictActionableRecall",
      "highRiskGoldPositiveTotal",
      "highRiskMinimumDistinctCompanies",
    ],
    [
      "strict evidence",
      "strictEvidenceGroundingRate",
      "strictEvidenceMinimumPredictions",
      "strictEvidenceMinimumDistinctCompanies",
    ],
    [
      "unsafe high",
      "unsafeHighEscalationRate",
      "unsafeHighMinimumEligibleRows",
      "unsafeHighMinimumDistinctCompanies",
    ],
    [
      "legal-basis precision",
      "legalBasisPrecision",
      "legalBasisMinimumPredictedCitations",
      "legalBasisMinimumDistinctCompanies",
    ],
    [
      "legal-basis recall",
      "legalBasisRecall",
      "legalBasisMinimumGoldCitations",
      "legalBasisMinimumDistinctCompanies",
    ],
    [
      "high overstatement",
      "highOverstatementRate",
      "highOverstatementMinimumEligibleRows",
      "highOverstatementMinimumDistinctCompanies",
    ],
    [
      "partial omission",
      "partialUnsupportedOmissionRate",
      "partialDocumentMinimumEligibleRows",
      "partialDocumentMinimumDistinctCompanies",
    ],
  ];
  for (const [metricLabel, metricKey, rowMinimumKey, companyMinimumKey] of
    metricRequirements) {
    minimumSupportFailure(
      failures,
      `${label} ${metricLabel} row`,
      support[metricKey]?.denominator,
      policy[rowMinimumKey],
    );
    minimumSupportFailure(
      failures,
      `${label} ${metricLabel} company`,
      support[metricKey]?.contributingCompanyCount,
      policy[companyMinimumKey],
    );
  }
}

const FIELD_AGREEMENT_GATE_KEYS = Object.freeze([
  ["applicability_cohen_kappa", "applicabilityCohenKappa"],
  ["operational_outcome_cohen_kappa", "operationalOutcomeCohenKappa"],
  ["gold_label_cohen_kappa", "goldLabelCohenKappa"],
  [
    "requires_factual_verification_cohen_kappa",
    "requiresFactualVerificationCohenKappa",
  ],
  ["severity_linear_weighted_kappa", "severityLinearWeightedKappa"],
  [
    "evidence_structural_agreement_rate",
    "evidenceStructuralAgreementRate",
  ],
  ["defect_code_mean_jaccard", "defectCodeNonEmptyMeanJaccard"],
  ["legal_basis_mean_jaccard", "legalBasisNonEmptyMeanJaccard"],
]);

function fieldAgreementGateFailures(
  failures,
  label,
  agreement,
  thresholds,
  minimumClusters,
) {
  const minimumCoverage = thresholds?.minimumCompletePairCoverage ?? 1;
  const maximumIncomplete = thresholds?.maximumIncompletePairCount ?? 0;
  const maximumInvalid = thresholds?.maximumInvalidValueCount ?? 0;
  const maximumMissing = thresholds?.maximumMissingValueCount ?? 0;
  const fieldMetrics = [
    ...Object.values(agreement?.fields ?? {}),
    agreement?.evidenceGrounding,
    agreement?.defectCodes,
    agreement?.legalBases,
  ].filter(Boolean);
  const invalidValueCount = fieldMetrics.reduce(
    (sum, metric) => sum + (metric.exclusions?.invalidValue ?? 0),
    0,
  );
  const missingValueCount = fieldMetrics.reduce(
    (sum, metric) => sum + (metric.exclusions?.missingValue ?? 0),
    0,
  );
  if (
    !agreement ||
    agreement.status !== "ok" ||
    agreement.coverage?.complete !== true ||
    !Number.isFinite(agreement.coverage?.coverageRate) ||
    agreement.coverage.coverageRate < minimumCoverage ||
    agreement.incompletePairCount > maximumIncomplete ||
    agreement.invalidPairCount > maximumInvalid ||
    invalidValueCount > maximumInvalid ||
    missingValueCount > maximumMissing
  ) {
    failures.push(`${label} field-level reviewer agreement coverage is incomplete`);
  }
  for (const [thresholdKey, intervalKey] of FIELD_AGREEMENT_GATE_KEYS) {
    bootstrapIntervalFailure(
      failures,
      `${label} ${thresholdKey}`,
      agreement?.confidenceIntervals?.[intervalKey],
      thresholds?.[thresholdKey]?.minimumLower95,
      minimumClusters,
    );
  }
}

function evaluateGate(corpus, report, validation) {
  const gateConfig = corpus.gate ?? { mode: "calibration" };
  const mode = gateConfig.mode ?? "calibration";
  const failures = [];
  const warnings = [...validation.warnings];
  if (mode !== "enforced") {
    return {
      mode: "calibration",
      enforced: false,
      status: "calibration",
      failures,
      warnings,
      observed: {
        microPrecision: report.metrics.micro.precision,
        microRecall: report.metrics.micro.recall,
        microF1: report.metrics.micro.f1,
        macroF1: report.metrics.macro.f1,
        possibleMissingPrecision: report.special.possibleMissing.precision,
        highStrictActionableRecall: report.special.highStrictActionable.recall,
        strictEvidenceGroundingRate:
          report.evidence.strictEvidenceGroundingRate,
        cohenKappa: report.agreement.meanPairwiseKappa,
      },
    };
  }

  const calibrated =
    gateConfig.calibrated === true || gateConfig.calibration?.status === "complete";
  if (!calibrated) failures.push("Enforced gate has not been explicitly calibrated");
  if (corpus.datasetKind === "synthetic") {
    failures.push("Synthetic data cannot enforce the expert accuracy gate");
  }
  const requiredRuleIds = [...LEGAL_ACCURACY_RULE_BY_ID.keys()].sort();
  const configuredRuleIds = [...new Set(corpus.ruleIds ?? [])].sort();
  if (
    requiredRuleIds.length !== configuredRuleIds.length ||
    requiredRuleIds.some((ruleId, index) => ruleId !== configuredRuleIds[index])
  ) {
    failures.push("enforced gate must evaluate the complete canonical rule catalog");
  }
  const requiredModes = [...LEGAL_ACCURACY_MODES].sort();
  const configuredModes = [...new Set(corpus.modes ?? [])].sort();
  if (
    requiredModes.length !== configuredModes.length ||
    requiredModes.some((track, index) => track !== configuredModes[index])
  ) {
    failures.push("enforced gate must evaluate every production review track");
  }
  const minimumCases = gateConfig.minCases ?? 100;
  if (report.metricEligibleExpertCaseCount < minimumCases) {
    failures.push(
      `metric-eligible expert case support ${report.metricEligibleExpertCaseCount} is below ${minimumCases}`,
    );
  }
  if (report.validation.excludedGoldItemCount > 0) {
    failures.push(
      `${report.validation.excludedGoldItemCount} required gold items are not eligible expert adjudications`,
    );
  }
  const integrity = report.sampleIntegrity;
  const minimumCompanies = gateConfig.minDistinctCompanies ?? minimumCases;
  if (integrity.distinctCompanyCount < minimumCompanies) {
    failures.push(
      `distinct company support ${integrity.distinctCompanyCount} is below ${minimumCompanies}`,
    );
  }
  const minimumSectors = gateConfig.minSectors ?? 5;
  if (integrity.distinctSectorCount < minimumSectors) {
    failures.push(
      `sector support ${integrity.distinctSectorCount} is below ${minimumSectors}`,
    );
  }
  const minimumLockedFraction = gateConfig.minLockedTestFraction ?? 0.3;
  if (
    integrity.lockedTestFraction === null ||
    integrity.lockedTestFraction < minimumLockedFraction
  ) {
    failures.push(
      `locked-test fraction ${integrity.lockedTestFraction ?? "n/a"} is below ${minimumLockedFraction}`,
    );
  }
  if (integrity.splitViolatingCompanies.length > 0) {
    failures.push("one or more companies cross evaluation splits");
  }
  if (integrity.duplicateDocumentHashes.length > 0) {
    failures.push("duplicate document hashes are not allowed in an enforced corpus");
  }
  if (
    integrity.missingCompanyIds.length > 0 ||
    integrity.missingSectors.length > 0 ||
    integrity.missingSplits.length > 0
  ) {
    failures.push("companyId, sector, and split are required for every scored case");
  }

  const locked = report.bySplit.lockedTest;
  const minimumHighRiskGold = gateConfig.minHighRiskGold ?? 50;
  if (locked.highRiskDistribution.goldPositiveCount < minimumHighRiskGold) {
    failures.push(
      `locked-test high-risk gold support ${locked.highRiskDistribution.goldPositiveCount} is below ${minimumHighRiskGold}`,
    );
  }
  const minimumHighRiskFamilies = gateConfig.minHighRiskFamilies ?? 5;
  if (locked.highRiskDistribution.ruleFamilyCount < minimumHighRiskFamilies) {
    failures.push(
      `locked-test high-risk rule-family support ${locked.highRiskDistribution.ruleFamilyCount} is below ${minimumHighRiskFamilies}`,
    );
  }
  const maximumHighRiskFamilyFraction =
    gateConfig.maxHighRiskSingleFamilyFraction ?? 0.4;
  if (
    locked.highRiskDistribution.largestFamilyFraction === null ||
    locked.highRiskDistribution.largestFamilyFraction >
      maximumHighRiskFamilyFraction
  ) {
    failures.push(
      `locked-test largest high-risk family fraction ${locked.highRiskDistribution.largestFamilyFraction ?? "n/a"} exceeds ${maximumHighRiskFamilyFraction}`,
    );
  }
  if (locked.metrics.macro.insufficientRuleIds.length > 0) {
    failures.push(
      `insufficient locked-test per-rule support: ${locked.metrics.macro.insufficientRuleIds.join(", ")}`,
    );
  }
  if (report.unknownFindingIds.length > 0) {
    failures.push(`unmapped analyzer findings: ${report.unknownFindingIds.join(", ")}`);
  }
  if (validation.missingGoldKeys.length > 0) {
    failures.push("gold matrix is incomplete");
  }

  const thresholds = gateConfig.thresholds ?? {};
  const minimumTrackCompanies =
    gateConfig.minLockedTestPerTrackCompanies ?? 30;
  const lockedIntervals = locked.confidenceIntervals;
  bootstrapIntervalFailure(
    failures,
    "locked-test macro F1",
    lockedIntervals?.macroF1,
    thresholds.minMacroF1Lower95,
    minimumTrackCompanies,
  );
  bootstrapIntervalFailure(
    failures,
    "locked-test possible-missing precision",
    lockedIntervals?.possibleMissingPrecision?.companyClusterBootstrap,
    thresholds.minPossibleMissingPrecisionLower95,
    minimumTrackCompanies,
  );
  wilsonLowerFailure(
    failures,
    "locked-test possible-missing precision",
    lockedIntervals?.possibleMissingPrecision?.wilson,
    thresholds.minPossibleMissingPrecisionLower95,
  );
  bootstrapIntervalFailure(
    failures,
    "locked-test high strict/actionable recall",
    lockedIntervals?.highStrictActionableRecall?.companyClusterBootstrap,
    thresholds.minHighStrictActionableRecallLower95,
    minimumTrackCompanies,
  );
  wilsonLowerFailure(
    failures,
    "locked-test high strict/actionable recall",
    lockedIntervals?.highStrictActionableRecall?.wilson,
    thresholds.minHighStrictActionableRecallLower95,
  );
  bootstrapIntervalFailure(
    failures,
    "locked-test strict evidence grounding rate",
    lockedIntervals?.strictEvidenceGroundingRate?.companyClusterBootstrap,
    thresholds.minStrictEvidenceGroundingRateLower95,
    minimumTrackCompanies,
  );
  wilsonLowerFailure(
    failures,
    "locked-test strict evidence grounding rate",
    lockedIntervals?.strictEvidenceGroundingRate?.wilson,
    thresholds.minStrictEvidenceGroundingRateLower95,
  );
  bootstrapIntervalFailure(
    failures,
    "locked-test legal-basis precision",
    lockedIntervals?.legalBasisPrecision?.companyClusterBootstrap,
    thresholds.minLegalBasisPrecisionLower95,
    minimumTrackCompanies,
  );
  wilsonLowerFailure(
    failures,
    "locked-test legal-basis precision",
    lockedIntervals?.legalBasisPrecision?.wilson,
    thresholds.minLegalBasisPrecisionLower95,
  );
  bootstrapIntervalFailure(
    failures,
    "locked-test legal-basis recall",
    lockedIntervals?.legalBasisRecall?.companyClusterBootstrap,
    thresholds.minLegalBasisRecallLower95,
    minimumTrackCompanies,
  );
  wilsonLowerFailure(
    failures,
    "locked-test legal-basis recall",
    lockedIntervals?.legalBasisRecall?.wilson,
    thresholds.minLegalBasisRecallLower95,
  );
  wilsonUpperFailure(
    failures,
    "locked-test unsafe high escalation",
    lockedIntervals?.unsafeHighEscalationRate?.wilson,
    lockedIntervals?.unsafeHighEscalationRate?.observedCount,
    thresholds.maxUnsafeHighEscalationObservedCount,
    thresholds.maxUnsafeHighEscalationRateUpper95,
  );
  wilsonUpperFailure(
    failures,
    "locked-test high overstatement",
    lockedIntervals?.highOverstatementRate?.wilson,
    lockedIntervals?.highOverstatementRate?.wilson?.successes,
    thresholds.maxHighOverstatementObservedCount,
    thresholds.maxHighOverstatementRateUpper95,
  );
  wilsonUpperFailure(
    failures,
    "locked-test partial unsupported omission",
    lockedIntervals?.partialUnsupportedOmissionRate?.wilson,
    lockedIntervals?.partialUnsupportedOmissionRate?.wilson?.successes,
    thresholds.maxPartialUnsupportedOmissionObservedCount,
    thresholds.maxPartialUnsupportedOmissionRateUpper95,
  );
  wilsonUpperFailure(
    failures,
    "locked-test partial unsafe high",
    lockedIntervals?.partialUnsafeHighRate?.wilson,
    lockedIntervals?.partialUnsafeHighRate?.wilson?.successes,
    thresholds.maxPartialUnsafeHighObservedCount,
    thresholds.maxPartialUnsafeHighRateUpper95,
  );
  fieldAgreementGateFailures(
    failures,
    "locked-test",
    report.agreement.fieldLevel?.bySplit?.lockedTest,
    thresholds.fieldAgreement,
    minimumTrackCompanies,
  );
  for (const track of corpus.modes ?? LEGAL_ACCURACY_MODES) {
    const trackMetrics = locked.metrics.byMode[track];
    if (
      !trackMetrics ||
      trackMetrics.micro.positiveSupport + trackMetrics.micro.negativeSupport === 0
    ) {
      failures.push(`locked-test track has no scored items: ${track}`);
      continue;
    }
    if (trackMetrics.macro.insufficientRuleIds.length > 0) {
      failures.push(
        `insufficient locked-test ${track} per-rule support: ${trackMetrics.macro.insufficientRuleIds.join(", ")}`,
      );
    }
    const trackIntervals = lockedIntervals?.byMode?.[track];
    supportGateFailures(
      failures,
      `locked-test ${track}`,
      trackIntervals?.support,
      gateConfig.supportMinimums,
      corpus.ruleIds ?? [],
    );
    bootstrapIntervalFailure(
      failures,
      `locked-test ${track} macro F1`,
      trackIntervals?.macroF1,
      thresholds.minMacroF1Lower95,
      minimumTrackCompanies,
    );
    wilsonLowerFailure(
      failures,
      `locked-test ${track} possible-missing precision`,
      trackIntervals?.possibleMissingPrecision?.wilson,
      thresholds.minPossibleMissingPrecisionLower95,
    );
    bootstrapIntervalFailure(
      failures,
      `locked-test ${track} possible-missing precision`,
      trackIntervals?.possibleMissingPrecision?.companyClusterBootstrap,
      thresholds.minPossibleMissingPrecisionLower95,
      minimumTrackCompanies,
    );
    wilsonLowerFailure(
      failures,
      `locked-test ${track} high strict/actionable recall`,
      trackIntervals?.highStrictActionableRecall?.wilson,
      thresholds.minHighStrictActionableRecallLower95,
    );
    bootstrapIntervalFailure(
      failures,
      `locked-test ${track} high strict/actionable recall`,
      trackIntervals?.highStrictActionableRecall?.companyClusterBootstrap,
      thresholds.minHighStrictActionableRecallLower95,
      minimumTrackCompanies,
    );
    wilsonLowerFailure(
      failures,
      `locked-test ${track} strict evidence grounding rate`,
      trackIntervals?.strictEvidenceGroundingRate?.wilson,
      thresholds.minStrictEvidenceGroundingRateLower95,
    );
    bootstrapIntervalFailure(
      failures,
      `locked-test ${track} strict evidence grounding rate`,
      trackIntervals?.strictEvidenceGroundingRate?.companyClusterBootstrap,
      thresholds.minStrictEvidenceGroundingRateLower95,
      minimumTrackCompanies,
    );
    wilsonLowerFailure(
      failures,
      `locked-test ${track} legal-basis precision`,
      trackIntervals?.legalBasisPrecision?.wilson,
      thresholds.minLegalBasisPrecisionLower95,
    );
    bootstrapIntervalFailure(
      failures,
      `locked-test ${track} legal-basis precision`,
      trackIntervals?.legalBasisPrecision?.companyClusterBootstrap,
      thresholds.minLegalBasisPrecisionLower95,
      minimumTrackCompanies,
    );
    wilsonLowerFailure(
      failures,
      `locked-test ${track} legal-basis recall`,
      trackIntervals?.legalBasisRecall?.wilson,
      thresholds.minLegalBasisRecallLower95,
    );
    bootstrapIntervalFailure(
      failures,
      `locked-test ${track} legal-basis recall`,
      trackIntervals?.legalBasisRecall?.companyClusterBootstrap,
      thresholds.minLegalBasisRecallLower95,
      minimumTrackCompanies,
    );
    wilsonUpperFailure(
      failures,
      `locked-test ${track} unsafe high escalation`,
      trackIntervals?.unsafeHighEscalationRate?.wilson,
      trackIntervals?.unsafeHighEscalationRate?.observedCount,
      thresholds.maxUnsafeHighEscalationObservedCount,
      thresholds.maxUnsafeHighEscalationRateUpper95,
    );
    wilsonUpperFailure(
      failures,
      `locked-test ${track} high overstatement`,
      trackIntervals?.highOverstatementRate?.wilson,
      trackIntervals?.highOverstatementRate?.wilson?.successes,
      thresholds.maxHighOverstatementObservedCount,
      thresholds.maxHighOverstatementRateUpper95,
    );
    wilsonUpperFailure(
      failures,
      `locked-test ${track} partial unsupported omission`,
      trackIntervals?.partialUnsupportedOmissionRate?.wilson,
      trackIntervals?.partialUnsupportedOmissionRate?.wilson?.successes,
      thresholds.maxPartialUnsupportedOmissionObservedCount,
      thresholds.maxPartialUnsupportedOmissionRateUpper95,
    );
    wilsonUpperFailure(
      failures,
      `locked-test ${track} partial unsafe high`,
      trackIntervals?.partialUnsafeHighRate?.wilson,
      trackIntervals?.partialUnsafeHighRate?.wilson?.successes,
      thresholds.maxPartialUnsafeHighObservedCount,
      thresholds.maxPartialUnsafeHighRateUpper95,
    );
    fieldAgreementGateFailures(
      failures,
      `locked-test ${track}`,
      report.agreement.fieldLevel?.bySplit?.lockedTest?.byMode?.[track],
      thresholds.fieldAgreement,
      minimumTrackCompanies,
    );
  }
  return {
    mode: "enforced",
    enforced: true,
    status: failures.length ? "fail" : "pass",
    failures,
    warnings,
    metricBasis: "lockedTest",
  };
}

/**
 * Evaluate a fully loaded corpus.  The production analyzer is injected so the
 * metric library stays deterministic and unit-testable; the CLI injects
 * analyzePrivacyPolicy directly rather than making HTTP requests.
 */
export function evaluateLegalAccuracyCorpus(corpus, options) {
  if (typeof options?.analyze !== "function") {
    throw new TypeError("options.analyze must be the analyzer function");
  }
  const validation = validateLegalAccuracyCorpus(corpus, options);
  if (!validation.valid) throw new LegalAccuracyConfigurationError(validation.errors);

  const modes = corpus.modes ?? LEGAL_ACCURACY_MODES;
  const ruleIds = corpus.ruleIds;
  const predictions = new Map();
  const unknownFindingIds = new Set();
  const analysisRuns = [];

  for (const testCase of corpus.cases) {
    for (const mode of modesForCase(testCase, modes)) {
      const contextOverrides =
        mode === "context_assisted" ? contextForCase(testCase) : {};
      const analysis = options.analyze(testCase.text, {
        legalAsOfDate: corpus.legalAsOfDate,
        runtimeLegalManifest: options.runtimeLegalManifest,
        contextOverrides,
        sourceUrl: testCase.sourceUrl,
        policyUrl: testCase.policyUrl ?? testCase.sourceUrl,
        policyTitle: testCase.title,
        retrievedAt: testCase.retrievedAt,
      });
      if (analysis?.legalBaseline?.rulesetVersion !== corpus.rulesetVersion) {
        throw new LegalAccuracyConfigurationError([
          `${testCase.id}/${mode}: analyzer returned ruleset ${analysis?.legalBaseline?.rulesetVersion}`,
        ]);
      }
      if (analysis?.legalBaseline?.asOfDate !== corpus.legalAsOfDate) {
        throw new LegalAccuracyConfigurationError([
          `${testCase.id}/${mode}: analyzer did not use the pinned legalAsOfDate`,
        ]);
      }
      if (
        analysis?.legalBaseline?.overdueLegalReview ||
        analysis?.findings?.some(
          (finding) =>
            finding.legalJudgmentStatus === "deferred_pending_legal_review",
        )
      ) {
        throw new LegalAccuracyConfigurationError([
          `${testCase.id}/${mode}: legal-review deferral makes accuracy scoring invalid`,
        ]);
      }
      const mapped = mapAnalysisFindings(analysis?.findings);
      mapped.unknown.forEach((id) => unknownFindingIds.add(id));
      analysisRuns.push({ caseId: testCase.id, mode, analysis });
      for (const ruleId of ruleIds) {
        predictions.set(
          keyOf(testCase.id, mode, ruleId),
          mapped.byRule.get(ruleId) ?? { findings: [], noFindings: [] },
        );
      }
    }
  }

  const caseById = new Map(corpus.cases.map((testCase) => [testCase.id, testCase]));
  const expertGold = corpus.gold.filter((gold) =>
    isEligibleExpertGold(
      gold,
      caseById.get(gold.caseId),
      corpus.annotations ?? [],
    ),
  );
  const metricGold = expertGold.filter((gold) =>
    isExpertMetricGold(gold, caseById.get(gold.caseId), corpus.annotations ?? []),
  );
  const rows = [];
  for (const gold of metricGold) {
    if (!modes.includes(gold.mode) || !ruleIds.includes(gold.ruleId)) continue;
    const itemKey = keyOf(gold.caseId, gold.mode, gold.ruleId);
    const prediction = predictions.get(itemKey) ?? { findings: [], noFindings: [] };
    const expectedIds = expectedFindingIds(gold);
    const testCase = caseById.get(gold.caseId);
    const eligiblePredictions =
      documentScope(testCase) === "full_policy"
        ? prediction.findings
        : prediction.findings.filter(
            (finding) => finding.findingType !== "possible_missing_disclosure",
          );
    const predictedPositive = eligiblePredictions.length > 0;
    const anchors = verifiedSpanEvidence(gold, testCase).map((entry) => entry.quote);
    const predictedIds = eligiblePredictions.map((finding) => finding.id);
    const variantMatches =
      expectedIds.length > 0 &&
      predictedIds.some((findingId) => expectedIds.includes(findingId));
    rows.push({
      caseId: gold.caseId,
      companyId: testCase?.companyId ?? null,
      mode: gold.mode,
      ruleId: gold.ruleId,
      goldDecision: gold.decision,
      predictedPositive,
      predictedIds,
      variantMatches,
      expectedFindingIds: expectedIds,
      predictions: eligiblePredictions,
      rawPredictions: prediction.findings,
      gold,
      evidenceAnchors: anchors,
      documentText: testCase?.text ?? "",
      documentScope: documentScope(testCase),
    });
  }
  const unsafeGuardrailRows = [];
  for (const gold of expertGold) {
    const testCase = caseById.get(gold.caseId);
    if (
      !modes.includes(gold.mode) ||
      !ruleIds.includes(gold.ruleId) ||
      !isOmissionMetricExcluded(gold, testCase)
    ) {
      continue;
    }
    const prediction =
      predictions.get(keyOf(gold.caseId, gold.mode, gold.ruleId)) ?? {
        findings: [],
      };
    unsafeGuardrailRows.push({
      caseId: gold.caseId,
      companyId: testCase?.companyId ?? null,
      mode: gold.mode,
      ruleId: gold.ruleId,
      goldDecision: gold.decision,
      predictions: [],
      rawPredictions: prediction.findings,
      gold,
      documentScope: documentScope(testCase),
    });
  }

  const supportPolicy = {
    minPositivePerRule: corpus.supportPolicy?.minPositivePerRule ?? 1,
    minNegativePerRule: corpus.supportPolicy?.minNegativePerRule ?? 1,
    minPredictedPositivePerRule:
      corpus.supportPolicy?.minPredictedPositivePerRule ?? 1,
  };
  const metrics = buildMetricReport(rows, ruleIds, modes, supportPolicy);
  const overallSpecial = buildSpecialReport(rows, unsafeGuardrailRows);
  const confidenceIntervals = confidenceIntervalReport(
    corpus,
    rows,
    unsafeGuardrailRows,
    ruleIds,
    supportPolicy,
    "all",
  );
  const splitNames = ["calibration", "development", "lockedTest"];
  const bySplit = Object.fromEntries(
    splitNames.map((split) => {
      const splitRows = rows.filter(
        (row) => caseById.get(row.caseId)?.split === split,
      );
      const splitGuardrailRows = unsafeGuardrailRows.filter(
        (row) => caseById.get(row.caseId)?.split === split,
      );
      return [
        split,
        {
          caseCount: new Set(splitRows.map((row) => row.caseId)).size,
          metrics: buildMetricReport(splitRows, ruleIds, modes, supportPolicy),
          ...buildSpecialReport(splitRows, splitGuardrailRows),
          confidenceIntervals: {
            ...confidenceIntervalReport(
              corpus,
              splitRows,
              splitGuardrailRows,
              ruleIds,
              supportPolicy,
              split,
            ),
            byMode: Object.fromEntries(
              modes.map((mode) => [
                mode,
                confidenceIntervalReport(
                  corpus,
                  splitRows.filter((row) => row.mode === mode),
                  splitGuardrailRows.filter((row) => row.mode === mode),
                  ruleIds,
                  supportPolicy,
                  `${split}:${mode}`,
                ),
              ]),
            ),
          },
          highRiskDistribution: highRiskDistribution(splitRows),
          byMode: Object.fromEntries(
            modes.map((mode) => [
              mode,
              buildSpecialReport(
                splitRows.filter((row) => row.mode === mode),
                splitGuardrailRows.filter((row) => row.mode === mode),
              ),
            ]),
          ),
        },
      ];
    }),
  );

  const metricGoldKeys = new Set(
    metricGold.map((gold) => keyOf(gold.caseId, gold.mode, gold.ruleId)),
  );
  const agreementAnnotations = (corpus.annotations ?? []).filter(
    (annotation) =>
      metricGoldKeys.has(
        keyOf(annotation.caseId, annotation.mode, annotation.ruleId),
      ) &&
      annotation.eligibleForMetrics !== false &&
      annotation.synthetic !== true,
  );
  const agreement = agreementReport(agreementAnnotations, modes);
  const structuredPairs = buildStructuredReviewerPairs(
    metricGold,
    agreementAnnotations,
    caseById,
  );
  agreement.fieldLevel = {
    ...structuredFieldAgreementReport(corpus, structuredPairs, modes, "all"),
    bySplit: Object.fromEntries(
      ["calibration", "development", "lockedTest"].map((split) => {
        const splitPairs = structuredPairs.filter(
          (pair) => caseById.get(pair.caseId)?.split === split,
        );
        return [
          split,
          structuredFieldAgreementReport(
            corpus,
            splitPairs,
            modes,
            `reviewer:${split}`,
          ),
        ];
      }),
    ),
  };
  const eligibleCaseIds = [...new Set(metricGold.map((gold) => gold.caseId))];
  const eligibleCases = eligibleCaseIds.map((caseId) => caseById.get(caseId));
  const companySplits = new Map();
  for (const testCase of eligibleCases) {
    const splits = companySplits.get(testCase?.companyId) ?? new Set();
    if (testCase?.split) splits.add(testCase.split);
    companySplits.set(testCase?.companyId, splits);
  }
  const duplicateDocumentHashes = [
    ...eligibleCases.reduce((groups, testCase) => {
      const hash = normalizedHash(testCase?.documentHash);
      const ids = groups.get(hash) ?? [];
      ids.push(testCase?.id);
      groups.set(hash, ids);
      return groups;
    }, new Map()),
  ].filter(([hash, ids]) => hash && ids.length > 1);
  const splitViolatingCompanies = [...companySplits]
    .filter(([companyId, splits]) => companyId && splits.size > 1)
    .map(([companyId]) => companyId);
  const eligibleCompanyIds = new Set(
    eligibleCases.map((testCase) => testCase?.companyId).filter(Boolean),
  );
  const lockedTestCompanyIds = new Set(
    eligibleCases
      .filter((testCase) => testCase?.split === "lockedTest")
      .map((testCase) => testCase?.companyId)
      .filter(Boolean),
  );
  const report = {
    schemaVersion: 1,
    corpusVersion: corpus.corpusVersion,
    datasetKind: corpus.datasetKind ?? "expert",
    rulesetVersion: corpus.rulesetVersion,
    legalAsOfDate: corpus.legalAsOfDate,
    caseCount: corpus.cases.length,
    metricEligibleExpertCaseCount: eligibleCases.length,
    modeCount: modes.length,
    ruleCount: ruleIds.length,
    analysisRunCount: analysisRuns.length,
    supportPolicy,
    metrics,
    confidenceIntervals,
    special: overallSpecial.special,
    evidence: overallSpecial.evidence,
    bySplit,
    agreement,
    sampleIntegrity: {
      distinctCompanyCount: eligibleCompanyIds.size,
      distinctSectorCount: new Set(
        eligibleCases.map((testCase) => testCase?.sector).filter(Boolean),
      ).size,
      distinctDocumentCount: new Set(
        eligibleCases
          .map((testCase) => normalizedHash(testCase?.documentHash))
          .filter(Boolean),
      ).size,
      lockedTestCaseCount: eligibleCases.filter(
        (testCase) => testCase?.split === "lockedTest",
      ).length,
      lockedTestCompanyCount: lockedTestCompanyIds.size,
      lockedTestFraction: ratio(
        lockedTestCompanyIds.size,
        eligibleCompanyIds.size,
      ),
      splitViolatingCompanies,
      duplicateDocumentHashes: duplicateDocumentHashes.map(([hash, ids]) => ({
        hash,
        caseIds: ids,
      })),
      missingCompanyIds: eligibleCases
        .filter((testCase) => !testCase?.companyId)
        .map((testCase) => testCase?.id),
      missingSectors: eligibleCases
        .filter((testCase) => !testCase?.sector)
        .map((testCase) => testCase?.id),
      missingSplits: eligibleCases
        .filter((testCase) => !testCase?.split)
        .map((testCase) => testCase?.id),
    },
    unknownFindingIds: [...unknownFindingIds].sort(),
    rows,
    validation: {
      warnings: validation.warnings,
      missingGoldItemCount: validation.missingGoldKeys.length,
      expertAdjudicatedGoldItemCount: expertGold.length,
      metricEligibleGoldItemCount: metricGold.length,
      guardrailOnlyGoldItemCount: expertGold.length - metricGold.length,
      excludedGoldItemCount: corpus.gold.length - expertGold.length,
    },
  };
  report.gate = evaluateGate(corpus, report, validation);
  return report;
}
