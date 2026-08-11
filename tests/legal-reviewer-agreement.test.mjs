import assert from "node:assert/strict";
import test from "node:test";

import {
  computeLegalReviewerFieldAgreement,
  LEGAL_REVIEW_SEVERITY_ORDER,
} from "../lib/legal-reviewer-agreement.mjs";

const basis = (sourceId, article) => ({
  sourceId,
  article,
  url: `https://law.example/${sourceId}/${article}`,
  fit: "direct",
});

function reviewer(reviewerId, decision, extra = {}) {
  return {
    reviewerId,
    reviewMode: {
      independent: true,
      blindToSystemOutput: true,
      systemOutputViewed: false,
    },
    decision,
    ...extra,
  };
}

function pair(index, leftDecision, rightDecision, extra = {}) {
  return {
    caseId: `case-${index}`,
    ruleId: "third_party.disclosure",
    track: "policyOnly",
    left: reviewer("expert-a", leftDecision),
    right: reviewer("expert-b", rightDecision),
    ...extra,
  };
}

function decision(overrides = {}) {
  return {
    applicability: "applicable",
    goldLabel: "confirmed_disclosure",
    defectCodes: [],
    requiresFactualVerification: false,
    severity: "pass",
    evidence: [
      {
        kind: "span",
        quote: "개인정보를 처리합니다.",
        start: 0,
        end: 13,
        support: "direct",
      },
    ],
    legalBases: [basis("pipa", "30")],
    ...overrides,
  };
}

function approximately(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test("computes nominal Cohen kappa and linear-weighted severity kappa", () => {
  const pairs = [
    pair(1, decision(), decision()),
    pair(
      2,
      decision({ severity: "pass" }),
      decision({ severity: "low" }),
    ),
    pair(
      3,
      decision({
        goldLabel: "possible_missing_disclosure",
        defectCodes: ["missing_recipient"],
        requiresFactualVerification: true,
        severity: "high",
      }),
      decision({
        goldLabel: "possible_missing_disclosure",
        defectCodes: ["missing_recipient"],
        requiresFactualVerification: true,
        severity: "high",
      }),
    ),
    pair(
      4,
      decision({
        goldLabel: "possible_missing_disclosure",
        defectCodes: ["missing_recipient"],
        requiresFactualVerification: true,
        severity: "high",
      }),
      decision({ severity: "medium" }),
    ),
    pair(
      5,
      decision({ applicability: "unknown" }),
      decision({ applicability: "unknown" }),
    ),
    pair(
      6,
      decision({ applicability: "unknown" }),
      decision({ applicability: "notApplicable" }),
    ),
  ];

  const report = computeLegalReviewerFieldAgreement(pairs);
  assert.equal(report.status, "ok");
  assert.equal(report.fields.applicability.status, "ok");
  approximately(report.fields.applicability.cohenKappa, 2 / 3);
  assert.equal(report.fields.goldLabel.status, "ok");
  assert.equal(report.fields.goldLabel.cohenKappa, 0.5);
  assert.equal(report.fields.goldLabel.exclusions.notApplicableValue, 2);
  assert.equal(report.fields.operationalOutcome.status, "ok");
  approximately(report.fields.operationalOutcome.cohenKappa, 7 / 13);
  assert.equal(report.fields.requiresFactualVerification.status, "ok");
  assert.deepEqual(report.fields.severity.categoryOrder, [
    "pass",
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(
    report.fields.severity.categoryOrder,
    LEGAL_REVIEW_SEVERITY_ORDER,
  );
  approximately(report.fields.severity.exactAgreementRate, 0.5);
  approximately(report.fields.severity.observedWeightedAgreement, 5 / 6);
  approximately(report.fields.severity.expectedWeightedAgreement, 0.5);
  approximately(report.fields.severity.linearWeightedKappa, 2 / 3);
  assert.equal(report.fields.severity.exclusions.notApplicableValue, 2);
  assert.equal(report.applicabilityMismatch.mismatchCount, 1);
  assert.equal(report.applicabilityMismatch.oneSidedApplicableMismatchCount, 0);
  assert.equal(report.coverage.complete, true);
});

test("compares evidence grounding and legal-basis sets deterministically", () => {
  const sharedSpan = {
    kind: "span",
    quote: "제3자에게 제공합니다.",
    start: 10,
    end: 22,
    support: "direct",
  };
  const differentSpan = {
    kind: "span",
    quote: "수탁사에 전달합니다.",
    start: 30,
    end: 41,
    support: "direct",
  };
  const absenceLeft = {
    kind: "absence_trace",
    checkedSections: ["제3자 제공", "공유"],
    checkedFields: ["제공받는 자", "목적"],
    support: "direct",
  };
  const absenceRight = {
    kind: "absence_trace",
    checkedSections: ["공유", "제3자 제공"],
    checkedFields: ["목적", "제공받는 자"],
    support: "direct",
  };
  const a = basis("pipa", "30");
  const b = basis("decree", "31");
  const c = basis("notice", "4");
  const pairs = [
    pair(
      1,
      decision({
        evidence: [sharedSpan],
        legalBases: [a, b],
        defectCodes: ["missing_recipient", "missing_purpose"],
      }),
      decision({
        evidence: [sharedSpan],
        legalBases: [b, a],
        defectCodes: ["missing_purpose", "missing_recipient"],
      }),
    ),
    pair(
      2,
      decision({
        evidence: [sharedSpan],
        legalBases: [a, b],
        defectCodes: ["missing_recipient", "missing_purpose"],
      }),
      decision({
        evidence: [differentSpan],
        legalBases: [b, c],
        defectCodes: ["missing_purpose", "weak_detail"],
      }),
    ),
    pair(
      3,
      decision({ evidence: [absenceLeft], legalBases: [], defectCodes: [] }),
      decision({ evidence: [absenceRight], legalBases: [], defectCodes: [] }),
    ),
    pair(
      4,
      decision({ evidence: [], legalBases: [], defectCodes: [] }),
      decision({ evidence: [], legalBases: [], defectCodes: [] }),
    ),
    {
      caseId: "case-5",
      ruleId: "third_party.disclosure",
      track: "policyOnly",
      left: reviewer(
        "expert-a",
        decision({ evidence: [], legalBases: [], defectCodes: [] }),
      ),
      right: reviewer(
        "expert-b",
        decision({ defectCodes: ["missing_recipient"] }),
      ),
    },
    {
      caseId: "case-6",
      ruleId: "third_party.disclosure",
      track: "policyOnly",
      left: reviewer("expert-a", decision()),
      right: null,
    },
  ];
  const original = structuredClone(pairs);
  const report = computeLegalReviewerFieldAgreement(pairs);

  assert.equal(report.evidenceGrounding.status, "ok");
  assert.equal(report.evidenceGrounding.includedPairCount, 5);
  assert.equal(report.evidenceGrounding.exclusions.missingValue, 0);
  assert.equal(report.evidenceGrounding.exclusions.incompletePair, 1);
  assert.equal(report.evidenceGrounding.emptyEvidencePairCount, 1);
  assert.equal(report.evidenceGrounding.oneSidedEmptyEvidencePairCount, 1);
  approximately(report.evidenceGrounding.exactAgreementRate, 3 / 5);
  assert.equal(report.evidenceGrounding.structuralAgreementRate, 4 / 5);
  assert.equal(report.evidenceGrounding.spanDiagnostics.comparablePairCount, 3);
  assert.equal(report.evidenceGrounding.spanDiagnostics.matchedSpanCount, 1);
  assert.equal(report.evidenceGrounding.spanDiagnostics.spanOverlapF1, 2 / 5);
  approximately(
    report.evidenceGrounding.spanDiagnostics.meanPairSpanOverlapF1,
    1 / 3,
  );
  assert.equal(
    report.evidenceGrounding.spanDiagnostics.supportAgreementRate,
    1,
  );

  assert.equal(report.legalBases.status, "ok");
  assert.equal(report.legalBases.includedPairCount, 5);
  assert.equal(report.legalBases.exclusions.missingValue, 0);
  assert.equal(report.legalBases.exclusions.incompletePair, 1);
  assert.equal(report.legalBases.emptyPairCount, 2);
  assert.equal(report.legalBases.oneSidedEmptyPairCount, 1);
  assert.equal(report.legalBases.exactAgreementRate, 3 / 5);
  approximately(report.legalBases.meanJaccard, 2 / 3);
  assert.equal(report.legalBases.nonEmptyPairCount, 3);
  approximately(report.legalBases.nonEmptyMeanJaccard, 4 / 9);
  approximately(report.legalBases.pooledSetF1, 2 / 3);
  assert.equal(
    report.legalBases.matchedCitationDiagnostics.matchedCitationCount,
    3,
  );

  assert.equal(report.defectCodes.status, "ok");
  assert.equal(report.defectCodes.includedPairCount, 5);
  assert.equal(report.defectCodes.emptyPairCount, 2);
  assert.equal(report.defectCodes.oneSidedEmptyPairCount, 1);
  assert.equal(report.defectCodes.exactAgreementRate, 3 / 5);
  approximately(report.defectCodes.meanJaccard, 2 / 3);
  assert.equal(report.defectCodes.nonEmptyPairCount, 3);
  approximately(report.defectCodes.nonEmptyMeanJaccard, 4 / 9);
  approximately(report.defectCodes.pooledSetF1, 2 / 3);
  assert.deepEqual(pairs, original, "the helper must not mutate reviewer input");
  assert.deepEqual(
    computeLegalReviewerFieldAgreement([...pairs].reverse()),
    report,
    "aggregate output must not depend on pair order",
  );
});

test("fails closed for missing, NA, invalid, single-category, and incomplete pairs", () => {
  const pairs = [
    pair(1, decision(), decision()),
    pair(2, decision(), decision()),
    pair(
      3,
      decision({ severity: "na", evidence: [], legalBases: [] }),
      decision({ severity: "na", evidence: [], legalBases: [] }),
    ),
    pair(
      4,
      decision({ requiresFactualVerification: null }),
      decision({ requiresFactualVerification: null }),
    ),
    pair(
      5,
      decision({ applicability: "sometimes" }),
      decision({ applicability: "applicable" }),
    ),
    pair(6, decision(), decision(), {
      right: reviewer("expert-a", decision()),
    }),
  ];
  const report = computeLegalReviewerFieldAgreement(pairs);

  assert.equal(report.status, "unavailable");
  assert.ok(report.unavailableFields.includes("goldLabel"));
  assert.equal(
    report.fields.goldLabel.status,
    "unavailable_single_category",
  );
  assert.equal(report.fields.goldLabel.cohenKappa, null);
  assert.equal(report.fields.applicability.exclusions.invalidValue, 1);
  assert.equal(report.fields.applicability.exclusions.incompletePair, 1);
  assert.equal(
    report.fields.requiresFactualVerification.exclusions.missingValue,
    1,
  );
  assert.equal(report.fields.severity.exclusions.notApplicableValue, 1);
  assert.equal(report.incompletePairCount, 1);

  const empty = computeLegalReviewerFieldAgreement([]);
  assert.equal(empty.status, "unavailable");
  assert.equal(empty.fields.applicability.status, "unavailable_insufficient_pairs");
  assert.equal(empty.fields.applicability.cohenKappa, null);
  assert.equal(empty.evidenceGrounding.exactAgreementRate, null);
  assert.equal(empty.defectCodes.meanJaccard, null);
  assert.equal(empty.legalBases.meanJaccard, null);
  assert.throws(
    () => computeLegalReviewerFieldAgreement(null),
    /pairs must be an array/,
  );
});

test("reports applicability and NA mismatches without leaking them into conditional metrics", () => {
  const pairs = [
    pair(
      1,
      decision({ severity: "na" }),
      decision({ severity: "medium" }),
    ),
    pair(
      2,
      decision({ applicability: "applicable" }),
      decision({ applicability: "unknown" }),
    ),
  ];
  const report = computeLegalReviewerFieldAgreement(pairs);
  assert.equal(report.fields.severity.naMismatchCount, 1);
  assert.equal(report.fields.severity.exclusions.naMismatch, 1);
  assert.equal(report.fields.goldLabel.exclusions.applicabilityMismatch, 1);
  assert.equal(report.applicabilityMismatch.oneSidedApplicableMismatchCount, 1);
  assert.equal(report.fields.operationalOutcome.includedPairCount, 2);
});

test("uses optimal one-to-one span matching and enforces blind-review coverage", () => {
  const span = {
    kind: "span",
    quote: "동일 근거 문구",
    start: 4,
    end: 11,
    support: "direct",
  };
  const partialSpan = { ...span, support: "partial" };
  const pairs = [
    pair(
      1,
      decision({ evidence: [span, span] }),
      decision({ evidence: [span] }),
    ),
    pair(
      2,
      decision({ evidence: [span] }),
      decision({ evidence: [partialSpan] }),
    ),
  ];
  const report = computeLegalReviewerFieldAgreement(pairs, {
    expectedPairCount: 3,
  });
  assert.equal(report.evidenceGrounding.spanDiagnostics.matchedSpanCount, 2);
  approximately(report.evidenceGrounding.spanDiagnostics.spanOverlapF1, 4 / 5);
  approximately(
    report.evidenceGrounding.spanDiagnostics.meanPairSpanOverlapF1,
    5 / 6,
  );
  assert.equal(report.evidenceGrounding.spanDiagnostics.supportAgreementRate, 0.5);
  assert.equal(report.coverage.coverageRate, 2 / 3);
  assert.equal(report.coverage.complete, false);
  assert.equal(report.status, "unavailable");

  const unblinded = structuredClone(pairs[0]);
  unblinded.right.reviewMode.blindToSystemOutput = false;
  const invalid = computeLegalReviewerFieldAgreement([unblinded], {
    expectedPairCount: 1,
  });
  assert.equal(invalid.invalidPairCount, 1);
  assert.equal(invalid.coverage.complete, false);
  assert.equal(invalid.status, "unavailable");

  assert.throws(
    () => computeLegalReviewerFieldAgreement([], { expectedPairCount: -1 }),
    /expectedPairCount must be a non-negative integer/,
  );
});
