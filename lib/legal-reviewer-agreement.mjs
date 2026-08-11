const APPLICABILITY = Object.freeze([
  "applicable",
  "notApplicable",
  "unknown",
]);

const GOLD_LABELS = Object.freeze([
  "confirmed_disclosure",
  "possible_missing_disclosure",
  "ambiguity_or_inconsistency",
  "factual_verification",
  "insufficient_evidence",
]);

export const LEGAL_REVIEW_SEVERITY_ORDER = Object.freeze([
  "pass",
  "low",
  "medium",
  "high",
]);

const EVIDENCE_SUPPORT = new Set(["direct", "partial", "none"]);
const NA_STRINGS = new Set(["na", "n/a", "not_applicable"]);

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function stableMean(values) {
  if (values.length === 0) return null;
  return [...values].sort((left, right) => left - right).reduce(
    (sum, value) => sum + value,
    0,
  ) / values.length;
}

function normalizedTrack(value) {
  if (value === "policyOnly") return "policy_only";
  if (value === "contextAssisted") return "context_assisted";
  return value;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isBlindIndependentReviewer(side) {
  return (
    side?.reviewMode?.independent === true &&
    side?.reviewMode?.blindToSystemOutput === true &&
    side?.reviewMode?.systemOutputViewed === false
  );
}

function preparePair(pair) {
  if (!pair || typeof pair !== "object" || Array.isArray(pair)) return null;
  const { left, right } = pair;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return null;
  }
  if (
    !isNonEmptyString(pair.caseId) ||
    !isNonEmptyString(pair.ruleId) ||
    !["policy_only", "context_assisted"].includes(normalizedTrack(pair.track)) ||
    !isNonEmptyString(left.reviewerId) ||
    !isNonEmptyString(right.reviewerId) ||
    left.reviewerId === right.reviewerId ||
    !isBlindIndependentReviewer(left) ||
    !isBlindIndependentReviewer(right) ||
    !left.decision ||
    typeof left.decision !== "object" ||
    Array.isArray(left.decision) ||
    !right.decision ||
    typeof right.decision !== "object" ||
    Array.isArray(right.decision)
  ) {
    return null;
  }

  for (const side of [left, right]) {
    if (
      (side.caseId !== undefined && side.caseId !== pair.caseId) ||
      (side.ruleId !== undefined && side.ruleId !== pair.ruleId) ||
      (side.track !== undefined &&
        normalizedTrack(side.track) !== normalizedTrack(pair.track))
    ) {
      return null;
    }
  }
  const reviewers = [left.reviewerId, right.reviewerId].sort();
  return {
    left,
    right,
    pairKey: JSON.stringify([
      pair.caseId,
      pair.ruleId,
      normalizedTrack(pair.track),
      ...reviewers,
    ]),
  };
}

function emptyExclusions(incompletePairCount) {
  return {
    incompletePair: incompletePairCount,
    missingValue: 0,
    notApplicableValue: 0,
    invalidValue: 0,
    applicabilityMismatch: 0,
    naMismatch: 0,
  };
}

function excludedPairCount(exclusions) {
  return Object.values(exclusions).reduce((sum, count) => sum + count, 0);
}

function statusForKappa(includedPairCount, categoryCount, expectedAgreement) {
  if (includedPairCount < 2) return "unavailable_insufficient_pairs";
  if (categoryCount < 2 || expectedAgreement === 1) {
    return "unavailable_single_category";
  }
  return "ok";
}

function classifyNominal(value, allowedValues, allowOpenVocabulary = false) {
  if (value === undefined || value === null || value === "") {
    return { status: "missing" };
  }
  if (typeof value === "string" && NA_STRINGS.has(value.trim().toLowerCase())) {
    return { status: "na" };
  }
  if (allowOpenVocabulary) {
    return isNonEmptyString(value)
      ? { status: "ok", value: value.trim() }
      : { status: "invalid" };
  }
  return allowedValues.includes(value)
    ? { status: "ok", value }
    : { status: "invalid" };
}

function addClassificationExclusion(exclusions, left, right) {
  const statuses = new Set([left.status, right.status]);
  if (statuses.has("invalid")) exclusions.invalidValue += 1;
  else if (statuses.has("na")) exclusions.notApplicableValue += 1;
  else exclusions.missingValue += 1;
}

function finalizeNominalAgreement(values, exclusions, metric = "nominal_cohen_kappa") {
  const categories = [...new Set(values.flat())].sort();
  const observedAgreement = ratio(
    values.filter(([left, right]) => left === right).length,
    values.length,
  );
  const expectedAgreement = values.length
    ? categories.reduce((sum, category) => {
        const leftRate =
          values.filter(([left]) => left === category).length / values.length;
        const rightRate =
          values.filter(([, right]) => right === category).length / values.length;
        return sum + leftRate * rightRate;
      }, 0)
    : null;
  const status = statusForKappa(
    values.length,
    categories.length,
    expectedAgreement,
  );

  return {
    metric,
    status,
    includedPairCount: values.length,
    excludedPairCount: excludedPairCount(exclusions),
    exclusions,
    categoryCount: categories.length,
    categories,
    observedAgreement,
    expectedAgreement,
    cohenKappa:
      status === "ok"
        ? (observedAgreement - expectedAgreement) / (1 - expectedAgreement)
        : null,
  };
}

function nominalAgreement(preparedPairs, field, allowedValues, allowOpenVocabulary) {
  const incompletePairCount = preparedPairs.filter((pair) => pair === null).length;
  const exclusions = emptyExclusions(incompletePairCount);
  const values = [];

  for (const pair of preparedPairs) {
    if (!pair) continue;
    const left = classifyNominal(
      pair.left.decision[field],
      allowedValues,
      allowOpenVocabulary,
    );
    const right = classifyNominal(
      pair.right.decision[field],
      allowedValues,
      allowOpenVocabulary,
    );
    if (left.status !== "ok" || right.status !== "ok") {
      addClassificationExclusion(exclusions, left, right);
      continue;
    }
    values.push([left.value, right.value]);
  }
  return finalizeNominalAgreement(values, exclusions);
}

function operationalOutcome(decision) {
  const applicability = classifyNominal(
    decision.applicability,
    APPLICABILITY,
  );
  if (applicability.status !== "ok") return applicability;
  if (applicability.value !== "applicable") return applicability;
  return classifyNominal(decision.goldLabel, GOLD_LABELS);
}

function operationalOutcomeAgreement(preparedPairs) {
  const incompletePairCount = preparedPairs.filter((pair) => pair === null).length;
  const exclusions = emptyExclusions(incompletePairCount);
  const values = [];
  for (const pair of preparedPairs) {
    if (!pair) continue;
    const left = operationalOutcome(pair.left.decision);
    const right = operationalOutcome(pair.right.decision);
    if (left.status !== "ok" || right.status !== "ok") {
      addClassificationExclusion(exclusions, left, right);
      continue;
    }
    values.push([left.value, right.value]);
  }
  return finalizeNominalAgreement(
    values,
    exclusions,
    "operational_outcome_cohen_kappa",
  );
}

function applicableGoldLabelAgreement(preparedPairs) {
  const incompletePairCount = preparedPairs.filter((pair) => pair === null).length;
  const exclusions = emptyExclusions(incompletePairCount);
  const values = [];
  for (const pair of preparedPairs) {
    if (!pair) continue;
    const leftApplicability = classifyNominal(
      pair.left.decision.applicability,
      APPLICABILITY,
    );
    const rightApplicability = classifyNominal(
      pair.right.decision.applicability,
      APPLICABILITY,
    );
    if (leftApplicability.status !== "ok" || rightApplicability.status !== "ok") {
      addClassificationExclusion(exclusions, leftApplicability, rightApplicability);
      continue;
    }
    const leftApplicable = leftApplicability.value === "applicable";
    const rightApplicable = rightApplicability.value === "applicable";
    if (leftApplicable !== rightApplicable) {
      exclusions.applicabilityMismatch += 1;
      continue;
    }
    if (!leftApplicable) {
      exclusions.notApplicableValue += 1;
      continue;
    }
    const left = classifyNominal(pair.left.decision.goldLabel, GOLD_LABELS);
    const right = classifyNominal(pair.right.decision.goldLabel, GOLD_LABELS);
    if (left.status !== "ok" || right.status !== "ok") {
      addClassificationExclusion(exclusions, left, right);
      continue;
    }
    values.push([left.value, right.value]);
  }
  return finalizeNominalAgreement(values, exclusions);
}

function applicabilityMismatchReport(preparedPairs) {
  let comparablePairCount = 0;
  let mismatchCount = 0;
  let oneSidedApplicableMismatchCount = 0;
  let invalidOrMissingPairCount = preparedPairs.filter(
    (pair) => pair === null,
  ).length;
  for (const pair of preparedPairs) {
    if (!pair) continue;
    const left = classifyNominal(pair.left.decision.applicability, APPLICABILITY);
    const right = classifyNominal(pair.right.decision.applicability, APPLICABILITY);
    if (left.status !== "ok" || right.status !== "ok") {
      invalidOrMissingPairCount += 1;
      continue;
    }
    comparablePairCount += 1;
    if (left.value !== right.value) mismatchCount += 1;
    if (
      (left.value === "applicable") !== (right.value === "applicable")
    ) {
      oneSidedApplicableMismatchCount += 1;
    }
  }
  return {
    comparablePairCount,
    mismatchCount,
    mismatchRate: ratio(mismatchCount, comparablePairCount),
    oneSidedApplicableMismatchCount,
    invalidOrMissingPairCount,
  };
}

function severityAgreement(preparedPairs) {
  const incompletePairCount = preparedPairs.filter((pair) => pair === null).length;
  const exclusions = emptyExclusions(incompletePairCount);
  const values = [];

  for (const pair of preparedPairs) {
    if (!pair) continue;
    const leftApplicability = classifyNominal(
      pair.left.decision.applicability,
      APPLICABILITY,
    );
    const rightApplicability = classifyNominal(
      pair.right.decision.applicability,
      APPLICABILITY,
    );
    if (leftApplicability.status !== "ok" || rightApplicability.status !== "ok") {
      addClassificationExclusion(exclusions, leftApplicability, rightApplicability);
      continue;
    }
    const leftApplicable = leftApplicability.value === "applicable";
    const rightApplicable = rightApplicability.value === "applicable";
    if (leftApplicable !== rightApplicable) {
      exclusions.applicabilityMismatch += 1;
      continue;
    }
    if (!leftApplicable) {
      exclusions.notApplicableValue += 1;
      continue;
    }
    const left = classifyNominal(
      pair.left.decision.severity,
      LEGAL_REVIEW_SEVERITY_ORDER,
    );
    const right = classifyNominal(
      pair.right.decision.severity,
      LEGAL_REVIEW_SEVERITY_ORDER,
    );
    if (left.status !== "ok" || right.status !== "ok") {
      const statuses = new Set([left.status, right.status]);
      if (statuses.has("invalid")) exclusions.invalidValue += 1;
      else exclusions.missingValue += 1;
      if (statuses.has("na") && statuses.has("ok")) {
        exclusions.missingValue -= 1;
        exclusions.naMismatch += 1;
      } else if (statuses.size === 1 && statuses.has("na")) {
        exclusions.missingValue -= 1;
        exclusions.notApplicableValue += 1;
      }
      continue;
    }
    values.push([left.value, right.value]);
  }

  const categoryIndex = new Map(
    LEGAL_REVIEW_SEVERITY_ORDER.map((category, index) => [category, index]),
  );
  const maximumDistance = LEGAL_REVIEW_SEVERITY_ORDER.length - 1;
  const weight = (left, right) =>
    1 -
    Math.abs(categoryIndex.get(left) - categoryIndex.get(right)) /
      maximumDistance;
  const observedWeightedAgreement = stableMean(
    values.map(([left, right]) => weight(left, right)),
  );
  const exactAgreementRate = ratio(
    values.filter(([left, right]) => left === right).length,
    values.length,
  );
  const expectedWeightedAgreement = values.length
    ? LEGAL_REVIEW_SEVERITY_ORDER.reduce((outer, leftCategory) => {
        const leftRate =
          values.filter(([left]) => left === leftCategory).length / values.length;
        return (
          outer +
          LEGAL_REVIEW_SEVERITY_ORDER.reduce((inner, rightCategory) => {
            const rightRate =
              values.filter(([, right]) => right === rightCategory).length /
              values.length;
            return inner + leftRate * rightRate * weight(leftCategory, rightCategory);
          }, 0)
        );
      }, 0)
    : null;
  const observedCategories = new Set(values.flat()).size;
  const status = statusForKappa(
    values.length,
    observedCategories,
    expectedWeightedAgreement,
  );

  return {
    metric: "linear_weighted_cohen_kappa",
    status,
    categoryOrder: [...LEGAL_REVIEW_SEVERITY_ORDER],
    includedPairCount: values.length,
    excludedPairCount: excludedPairCount(exclusions),
    exclusions,
    naMismatchCount: exclusions.naMismatch,
    observedCategoryCount: observedCategories,
    exactAgreementRate,
    observedWeightedAgreement,
    expectedWeightedAgreement,
    linearWeightedKappa:
      status === "ok"
        ? (observedWeightedAgreement - expectedWeightedAgreement) /
          (1 - expectedWeightedAgreement)
        : null,
  };
}

function sortedUniqueStrings(values) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => !isNonEmptyString(value))
  ) {
    return null;
  }
  return [...new Set(values.map((value) => value.trim()))].sort();
}

function canonicalEvidence(value) {
  if (!Array.isArray(value)) {
    return { status: "missing" };
  }
  if (value.length === 0) {
    return { status: "ok", exact: [], structural: [], spans: [] };
  }
  const exact = [];
  const structural = [];
  const spans = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { status: "invalid" };
    }
    if (entry.kind === "span") {
      if (
        !isNonEmptyString(entry.quote) ||
        !Number.isInteger(entry.start) ||
        !Number.isInteger(entry.end) ||
        entry.start < 0 ||
        entry.end <= entry.start ||
        !EVIDENCE_SUPPORT.has(entry.support)
      ) {
        return { status: "invalid" };
      }
      exact.push(
        JSON.stringify({
          kind: "span",
          quote: entry.quote,
          start: entry.start,
          end: entry.end,
          support: entry.support,
        }),
      );
      structural.push(`span:${entry.support}`);
      spans.push({
        quote: entry.quote.normalize("NFC").replace(/\s+/g, " ").trim(),
        start: entry.start,
        end: entry.end,
        support: entry.support,
      });
      continue;
    }
    if (entry.kind === "absence_trace") {
      const checkedSections = sortedUniqueStrings(entry.checkedSections);
      const checkedFields = sortedUniqueStrings(entry.checkedFields);
      if (
        !checkedSections ||
        !checkedFields ||
        !EVIDENCE_SUPPORT.has(entry.support)
      ) {
        return { status: "invalid" };
      }
      exact.push(
        JSON.stringify({
          kind: "absence_trace",
          checkedSections,
          checkedFields,
          support: entry.support,
        }),
      );
      structural.push(`absence_trace:${entry.support}`);
      continue;
    }
    return { status: "invalid" };
  }
  return {
    status: "ok",
    exact: [...new Set(exact)].sort(),
    structural: [...new Set(structural)].sort(),
    spans,
  };
}

function spanSimilarity(left, right) {
  const intersection = Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
  const offsetF1 = ratio(
    2 * intersection,
    left.end - left.start + right.end - right.start,
  );
  return Math.max(left.quote === right.quote ? 1 : 0, offsetF1 ?? 0);
}

function maximumWeightSpanMatching(left, right) {
  const size = Math.max(left.length, right.length);
  if (size === 0) return [];
  const weights = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) =>
      row < left.length && column < right.length
        ? spanSimilarity(left[row], right[column])
        : 0,
    ),
  );
  const u = Array(size + 1).fill(0);
  const v = Array(size + 1).fill(0);
  const p = Array(size + 1).fill(0);
  const way = Array(size + 1).fill(0);
  for (let row = 1; row <= size; row += 1) {
    p[0] = row;
    let column0 = 0;
    const min = Array(size + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array(size + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = p[column0];
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= size; column += 1) {
        if (used[column]) continue;
        const cost = 1 - weights[row0 - 1][column - 1] - u[row0] - v[column];
        if (cost < min[column]) {
          min[column] = cost;
          way[column] = column0;
        }
        if (min[column] < delta) {
          delta = min[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= size; column += 1) {
        if (used[column]) {
          u[p[column]] += delta;
          v[column] -= delta;
        } else {
          min[column] -= delta;
        }
      }
      column0 = column1;
    } while (p[column0] !== 0);
    do {
      const column1 = way[column0];
      p[column0] = p[column1];
      column0 = column1;
    } while (column0 !== 0);
  }
  const matches = [];
  for (let column = 1; column <= size; column += 1) {
    const row = p[column] - 1;
    const rightIndex = column - 1;
    if (row < left.length && rightIndex < right.length) {
      const score = weights[row][rightIndex];
      if (score > 0) matches.push({ left: row, right: rightIndex, score });
    }
  }
  return matches;
}

function evidenceAgreement(preparedPairs) {
  const incompletePairCount = preparedPairs.filter((pair) => pair === null).length;
  const exclusions = emptyExclusions(incompletePairCount);
  const results = [];
  const spanResults = [];
  for (const pair of preparedPairs) {
    if (!pair) continue;
    const left = canonicalEvidence(pair.left.decision.evidence);
    const right = canonicalEvidence(pair.right.decision.evidence);
    if (left.status !== "ok" || right.status !== "ok") {
      if (left.status === "invalid" || right.status === "invalid") {
        exclusions.invalidValue += 1;
      } else {
        exclusions.missingValue += 1;
      }
      continue;
    }
    const spanMatches = maximumWeightSpanMatching(left.spans, right.spans);
    if (left.spans.length + right.spans.length > 0) {
      spanResults.push({
        leftCount: left.spans.length,
        rightCount: right.spans.length,
        weight: spanMatches.reduce((sum, match) => sum + match.score, 0),
        supportAgreements: spanMatches.filter(
          (match) =>
            left.spans[match.left].support === right.spans[match.right].support,
        ).length,
        matchedCount: spanMatches.length,
      });
    }
    results.push({
      bothEmpty: left.exact.length === 0 && right.exact.length === 0,
      oneSidedEmpty: (left.exact.length === 0) !== (right.exact.length === 0),
      exact: JSON.stringify(left.exact) === JSON.stringify(right.exact),
      structural:
        JSON.stringify(left.structural) === JSON.stringify(right.structural),
    });
  }
  const status =
    results.length >= 2 ? "ok" : "unavailable_insufficient_pairs";
  const totalLeftSpans = spanResults.reduce(
    (sum, result) => sum + result.leftCount,
    0,
  );
  const totalRightSpans = spanResults.reduce(
    (sum, result) => sum + result.rightCount,
    0,
  );
  const totalSpanWeight = spanResults.reduce(
    (sum, result) => sum + result.weight,
    0,
  );
  const matchedSpanCount = spanResults.reduce(
    (sum, result) => sum + result.matchedCount,
    0,
  );
  return {
    metric: "evidence_grounding_agreement",
    status,
    includedPairCount: results.length,
    excludedPairCount: excludedPairCount(exclusions),
    exclusions,
    emptyEvidencePairCount: results.filter((result) => result.bothEmpty).length,
    oneSidedEmptyEvidencePairCount: results.filter(
      (result) => result.oneSidedEmpty,
    ).length,
    exactAgreementRate: ratio(
      results.filter((result) => result.exact).length,
      results.length,
    ),
    structuralAgreementRate: ratio(
      results.filter((result) => result.structural).length,
      results.length,
    ),
    spanDiagnostics: {
      comparablePairCount: spanResults.length,
      matchedSpanCount,
      spanOverlapF1: ratio(
        2 * totalSpanWeight,
        totalLeftSpans + totalRightSpans,
      ),
      meanPairSpanOverlapF1: stableMean(
        spanResults.map((result) =>
          ratio(
            2 * result.weight,
            result.leftCount + result.rightCount,
          ),
        ),
      ),
      supportAgreementRate: ratio(
        spanResults.reduce(
          (sum, result) => sum + result.supportAgreements,
          0,
        ),
        matchedSpanCount,
      ),
    },
  };
}

function canonicalLegalBases(value) {
  if (!Array.isArray(value)) {
    return { status: "missing" };
  }
  const keys = [];
  const diagnostics = new Map();
  for (const basis of value) {
    if (
      !basis ||
      typeof basis !== "object" ||
      Array.isArray(basis) ||
      !isNonEmptyString(basis.sourceId) ||
      !isNonEmptyString(basis.article) ||
      !isNonEmptyString(basis.url) ||
      !["direct", "contextual", "incorrect"].includes(basis.fit)
    ) {
      return { status: "invalid" };
    }
    const identity = JSON.stringify([
      basis.sourceId.trim(),
      basis.article.trim(),
    ]);
    keys.push(identity);
    const diagnostic = diagnostics.get(identity) ?? {
      urls: new Set(),
      fits: new Set(),
    };
    diagnostic.urls.add(basis.url.trim());
    diagnostic.fits.add(basis.fit);
    diagnostics.set(identity, diagnostic);
  }
  return { status: "ok", values: new Set(keys), diagnostics };
}

function canonicalDefectCodes(value) {
  if (!Array.isArray(value)) return { status: "missing" };
  if (value.some((code) => !isNonEmptyString(code))) {
    return { status: "invalid" };
  }
  return {
    status: "ok",
    values: new Set(value.map((code) => code.trim())),
  };
}

function setAgreement(preparedPairs, field, canonicalize, metric) {
  const incompletePairCount = preparedPairs.filter((pair) => pair === null).length;
  const exclusions = emptyExclusions(incompletePairCount);
  const results = [];
  for (const pair of preparedPairs) {
    if (!pair) continue;
    const left = canonicalize(pair.left.decision[field]);
    const right = canonicalize(pair.right.decision[field]);
    if (left.status !== "ok" || right.status !== "ok") {
      if (left.status === "invalid" || right.status === "invalid") {
        exclusions.invalidValue += 1;
      } else {
        exclusions.missingValue += 1;
      }
      continue;
    }
    const intersectionSize = [...left.values].filter((value) =>
      right.values.has(value),
    ).length;
    const unionSize = new Set([...left.values, ...right.values]).size;
    results.push({
      bothEmpty: left.values.size === 0 && right.values.size === 0,
      oneSidedEmpty: (left.values.size === 0) !== (right.values.size === 0),
      exact:
        left.values.size === right.values.size &&
        intersectionSize === left.values.size,
      jaccard: unionSize === 0 ? 1 : intersectionSize / unionSize,
      intersectionSize,
      leftSize: left.values.size,
      rightSize: right.values.size,
      unionSize,
      left,
      right,
    });
  }
  const status =
    results.length >= 2 ? "ok" : "unavailable_insufficient_pairs";
  const nonEmptyResults = results.filter((result) => result.unionSize > 0);
  const pooledIntersectionCount = results.reduce(
    (sum, result) => sum + result.intersectionSize,
    0,
  );
  const pooledLeftItemCount = results.reduce(
    (sum, result) => sum + result.leftSize,
    0,
  );
  const pooledRightItemCount = results.reduce(
    (sum, result) => sum + result.rightSize,
    0,
  );
  return {
    metric,
    status,
    includedPairCount: results.length,
    excludedPairCount: excludedPairCount(exclusions),
    exclusions,
    emptyPairCount: results.filter((result) => result.bothEmpty).length,
    oneSidedEmptyPairCount: results.filter((result) => result.oneSidedEmpty)
      .length,
    exactAgreementRate: ratio(
      results.filter((result) => result.exact).length,
      results.length,
    ),
    meanJaccard: stableMean(results.map((result) => result.jaccard)),
    nonEmptyPairCount: nonEmptyResults.length,
    nonEmptyMeanJaccard: stableMean(
      nonEmptyResults.map((result) => result.jaccard),
    ),
    pooledIntersectionCount,
    pooledLeftItemCount,
    pooledRightItemCount,
    pooledSetF1: ratio(
      2 * pooledIntersectionCount,
      pooledLeftItemCount + pooledRightItemCount,
    ),
    _pairDiagnostics: results,
  };
}

function defectCodeAgreement(preparedPairs) {
  const report = setAgreement(
    preparedPairs,
    "defectCodes",
    canonicalDefectCodes,
    "defect_code_set_agreement",
  );
  delete report._pairDiagnostics;
  return report;
}

function legalBasisAgreement(preparedPairs) {
  const report = setAgreement(
    preparedPairs,
    "legalBases",
    canonicalLegalBases,
    "legal_basis_set_agreement",
  );
  let matchedCitationCount = 0;
  let urlAgreementCount = 0;
  let fitAgreementCount = 0;
  let metadataExactAgreementCount = 0;
  for (const result of report._pairDiagnostics) {
    for (const identity of result.left.values) {
      if (!result.right.values.has(identity)) continue;
      matchedCitationCount += 1;
      const left = result.left.diagnostics.get(identity);
      const right = result.right.diagnostics.get(identity);
      const sameUrls =
        JSON.stringify([...left.urls].sort()) ===
        JSON.stringify([...right.urls].sort());
      const sameFits =
        JSON.stringify([...left.fits].sort()) ===
        JSON.stringify([...right.fits].sort());
      if (sameUrls) urlAgreementCount += 1;
      if (sameFits) fitAgreementCount += 1;
      if (sameUrls && sameFits) metadataExactAgreementCount += 1;
    }
  }
  delete report._pairDiagnostics;
  return {
    ...report,
    matchedCitationDiagnostics: {
      matchedCitationCount,
      urlAgreementRate: ratio(urlAgreementCount, matchedCitationCount),
      fitAgreementRate: ratio(fitAgreementCount, matchedCitationCount),
      metadataExactAgreementRate: ratio(
        metadataExactAgreementCount,
        matchedCitationCount,
      ),
    },
  };
}

/**
 * Compute fail-closed field-level agreement for already paired independent
 * legal-review annotations.
 *
 * Each input item must have this shape:
 * `{ caseId, ruleId, track, left, right }`. `left` and `right` require distinct
 * `reviewerId` values, a review mode proving independent blind review, and a
 * `decision` object. If a side repeats
 * case/rule/track fields, they must match the outer pair. Tracks may use the
 * contract (`policyOnly`, `contextAssisted`) or evaluator snake-case spelling.
 *
 * Missing, explicit NA, malformed, or structurally incomplete pairs never
 * count as agreement. They are excluded per field and reported by reason.
 * Nominal and weighted kappa remain null for fewer than two usable pairs or a
 * single observed category. Evidence exact agreement compares canonical full
 * span/absence-trace sets; structural agreement compares grounding kind and
 * support. Empty evidence arrays are valid comparisons, including one-sided
 * empty disagreements. Defect-code and legal-basis comparisons are
 * order-independent set comparisons. Legal-basis identity is
 * `(sourceId, article)` while URL and fit are separate matched-citation
 * diagnostics. Empty-set Jaccard is defined as 1.
 *
 * @param {Array<{
 *   caseId: string,
 *   ruleId: string,
 *   track: "policyOnly"|"contextAssisted"|"policy_only"|"context_assisted",
 *   left: { reviewerId: string, reviewMode: { independent: true, blindToSystemOutput: true, systemOutputViewed: false }, decision: object },
 *   right: { reviewerId: string, reviewMode: { independent: true, blindToSystemOutput: true, systemOutputViewed: false }, decision: object }
 * }>} pairs
 * @param {{ expectedPairCount?: number }} [options] Expected matrix size. Any
 * incomplete, duplicate, missing, or excess coverage makes overall status
 * unavailable.
 * @returns {object} Deterministic aggregate metrics without reviewer IDs or
 * source evidence content.
 */
export function computeLegalReviewerFieldAgreement(pairs, options = {}) {
  if (!Array.isArray(pairs)) {
    throw new TypeError("pairs must be an array of independent reviewer pairs");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options must be an object");
  }
  if (
    options.expectedPairCount !== undefined &&
    (!Number.isInteger(options.expectedPairCount) || options.expectedPairCount < 0)
  ) {
    throw new TypeError("expectedPairCount must be a non-negative integer");
  }
  const initiallyPrepared = pairs.map(preparePair);
  const invalidPairCount = initiallyPrepared.filter((pair) => pair === null).length;
  const seenPairKeys = new Set();
  let duplicatePairCount = 0;
  const preparedPairs = initiallyPrepared.map((pair) => {
    if (!pair) return null;
    if (seenPairKeys.has(pair.pairKey)) {
      duplicatePairCount += 1;
      return null;
    }
    seenPairKeys.add(pair.pairKey);
    return pair;
  });
  const completePairCount = preparedPairs.filter(Boolean).length;
  const expectedPairCount = options.expectedPairCount ?? null;
  const coverageExpected = expectedPairCount ?? pairs.length;
  const completeCoverage =
    completePairCount === coverageExpected &&
    pairs.length === coverageExpected &&
    invalidPairCount === 0 &&
    duplicatePairCount === 0;
  const coverage = {
    expectedPairCount,
    providedPairCount: pairs.length,
    completePairCount,
    invalidPairCount,
    duplicatePairCount,
    incompletePairCount: invalidPairCount + duplicatePairCount,
    missingPairCount: Math.max(coverageExpected - completePairCount, 0),
    excessPairCount: Math.max(pairs.length - coverageExpected, 0),
    coverageRate:
      coverageExpected === 0
        ? completePairCount === 0
          ? 1
          : 0
        : Math.min(completePairCount, coverageExpected) / coverageExpected,
    complete: completeCoverage,
  };
  const fields = {
    applicability: nominalAgreement(
      preparedPairs,
      "applicability",
      APPLICABILITY,
      false,
    ),
    operationalOutcome: operationalOutcomeAgreement(preparedPairs),
    goldLabel: applicableGoldLabelAgreement(preparedPairs),
    requiresFactualVerification: nominalAgreement(
      preparedPairs,
      "requiresFactualVerification",
      [true, false],
      false,
    ),
    severity: severityAgreement(preparedPairs),
  };
  const evidenceGrounding = evidenceAgreement(preparedPairs);
  const defectCodes = defectCodeAgreement(preparedPairs);
  const legalBases = legalBasisAgreement(preparedPairs);
  const applicabilityMismatch = applicabilityMismatchReport(preparedPairs);
  const unavailableFields = [
    ...Object.entries(fields),
    ["evidenceGrounding", evidenceGrounding],
    ["defectCodes", defectCodes],
    ["legalBases", legalBases],
  ]
    .filter(([, metric]) => metric.status !== "ok")
    .map(([field]) => field);

  return {
    schemaVersion: 1,
    status:
      unavailableFields.length || !coverage.complete ? "unavailable" : "ok",
    pairCount: pairs.length,
    structurallyCompletePairCount: completePairCount,
    incompletePairCount: invalidPairCount + duplicatePairCount,
    invalidPairCount,
    duplicatePairCount,
    coverage,
    applicabilityMismatch,
    unavailableFields,
    fields,
    evidenceGrounding,
    defectCodes,
    legalBases,
  };
}
