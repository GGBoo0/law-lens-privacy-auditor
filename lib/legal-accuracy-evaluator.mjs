import { createHash } from "node:crypto";

import {
  LEGAL_ACCURACY_DECISIONS,
  LEGAL_ACCURACY_FINDING_MAP,
  LEGAL_ACCURACY_MODES,
  LEGAL_ACCURACY_OMISSION_RULE_IDS,
  LEGAL_ACCURACY_RULE_BY_ID,
  validateCanonicalRuleIds,
} from "./legal-accuracy-taxonomy.mjs";

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
  let unsafeHighEligibleCount = 0;
  let unsafeHighEscalationCount = 0;
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

    for (const finding of row.predictions) {
      strictEvidencePredictionCount += 1;
      if (typeof finding.evidence !== "string" || !finding.evidence.trim()) continue;
      documentEvidenceCount += 1;
      if (evidenceIsGrounded(finding.evidence, row.documentText)) {
        groundedEvidenceCount += 1;
      }
      if (
        row.goldDecision === "finding" &&
        evidenceIsGrounded(finding.evidence, row.documentText) &&
        row.evidenceAnchors.length > 0 &&
        evidenceMatchesAnchors(finding.evidence, row.evidenceAnchors)
      ) {
        strictEvidenceGroundedCount += 1;
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
      unsafeHighEscalation: {
        count: unsafeHighEscalationCount,
        support: unsafeHighEligibleCount,
        rate: ratio(unsafeHighEscalationCount, unsafeHighEligibleCount),
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

function thresholdFailure(failures, label, value, minimum) {
  if (minimum === undefined) return;
  if (value === null || value === undefined) {
    failures.push(`${label} is not calculable`);
  } else if (value < minimum) {
    failures.push(`${label} ${value.toFixed(4)} is below ${minimum}`);
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
  if (
    corpus.metrics?.confidenceIntervals?.implementationStatus !== "implemented"
  ) {
    failures.push(
      "confidence intervals must be implemented and validated before certification",
    );
  }
  if (corpus.review?.agreementMetrics?.fieldLevelAgreement !== "implemented") {
    failures.push(
      "field-level reviewer agreement must be implemented before certification",
    );
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
  const requiredThresholds = [
    "minMacroF1",
    "minHighStrictActionableRecall",
    "minStrictEvidenceGroundingRate",
    "minPossibleMissingPrecision",
    "maxUnsafeHighEscalationRate",
    "minCohenKappa",
  ];
  for (const threshold of requiredThresholds) {
    if (!Number.isFinite(thresholds[threshold])) {
      failures.push(`required enforced threshold is missing: ${threshold}`);
    }
  }
  thresholdFailure(failures, "locked-test micro precision", locked.metrics.micro.precision, thresholds.minMicroPrecision);
  thresholdFailure(failures, "locked-test micro recall", locked.metrics.micro.recall, thresholds.minMicroRecall);
  thresholdFailure(failures, "locked-test micro F1", locked.metrics.micro.f1, thresholds.minMicroF1);
  thresholdFailure(failures, "locked-test macro F1", locked.metrics.macro.f1, thresholds.minMacroF1);
  thresholdFailure(
    failures,
    "locked-test possible-missing precision",
    locked.special.possibleMissing.precision,
    thresholds.minPossibleMissingPrecision,
  );
  thresholdFailure(
    failures,
    "locked-test high strict/actionable recall",
    locked.special.highStrictActionable.recall,
    thresholds.minHighStrictActionableRecall,
  );
  thresholdFailure(
    failures,
    "locked-test strict evidence grounding rate",
    locked.evidence.strictEvidenceGroundingRate,
    thresholds.minStrictEvidenceGroundingRate ??
      thresholds.minEvidenceGroundingRate,
  );
  thresholdFailure(
    failures,
    "Cohen kappa",
    report.agreement.meanPairwiseKappa,
    thresholds.minCohenKappa,
  );
  if (
    Number.isFinite(thresholds.maxUnsafeHighEscalationRate) &&
    (locked.special.unsafeHighEscalation.rate === null ||
      locked.special.unsafeHighEscalation.rate >
        thresholds.maxUnsafeHighEscalationRate)
  ) {
    failures.push(
      `locked-test unsafe high escalation rate ${locked.special.unsafeHighEscalation.rate ?? "n/a"} exceeds ${thresholds.maxUnsafeHighEscalationRate}`,
    );
  }
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
    thresholdFailure(
      failures,
      `locked-test ${track} macro F1`,
      trackMetrics.macro.f1,
      thresholds.minMacroF1,
    );
    const trackSpecial = locked.byMode[track];
    thresholdFailure(
      failures,
      `locked-test ${track} possible-missing precision`,
      trackSpecial.special.possibleMissing.precision,
      thresholds.minPossibleMissingPrecision,
    );
    thresholdFailure(
      failures,
      `locked-test ${track} high strict/actionable recall`,
      trackSpecial.special.highStrictActionable.recall,
      thresholds.minHighStrictActionableRecall,
    );
    thresholdFailure(
      failures,
      `locked-test ${track} strict evidence grounding rate`,
      trackSpecial.evidence.strictEvidenceGroundingRate,
      thresholds.minStrictEvidenceGroundingRate,
    );
    thresholdFailure(
      failures,
      `locked-test ${track} Cohen kappa`,
      report.agreement.byMode[track]?.meanPairwiseKappa,
      thresholds.minCohenKappa,
    );
    if (
      Number.isFinite(thresholds.maxUnsafeHighEscalationRate) &&
      (trackSpecial.special.unsafeHighEscalation.rate === null ||
        trackSpecial.special.unsafeHighEscalation.rate >
          thresholds.maxUnsafeHighEscalationRate)
    ) {
      failures.push(
        `locked-test ${track} unsafe high escalation rate ${trackSpecial.special.unsafeHighEscalation.rate ?? "n/a"} exceeds ${thresholds.maxUnsafeHighEscalationRate}`,
      );
    }
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
    special: overallSpecial.special,
    evidence: overallSpecial.evidence,
    bySplit,
    agreement,
    sampleIntegrity: {
      distinctCompanyCount: new Set(
        eligibleCases.map((testCase) => testCase?.companyId).filter(Boolean),
      ).size,
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
      lockedTestFraction: ratio(
        eligibleCases.filter((testCase) => testCase?.split === "lockedTest")
          .length,
        eligibleCases.length,
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
