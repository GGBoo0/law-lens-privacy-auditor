import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

import {
  computeCohenKappa,
  evaluateLegalAccuracyCorpus,
  LegalAccuracyConfigurationError,
  sha256Text,
  validateLegalAccuracyCorpus,
} from "../lib/legal-accuracy-evaluator.mjs";
import {
  assertLegalEvaluationContract,
  assertLegalEvaluationDecision,
} from "../lib/legal-evaluation-schema.mjs";
import { LEGAL_BASELINE } from "../lib/legal-baseline.ts";
import {
  canonicalRuleForFinding,
  LEGAL_ACCURACY_RULES,
} from "../lib/legal-accuracy-taxonomy.mjs";

const rulesetVersion = "KR-TEST-r1";
const legalAsOfDate = "2026-08-11";
const evaluationId = "legal-accuracy-test";
const corpusVersion = "test-corpus-v1";
const runtimeManifestRaw = '{"schemaVersion":1,"status":"valid"}\n';
const runtimeManifestHash = sha256Text(runtimeManifestRaw);

function finding(id, severity, findingType, evidence, factual = false) {
  return {
    id,
    severity,
    findingType,
    evidence,
    legalBasis: [
      {
        sourceId: "test-law",
        article: "제1조",
        url: "https://example.test/law/1",
      },
    ],
    requiresFactualVerification: factual,
  };
}

function mockAnalyzer(text, meta) {
  const findings = [];
  if (text.includes("MISSING_PURPOSE")) {
    findings.push(
      finding(
        "missing-purpose",
        "high",
        "possible_missing_disclosure",
        undefined,
      ),
    );
  } else {
    findings.push(
      finding(
        "present-purpose",
        "pass",
        "confirmed_disclosure",
        "개인정보 처리 목적은 회원관리입니다.",
      ),
    );
  }
  if (meta.contextOverrides?.thirdParty === "yes" && text.includes("THIRD_PARTY")) {
    findings.push(
      finding(
        "third-party-missing",
        "high",
        "possible_missing_disclosure",
        undefined,
        true,
      ),
    );
  }
  return {
    findings,
    legalBaseline: {
      rulesetVersion,
      asOfDate: meta.legalAsOfDate,
      overdueLegalReview: false,
    },
  };
}

function createCorpus({ datasetKind = "expert", gate = { mode: "calibration" } } = {}) {
  const firstText = `${"개인정보처리방침 전체 문서입니다. ".repeat(8)} MISSING_PURPOSE THIRD_PARTY`;
  const secondText = `${"개인정보 처리 목적은 회원관리입니다. ".repeat(8)} NO_RISK`;
  const cases = [
    {
      id: "case-a",
      text: firstText,
      documentHash: sha256Text(firstText),
      documentScope: "full_policy",
      legalAsOfDate,
      rulesetVersion,
      contexts: { thirdParty: "yes" },
    },
    {
      id: "case-b",
      text: secondText,
      documentHash: sha256Text(secondText),
      documentScope: "full_policy",
      legalAsOfDate,
      rulesetVersion,
      contexts: { thirdParty: "no" },
    },
  ];
  const decisions = {
    "case-a\u0000policy_only\u0000core.purpose": "finding",
    "case-a\u0000context_assisted\u0000core.purpose": "finding",
    "case-a\u0000policy_only\u0000third_party.disclosure": "no_finding",
    "case-a\u0000context_assisted\u0000third_party.disclosure": "finding",
  };
  const gold = [];
  for (const testCase of cases) {
    for (const mode of ["policy_only", "context_assisted"]) {
      for (const ruleId of ["core.purpose", "third_party.disclosure"]) {
        const decision =
          decisions[`${testCase.id}\u0000${mode}\u0000${ruleId}`] ?? "no_finding";
        const strict = decision === "finding" && ruleId === "core.purpose";
        const contextMissing =
          decision === "finding" && ruleId === "third_party.disclosure";
        gold.push({
          evaluationId,
          corpusVersion,
          caseId: testCase.id,
          mode,
          ruleId,
          decision,
          expectedFindingIds: strict
            ? ["missing-purpose"]
            : contextMissing
              ? ["third-party-missing"]
              : [],
          expectedSeverity: decision === "finding" ? "high" : null,
          expectedFindingType:
            decision === "finding" ? "possible_missing_disclosure" : null,
          expectedRequiresFactualVerification: contextMissing,
          legalBases:
            decision === "finding"
              ? [
                  {
                    sourceId: "test-law",
                    article: "제1조",
                    url: "https://example.test/law/1",
                    fit: "direct",
                  },
                ]
              : [],
          evaluationTextSha256: testCase.documentHash,
          runtimeManifestHash,
          absenceTrace:
            decision === "finding"
              ? {
                  documentHash: testCase.documentHash,
                  checkedSections: ["전체 처리방침"],
                  checkedFields: ["해당 공개항목"],
                  support: "direct",
                }
              : null,
          adjudication: {
            status: "adjudicated",
            reviewerIds: ["expert-a", "expert-b"],
            inputAnnotationIds: [
              `${testCase.id}-${mode}-${ruleId}-expert-a`,
              `${testCase.id}-${mode}-${ruleId}-expert-b`,
            ],
          },
        });
      }
    }
  }
  const annotations = gold.flatMap((item) =>
    ["expert-a", "expert-b"].map((reviewerId) => ({
      annotationId: `${item.caseId}-${item.mode}-${item.ruleId}-${reviewerId}`,
      caseId: item.caseId,
      mode: item.mode,
      ruleId: item.ruleId,
      reviewerId,
      evaluationId,
      corpusVersion,
      evaluationTextSha256: cases.find((entry) => entry.id === item.caseId).documentHash,
      runtimeManifestHash,
      legalAsOfDate,
      rulesetVersion,
      decision: item.decision,
      reviewMode: {
        independent: true,
        blindToSystemOutput: true,
        systemOutputViewed: false,
      },
    })),
  );
  return {
    schemaVersion: 1,
    evaluationId,
    corpusVersion,
    datasetKind,
    rulesetVersion,
    legalAsOfDate,
    runtimeManifestHash,
    modes: ["policy_only", "context_assisted"],
    ruleIds: ["core.purpose", "third_party.disclosure"],
    supportPolicy: { minPositivePerRule: 1, minNegativePerRule: 1 },
    gate,
    cases,
    gold,
    annotations,
  };
}

const evaluationOptions = {
  analyze: mockAnalyzer,
  runtimeLegalManifest: { schemaVersion: 1, status: "valid" },
  runtimeManifestHash: sha256Text(runtimeManifestRaw),
  activeRulesetVersion: rulesetVersion,
};

function resolveLocalSchemaRef(rootSchema, reference) {
  assert.match(reference, /^#\//, `Only local JSON Schema references are supported: ${reference}`);
  return reference
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, part) => value?.[part], rootSchema);
}

function schemaValueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function assertSchemaValue(value, contract, rootSchema, path = "$") {
  if (contract.$ref) {
    const resolved = resolveLocalSchemaRef(rootSchema, contract.$ref);
    assert.ok(resolved, `${path}: unresolved schema reference ${contract.$ref}`);
    assertSchemaValue(value, resolved, rootSchema, path);
  }

  if (contract.oneOf) {
    const matchingBranches = contract.oneOf.filter((branch) => {
      try {
        assertSchemaValue(value, branch, rootSchema, path);
        return true;
      } catch {
        return false;
      }
    });
    assert.equal(
      matchingBranches.length,
      1,
      `${path}: expected exactly one matching schema branch, got ${matchingBranches.length}`,
    );
  }

  if (Object.hasOwn(contract, "const")) {
    assert.deepEqual(value, contract.const, `${path}: value differs from const`);
  }
  if (contract.enum) {
    assert.ok(contract.enum.includes(value), `${path}: value is outside enum`);
  }

  if (contract.type) {
    const allowedTypes = Array.isArray(contract.type) ? contract.type : [contract.type];
    const actualType = schemaValueType(value);
    const typeMatches = allowedTypes.some(
      (type) =>
        type === actualType ||
        (type === "number" && (actualType === "number" || actualType === "integer")),
    );
    assert.ok(typeMatches, `${path}: expected ${allowedTypes.join("|")}, got ${actualType}`);
  }

  if (typeof value === "string") {
    if (contract.pattern) {
      assert.match(value, new RegExp(contract.pattern), `${path}: pattern mismatch`);
    }
    if (contract.minLength !== undefined) {
      assert.ok(value.length >= contract.minLength, `${path}: string is too short`);
    }
    if (contract.format === "date") {
      assert.match(value, /^\d{4}-\d{2}-\d{2}$/, `${path}: invalid date`);
    } else if (contract.format === "date-time") {
      assert.ok(!Number.isNaN(Date.parse(value)), `${path}: invalid date-time`);
    } else if (contract.format === "uri") {
      assert.doesNotThrow(() => new URL(value), `${path}: invalid URI`);
    }
  }

  if (typeof value === "number" && contract.minimum !== undefined) {
    assert.ok(value >= contract.minimum, `${path}: value is below minimum`);
  }

  if (Array.isArray(value)) {
    if (contract.minItems !== undefined) {
      assert.ok(value.length >= contract.minItems, `${path}: array is too short`);
    }
    if (contract.uniqueItems) {
      assert.equal(
        new Set(value.map((entry) => JSON.stringify(entry))).size,
        value.length,
        `${path}: array items are not unique`,
      );
    }
    if (contract.items) {
      value.forEach((entry, index) =>
        assertSchemaValue(entry, contract.items, rootSchema, `${path}[${index}]`),
      );
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const requiredKey of contract.required ?? []) {
      assert.ok(Object.hasOwn(value, requiredKey), `${path}: missing ${requiredKey}`);
    }
    const declaredProperties = contract.properties ?? {};
    for (const [key, entry] of Object.entries(value)) {
      if (declaredProperties[key]) {
        assertSchemaValue(entry, declaredProperties[key], rootSchema, `${path}.${key}`);
      } else if (contract.additionalProperties === false) {
        assert.fail(`${path}: unexpected property ${key}`);
      } else if (
        contract.additionalProperties &&
        typeof contract.additionalProperties === "object"
      ) {
        assertSchemaValue(
          entry,
          contract.additionalProperties,
          rootSchema,
          `${path}.${key}`,
        );
      }
    }
  }

  for (const additionalContract of contract.allOf ?? []) {
    assertSchemaValue(value, additionalContract, rootSchema, path);
  }
  if (contract.if) {
    let conditionMatches = true;
    try {
      assertSchemaValue(value, contract.if, rootSchema, path);
    } catch {
      conditionMatches = false;
    }
    if (conditionMatches && contract.then) {
      assertSchemaValue(value, contract.then, rootSchema, path);
    } else if (!conditionMatches && contract.else) {
      assertSchemaValue(value, contract.else, rootSchema, path);
    }
  }
}

function completedPacketItemToAnnotation(packet, item) {
  if (!item.decision || !item.reviewerConfidence) {
    throw new Error("Review packet item is not completed");
  }
  return {
    recordType: "legal_evaluation_reviewer_annotation",
    schemaVersion: packet.schemaVersion,
    evaluationId: packet.evaluationId,
    corpusVersion: packet.corpusVersion,
    runtimeManifestHash: packet.runtimeManifestHash,
    annotationId: item.annotationId,
    caseId: item.caseId,
    track: item.track,
    ruleId: item.ruleId,
    reviewerId: item.reviewerId,
    synthetic: item.synthetic,
    eligibleForMetrics: item.eligibleForMetrics,
    reviewMode: item.reviewMode,
    documentCompleteness: item.documentCompleteness,
    evaluationTextSha256: item.evaluationTextSha256,
    legalAsOfDate: item.legalAsOfDate,
    rulesetVersion: item.rulesetVersion,
    guidelineVersion: item.guidelineVersion,
    decision: item.decision,
    reviewerConfidence: item.reviewerConfidence,
  };
}

function assertNoPublicLabelLeak(value, path = "$") {
  const forbiddenKeys = new Set([
    "decision",
    "goldLabel",
    "reviewerId",
    "finalDecision",
    "annotationId",
    "adjudicationId",
    "companyId",
    "corpusRef",
    "inputAnnotationIds",
    "evidence",
    "legalBases",
    "rationale",
    "text",
    "documentText",
    "policyText",
    "policyUrl",
    "rawHtml",
    "html",
    "expectedFindingIds",
    "expectedSeverity",
    "expectedFindingType",
    "expectedRequiresFactualVerification",
    "absenceTrace",
    "notes",
    "source",
    "sourceUrl",
    "split",
  ]);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPublicLabelLeak(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    assert.ok(!forbiddenKeys.has(key), `${path}.${key}: private label/text field leaked`);
    assertNoPublicLabelLeak(entry, `${path}.${key}`);
  }
}

test("maps every analyzer outcome to a unique canonical accuracy rule", () => {
  assert.equal(canonicalRuleForFinding("missing-purpose")?.ruleId, "core.purpose");
  assert.equal(canonicalRuleForFinding("present-purpose")?.isFinding, false);
  assert.equal(
    canonicalRuleForFinding("third-party-fields")?.ruleId,
    "third_party.disclosure",
  );
  const allFindingIds = LEGAL_ACCURACY_RULES.flatMap((rule) => [
    ...rule.findingIds,
    ...rule.noFindingIds,
  ]);
  assert.equal(allFindingIds.length, new Set(allFindingIds).size);
});

test("scores policy-only and context-assisted judgments separately", () => {
  const report = evaluateLegalAccuracyCorpus(createCorpus(), evaluationOptions);
  assert.equal(report.analysisRunCount, 4);
  assert.equal(report.metrics.micro.tp, 3);
  assert.equal(report.metrics.micro.fp, 0);
  assert.equal(report.metrics.micro.fn, 0);
  assert.equal(report.metrics.micro.f1, 1);
  assert.equal(report.metrics.byMode.policy_only.micro.tp, 1);
  assert.equal(report.metrics.byMode.context_assisted.micro.tp, 2);
  assert.equal(report.special.possibleMissing.precision, 1);
  assert.equal(report.special.highStrictActionable.recall, 1);
  assert.equal(report.special.legalBasis.precision, 1);
  assert.equal(report.special.legalBasis.recall, 1);
  assert.equal(report.evidence.strictEvidencePredictionCount, 0);
  assert.equal(report.evidence.strictEvidenceGroundedCount, 0);
  assert.equal(report.evidence.strictEvidenceGroundingRate, null);
  assert.equal(report.agreement.meanPairwiseKappa, 1);
  assert.equal(report.gate.status, "calibration");
});

test("keeps omission absence traces out of strict quote evidence scoring", () => {
  const omissionReport = evaluateLegalAccuracyCorpus(
    createCorpus(),
    evaluationOptions,
  );
  assert.equal(omissionReport.special.possibleMissing.precision, 1);
  assert.equal(omissionReport.evidence.strictEvidencePredictionCount, 0);
  assert.equal(omissionReport.evidence.strictEvidenceGroundedCount, 0);
  assert.equal(omissionReport.evidence.strictEvidenceGroundingRate, null);

  const quotedCorpus = createCorpus();
  const quote = "MISSING_PURPOSE";
  const start = quotedCorpus.cases[0].text.indexOf(quote);
  for (const gold of quotedCorpus.gold.filter(
    (item) => item.caseId === "case-a" && item.ruleId === "core.purpose",
  )) {
    gold.expectedFindingType = "ambiguity_or_inconsistency";
    gold.evidence = [
      {
        kind: "span",
        quote,
        start,
        end: start + quote.length,
        support: "direct",
      },
    ];
  }
  const quoteOptions = {
    ...evaluationOptions,
    analyze(text, meta) {
      const analysis = mockAnalyzer(text, meta);
      analysis.findings = analysis.findings.map((item) =>
        item.id === "missing-purpose"
          ? {
              ...item,
              findingType: "ambiguity_or_inconsistency",
              evidence: quote,
            }
          : item,
      );
      return analysis;
    },
  };
  const quotedReport = evaluateLegalAccuracyCorpus(quotedCorpus, quoteOptions);
  assert.equal(quotedReport.evidence.strictEvidencePredictionCount, 2);
  assert.equal(quotedReport.evidence.strictEvidenceGroundedCount, 2);
  assert.equal(quotedReport.evidence.strictEvidenceGroundingRate, 1);
});

test("reports Wilson diagnostics and keeps company clusters on evaluation rows", () => {
  const corpus = createCorpus();
  corpus.cases.forEach((testCase, index) => {
    testCase.companyId = `company-${index}`;
    testCase.sector = "platform";
    testCase.split = "lockedTest";
  });
  const report = evaluateLegalAccuracyCorpus(corpus, evaluationOptions);

  assert.deepEqual(
    [...new Set(report.rows.map((row) => row.companyId))].sort(),
    ["company-0", "company-1"],
  );
  assert.equal(
    report.confidenceIntervals.possibleMissingPrecision.wilson.successes,
    3,
  );
  assert.equal(
    report.confidenceIntervals.possibleMissingPrecision.wilson.total,
    3,
  );
  assert.equal(
    report.bySplit.lockedTest.confidenceIntervals.macroF1.status,
    "not_run",
  );
  assert.equal(
    report.bySplit.lockedTest.confidenceIntervals.byMode.policy_only
      .possibleMissingPrecision.wilson.status,
    "ok",
  );
});

test("possible-missing precision does not treat another finding type as gold positive", () => {
  const corpus = createCorpus();
  const target = corpus.gold.find(
    (item) =>
      item.caseId === "case-a" &&
      item.mode === "policy_only" &&
      item.ruleId === "core.purpose",
  );
  target.expectedFindingType = "ambiguity_or_inconsistency";
  assert.equal(
    evaluateLegalAccuracyCorpus(corpus, evaluationOptions).special.possibleMissing.fp,
    1,
  );
});

test("counts unsafe high escalation on expert-confirmed safe or uncertain rows", () => {
  const corpus = createCorpus();
  const target = corpus.gold.find(
    (item) =>
      item.caseId === "case-a" &&
      item.mode === "policy_only" &&
      item.ruleId === "core.purpose",
  );
  target.decision = "not_applicable";
  target.expectedFindingIds = [];
  target.expectedSeverity = null;
  target.expectedFindingType = null;
  target.expectedRequiresFactualVerification = null;
  target.absenceTrace = null;

  const report = evaluateLegalAccuracyCorpus(corpus, evaluationOptions);
  assert.equal(report.special.unsafeHighEscalation.count, 1);
  assert.ok(report.special.unsafeHighEscalation.rate > 0);
});

test("rejects document drift and synthetic enforced gates", () => {
  const drifted = createCorpus();
  drifted.cases[0].text += " changed";
  assert.throws(
    () => evaluateLegalAccuracyCorpus(drifted, evaluationOptions),
    LegalAccuracyConfigurationError,
  );

  const synthetic = createCorpus({
    datasetKind: "synthetic",
    gate: { mode: "enforced", calibrated: true, minCases: 1 },
  });
  const validation = validateLegalAccuracyCorpus(synthetic, evaluationOptions);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => /Synthetic/.test(error)));

  const replacedDocument = createCorpus();
  replacedDocument.cases[0].text = `${replacedDocument.cases[0].text} replacement`;
  replacedDocument.cases[0].documentHash = sha256Text(
    replacedDocument.cases[0].text,
  );
  assert.throws(
    () => evaluateLegalAccuracyCorpus(replacedDocument, evaluationOptions),
    /evaluationTextSha256 does not match the case/,
  );

  const staleLegalSnapshot = createCorpus();
  staleLegalSnapshot.annotations[0].runtimeManifestHash = "0".repeat(64);
  assert.throws(
    () => evaluateLegalAccuracyCorpus(staleLegalSnapshot, evaluationOptions),
    /runtimeManifestHash does not match the corpus/,
  );
});

test("rejects mixed legal dates and ruleset versions across cases, gold, and annotations", () => {
  const mixedCaseDate = createCorpus();
  mixedCaseDate.cases[1].legalAsOfDate = "2026-08-10";
  assert.throws(
    () => evaluateLegalAccuracyCorpus(mixedCaseDate, evaluationOptions),
    /legalAsOfDate must match corpus pin/,
  );

  const mixedGoldRuleset = createCorpus();
  mixedGoldRuleset.gold[0].rulesetVersion = "KR-OTHER-r1";
  assert.throws(
    () => evaluateLegalAccuracyCorpus(mixedGoldRuleset, evaluationOptions),
    /gold rulesetVersion does not match the corpus pin/,
  );

  const mixedAnnotationDate = createCorpus();
  mixedAnnotationDate.annotations[0].legalAsOfDate = "2026-08-10";
  assert.throws(
    () => evaluateLegalAccuracyCorpus(mixedAnnotationDate, evaluationOptions),
    /annotation legalAsOfDate does not match the corpus pin/,
  );
});

test("enforced gate cannot pass without locked-test and sample integrity", () => {
  const corpus = createCorpus({
    gate: {
      mode: "enforced",
      calibrated: true,
      minCases: 1,
      minDistinctCompanies: 1,
      minSectors: 1,
      minLockedTestFraction: 0.3,
      thresholds: {
        minMacroF1: 0,
        minHighStrictActionableRecall: 0,
        minStrictEvidenceGroundingRate: 0,
        minPossibleMissingPrecision: 0,
        maxUnsafeHighEscalationRate: 0,
      },
    },
  });
  const report = evaluateLegalAccuracyCorpus(corpus, evaluationOptions);
  assert.equal(report.gate.status, "fail");
  assert.ok(report.gate.failures.some((failure) => /locked-test fraction/.test(failure)));
  assert.ok(
    report.gate.failures.some((failure) => /companyId, sector, and split/.test(failure)),
  );
  assert.ok(
    report.gate.failures.some((failure) => /confidence intervals/.test(failure)),
  );
  assert.ok(
    report.gate.failures.some((failure) => /complete canonical rule catalog/.test(failure)),
  );
});

test("enforced gate requires per-rule support inside each evaluation mode", () => {
  const corpus = createCorpus({
    gate: {
      mode: "enforced",
      calibrated: true,
      minCases: 2,
      minDistinctCompanies: 2,
      minSectors: 1,
      minLockedTestFraction: 1,
      minHighRiskGold: 0,
      minHighRiskFamilies: 0,
      maxHighRiskSingleFamilyFraction: 1,
      thresholds: {
        minMacroF1: 0,
        minHighStrictActionableRecall: 0,
        minStrictEvidenceGroundingRate: 0,
        minPossibleMissingPrecision: 0,
        maxUnsafeHighEscalationRate: 1,
        minCohenKappa: 0,
      },
    },
  });
  corpus.metrics = {
    confidenceIntervals: { implementationStatus: "implemented" },
  };
  corpus.review = {
    agreementMetrics: { fieldLevelAgreement: "implemented" },
  };
  corpus.supportPolicy.minPredictedPositivePerRule = 0;
  corpus.cases.forEach((testCase, index) => {
    testCase.companyId = `company-${index}`;
    testCase.sector = "platform";
    testCase.split = "lockedTest";
  });

  const report = evaluateLegalAccuracyCorpus(corpus, evaluationOptions);
  assert.equal(report.metrics.macro.insufficientRuleIds.length, 0);
  assert.ok(
    report.gate.failures.some((failure) =>
      /locked-test policy_only per-rule support/.test(failure),
    ),
  );
  assert.ok(
    report.gate.failures.some((failure) => /confidence intervals/.test(failure)),
    "configuration flags must not substitute for computed confidence bounds",
  );
  assert.ok(
    report.gate.failures.some((failure) =>
      /field-level reviewer agreement coverage is incomplete/.test(failure),
    ),
  );
});

test("counts high-severity overstatement against a lower-risk expert finding", () => {
  const corpus = createCorpus();
  const baseline = evaluateLegalAccuracyCorpus(corpus, evaluationOptions);
  const target = corpus.gold.find(
    (item) =>
      item.caseId === "case-a" &&
      item.mode === "policy_only" &&
      item.ruleId === "core.purpose",
  );
  target.expectedSeverity = "medium";
  target.expectedFindingType = "ambiguity_or_inconsistency";
  const report = evaluateLegalAccuracyCorpus(corpus, evaluationOptions);
  assert.equal(
    report.special.highOverstatement.count,
    baseline.special.highOverstatement.count + 1,
  );
  assert.equal(
    report.special.highOverstatement.support,
    baseline.special.highOverstatement.support + 1,
  );
});

test("scores only eligible expert-adjudicated rows and excludes partial omissions", () => {
  const corpus = createCorpus();
  const ineligible = corpus.gold.find(
    (item) =>
      item.caseId === "case-a" &&
      item.mode === "policy_only" &&
      item.ruleId === "core.purpose",
  );
  ineligible.eligibleForMetrics = false;
  corpus.cases[1].synthetic = true;
  const filtered = evaluateLegalAccuracyCorpus(corpus, evaluationOptions);
  assert.equal(filtered.metrics.micro.tp, 2);
  assert.equal(filtered.validation.excludedGoldItemCount, 5);

  const partial = createCorpus();
  partial.cases[0].documentScope = "partial";
  partial.cases[0].metricEligibility = { omissionRules: false };
  const partialReport = evaluateLegalAccuracyCorpus(partial, evaluationOptions);
  assert.equal(partialReport.metrics.micro.tp, 0);
  assert.equal(partialReport.validation.excludedGoldItemCount, 0);
  assert.ok(partialReport.validation.guardrailOnlyGoldItemCount >= 3);
  assert.equal(partialReport.special.partialUnsupportedOmission.support, 4);
  assert.equal(partialReport.special.partialUnsupportedOmission.count, 3);
  assert.equal(partialReport.special.partialUnsafeHigh.support, 4);
  assert.equal(partialReport.special.partialUnsafeHigh.count, 2);

  const partialNegative = createCorpus();
  partialNegative.cases[0].documentScope = "partial";
  partialNegative.cases[0].metricEligibility = { omissionRules: false };
  const partialTarget = partialNegative.gold.find(
    (item) =>
      item.caseId === "case-a" &&
      item.mode === "policy_only" &&
      item.ruleId === "core.purpose",
  );
  partialTarget.decision = "no_finding";
  partialTarget.expectedFindingIds = [];
  partialTarget.expectedSeverity = null;
  partialTarget.expectedFindingType = null;
  partialTarget.expectedRequiresFactualVerification = null;
  partialTarget.absenceTrace = null;
  const partialNegativeReport = evaluateLegalAccuracyCorpus(
    partialNegative,
    evaluationOptions,
  );
  assert.equal(partialNegativeReport.special.possibleMissing.fp, 0);
  assert.equal(partialNegativeReport.special.unsafeHighEscalation.count, 1);

  const forged = createCorpus();
  forged.annotations = forged.annotations.filter(
    (item) =>
      !(
        item.caseId === "case-a" &&
        item.mode === "context_assisted" &&
        item.ruleId === "third_party.disclosure" &&
        item.reviewerId === "expert-b"
      ),
  );
  const forgedReport = evaluateLegalAccuracyCorpus(forged, evaluationOptions);
  assert.equal(forgedReport.metrics.micro.tp, 2);
  assert.equal(forgedReport.validation.excludedGoldItemCount, 1);
});

test("reports Cohen kappa as unavailable for single-category labels", () => {
  const annotations = ["one", "two"].flatMap((caseId) =>
    ["a", "b"].map((reviewerId) => ({
      caseId,
      mode: "policy_only",
      ruleId: "core.purpose",
      reviewerId,
      decision: "no_finding",
    })),
  );
  assert.equal(
    computeCohenKappa(annotations, "a", "b").status,
    "not_calculable_single_category",
  );
});

test("default public config reports calibration pending without inventing metrics", () => {
  const normal = spawnSync(
    process.execPath,
    ["scripts/evaluate-legal-accuracy.mjs", "--config", "data/legal-evaluation/config.json"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(normal.status, 0, normal.stderr);
  assert.match(normal.stdout, /calibration_pending/);
  assert.match(normal.stdout, /전문가 검토 사례: 0개/);

  const required = spawnSync(
    process.execPath,
    [
      "scripts/evaluate-legal-accuracy.mjs",
      "--config",
      "data/legal-evaluation/config.json",
      "--require-expert-results",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(required.status, 1);
  assert.match(required.stdout, /calibration_pending/);

  const prepare = spawnSync(
    process.execPath,
    [
      "scripts/prepare-legal-accuracy-review.mjs",
      "--config",
      "data/legal-evaluation/config.json",
      "--reviewer",
      "expert-test",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.notEqual(prepare.status, 0);
  assert.match(prepare.stderr, /No private evaluation cases/);
});

test("private expert contracts run end to end with document and legal-manifest pins", (t) => {
  const root = mkdtempSync(join(tmpdir(), "law-lens-private-evaluation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const baseConfig = JSON.parse(
    readFileSync("data/legal-evaluation/config.json", "utf8"),
  );
  const manifestRaw = readFileSync("data/legal-runtime-manifest.json", "utf8");
  const manifestHash = `sha256:${sha256Text(manifestRaw)}`;
  const text = "개인정보 처리방침 전체 문서 평가용 비공개 회귀 사례입니다. ".repeat(12);
  const evaluationTextSha256 = `sha256:${sha256Text(text)}`;
  const caseId = "private-e2e-case";
  const decision = {
    applicability: "applicable",
    goldLabel: "confirmed_disclosure",
    severity: "pass",
    defectCodes: [],
    evidence: [],
    legalBases: [],
    requiresFactualVerification: false,
    rationale: "End-to-end contract fixture.",
  };
  const cases = {
    cases: [
      {
        id: caseId,
        text,
        documentHash: evaluationTextSha256,
        documentScope: "full_policy",
        documentCompleteness: "fullDocument",
        track: "policyOnly",
        legalAsOfDate: baseConfig.legalContext.verifiedAt,
        rulesetVersion: LEGAL_BASELINE.rulesetVersion,
        companyId: "private-company",
        sector: "platform",
        split: "calibration",
      },
    ],
  };
  const annotationFor = (reviewerId, ruleId) => ({
    recordType: "legal_evaluation_reviewer_annotation",
    schemaVersion: baseConfig.schemaVersion,
    evaluationId: baseConfig.evaluationId,
    corpusVersion: baseConfig.evaluationId,
    runtimeManifestHash: manifestHash,
    annotationId: `${caseId}-${ruleId}-${reviewerId}`,
    caseId,
    track: "policyOnly",
    ruleId,
    reviewerId,
    synthetic: false,
    eligibleForMetrics: true,
    reviewMode: {
      independent: true,
      blindToSystemOutput: true,
      systemOutputViewed: false,
    },
    documentCompleteness: "fullDocument",
    evaluationTextSha256,
    legalAsOfDate: baseConfig.legalContext.verifiedAt,
    rulesetVersion: LEGAL_BASELINE.rulesetVersion,
    guidelineVersion: "gold-v1-draft",
    decision,
    reviewerConfidence: "medium",
  });
  const reviewerA = LEGAL_ACCURACY_RULES.map((rule) =>
    annotationFor("expert-a", rule.id),
  );
  const reviewerB = LEGAL_ACCURACY_RULES.map((rule) =>
    annotationFor("expert-b", rule.id),
  );
  const adjudications = LEGAL_ACCURACY_RULES.map((rule) => ({
    recordType: "legal_evaluation_adjudication",
    schemaVersion: baseConfig.schemaVersion,
    evaluationId: baseConfig.evaluationId,
    corpusVersion: baseConfig.evaluationId,
    runtimeManifestHash: manifestHash,
    adjudicationId: `${caseId}-${rule.id}-final`,
    caseId,
    track: "policyOnly",
    ruleId: rule.id,
    inputAnnotationIds: [
      `${caseId}-${rule.id}-expert-a`,
      `${caseId}-${rule.id}-expert-b`,
    ],
    adjudicationMode: "agreementConfirmation",
    adjudicatorId: "expert-adjudicator",
    preservesOriginalAnnotations: true,
    synthetic: false,
    eligibleForMetrics: true,
    disagreementTypes: [],
    evaluationTextSha256,
    finalDecision: decision,
    resolutionRationale: "Both independent reviewers agreed.",
  }));
  const paths = {
    cases: join(root, "cases.json"),
    reviewerA: join(root, "reviewer-a.json"),
    reviewerB: join(root, "reviewer-b.json"),
    adjudications: join(root, "adjudications.json"),
    report: join(root, "report.json"),
  };
  writeFileSync(paths.cases, `${JSON.stringify(cases)}\n`, "utf8");
  writeFileSync(paths.reviewerA, `${JSON.stringify(reviewerA)}\n`, "utf8");
  writeFileSync(paths.reviewerB, `${JSON.stringify(reviewerB)}\n`, "utf8");
  writeFileSync(
    paths.adjudications,
    `${JSON.stringify(adjudications)}\n`,
    "utf8",
  );

  const evaluated = spawnSync(
    process.execPath,
    [
      "scripts/evaluate-legal-accuracy.mjs",
      "--config",
      "data/legal-evaluation/config.json",
      "--cases",
      paths.cases,
      "--annotations",
      `${paths.reviewerA},${paths.reviewerB}`,
      "--adjudications",
      paths.adjudications,
      "--json-out",
      paths.report,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(evaluated.status, 0, evaluated.stderr);
  const report = JSON.parse(readFileSync(paths.report, "utf8"));
  assert.equal(report.caseCount, 1);
  assert.equal(report.analysisRunCount, 1);
  assert.equal(report.validation.expertAdjudicatedGoldItemCount, 36);
  assert.equal(report.rulesetVersion, LEGAL_BASELINE.rulesetVersion);
  assert.equal(report.agreement.fieldLevel.coverage.expectedPairCount, 36);
  assert.equal(report.agreement.fieldLevel.coverage.complete, true);
  assert.equal(report.agreement.fieldLevel.invalidPairCount, 0);
  assert.equal(
    report.agreement.fieldLevel.bySplit.calibration.byMode.policy_only.coverage
      .expectedPairCount,
    36,
  );
  assert.equal(
    report.agreement.fieldLevel.bySplit.calibration.byMode.policy_only.coverage
      .complete,
    true,
  );
});

test("CLI case overrides resolve from the repository root", (t) => {
  const workDirectory = join(process.cwd(), "work");
  mkdirSync(workDirectory, { recursive: true });
  const root = mkdtempSync(join(workDirectory, "legal-accuracy-path-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const text = "개인정보 처리방침 평가용 전체 문서입니다. ".repeat(12);
  const casesPath = join(root, "cases.json");
  const outputPath = join(root, "review.json");
  writeFileSync(
    casesPath,
    `${JSON.stringify({
      cases: [
        {
          id: "relative-path-case",
          text,
          documentHash: sha256Text(text),
          documentScope: "full_policy",
        },
      ],
    })}\n`,
    "utf8",
  );
  const relativeCasesPath = relative(process.cwd(), casesPath);
  const relativeOutputPath = relative(process.cwd(), outputPath);
  const prepared = spawnSync(
    process.execPath,
    [
      "scripts/prepare-legal-accuracy-review.mjs",
      "--config",
      "data/legal-evaluation/config.json",
      "--reviewer",
      "expert-path-test",
      "--cases",
      relativeCasesPath,
      "--output",
      relativeOutputPath,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(prepared.status, 0, prepared.stderr);
  const packet = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.ok(packet.items.length > 0);
  const schema = JSON.parse(
    readFileSync("data/legal-evaluation/evaluation.schema.json", "utf8"),
  );
  assertSchemaValue(packet, schema.$defs.reviewPacket, schema, "preparedPacket");

  const incompleteExport = spawnSync(
    process.execPath,
    [
      "scripts/export-legal-accuracy-annotations.mjs",
      "--packet",
      relativeOutputPath,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.notEqual(incompleteExport.status, 0);
  assert.match(incompleteExport.stderr, /decision is incomplete/);

  const completedDecision = () => ({
    applicability: "applicable",
    goldLabel: "confirmed_disclosure",
    severity: "pass",
    defectCodes: [],
    evidence: [],
    legalBases: [],
    requiresFactualVerification: false,
    rationale: "Relative-path workflow regression fixture.",
  });
  const malformedScenarios = [
    (decision) => {
      decision.text = "private policy text";
    },
    (decision) => {
      decision.evidence = [{ kind: "span", quote: "missing offsets" }];
    },
  ];
  for (const [index, mutate] of malformedScenarios.entries()) {
    const malformedPacket = structuredClone(packet);
    malformedPacket.items[0].decision = completedDecision();
    malformedPacket.items[0].reviewerConfidence = "medium";
    mutate(malformedPacket.items[0].decision);
    const malformedPath = join(root, `malformed-${index}.json`);
    writeFileSync(malformedPath, `${JSON.stringify(malformedPacket)}\n`, "utf8");
    const malformedExport = spawnSync(
      process.execPath,
      [
        "scripts/export-legal-accuracy-annotations.mjs",
        "--packet",
        relative(process.cwd(), malformedPath),
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.notEqual(malformedExport.status, 0);
    assert.match(malformedExport.stderr, /Invalid review packet/);
  }

  for (const item of packet.items) {
    item.decision = completedDecision();
    item.reviewerConfidence = "medium";
  }
  const tamperedPacket = structuredClone(packet);
  tamperedPacket.items[0].text += " tampered";
  const tamperedPath = join(root, "tampered-completed-packet.json");
  writeFileSync(tamperedPath, `${JSON.stringify(tamperedPacket)}\n`, "utf8");
  const tamperedExport = spawnSync(
    process.execPath,
    [
      "scripts/export-legal-accuracy-annotations.mjs",
      "--packet",
      relative(process.cwd(), tamperedPath),
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.notEqual(tamperedExport.status, 0);
  assert.match(
    tamperedExport.stderr,
    /evaluationTextSha256 does not match item\.text/,
  );

  writeFileSync(outputPath, `${JSON.stringify(packet)}\n`, "utf8");
  const annotationPath = join(root, "annotations.json");
  const exported = spawnSync(
    process.execPath,
    [
      "scripts/export-legal-accuracy-annotations.mjs",
      "--packet",
      relativeOutputPath,
      "--output",
      relative(process.cwd(), annotationPath),
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(exported.status, 0, exported.stderr);
  const annotationBatch = JSON.parse(readFileSync(annotationPath, "utf8"));
  assert.equal(annotationBatch.annotations.length, packet.items.length);
  assertSchemaValue(
    annotationBatch,
    schema.$defs.reviewerAnnotationBatch,
    schema,
    "exportedAnnotationBatch",
  );
  for (const annotation of annotationBatch.annotations) {
    assert.ok(!Object.hasOwn(annotation, "text"));
    assert.ok(!Object.hasOwn(annotation, "contexts"));
    assert.match(annotation.evaluationTextSha256, /^sha256:[a-f0-9]{64}$/);
  }

  const evaluated = spawnSync(
    process.execPath,
    [
      "scripts/evaluate-legal-accuracy.mjs",
      "--config",
      "data/legal-evaluation/config.json",
      "--cases",
      relativeCasesPath,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.notEqual(evaluated.status, 0);
  assert.doesNotMatch(evaluated.stderr, /ENOENT/);
  assert.match(evaluated.stderr, /Invalid public pending contract/);
});

test("public pending contract rejects fabricated metrics, certification, raw text, and count drift", (t) => {
  const baseConfig = JSON.parse(
    readFileSync("data/legal-evaluation/config.json", "utf8"),
  );
  const baseManifest = JSON.parse(
    readFileSync("data/legal-evaluation/cases.json", "utf8"),
  );
  const scenarios = [
    {
      name: "fabricated metrics",
      config: {
        ...baseConfig,
        currentState: { ...baseConfig.currentState, metrics: { f1: 1 } },
      },
      manifest: baseManifest,
    },
    {
      name: "false certification",
      config: { ...baseConfig, status: "certified", certified: true },
      manifest: baseManifest,
    },
    {
      name: "raw policy text",
      config: {
        ...baseConfig,
        currentState: { ...baseConfig.currentState, expertReviewedPolicies: 1 },
      },
      manifest: {
        ...baseManifest,
        caseCount: 1,
        cases: [{ caseId: "leak", text: "비공개 평가 원문" }],
      },
    },
    {
      name: "expert label leak",
      config: baseConfig,
      manifest: {
        ...baseManifest,
        caseCount: 1,
        cases: [{ caseId: "leak", finalDecision: "confirmed_disclosure" }],
      },
    },
    {
      name: "case count drift",
      config: baseConfig,
      manifest: { ...baseManifest, caseCount: 1 },
    },
  ];

  const root = mkdtempSync(join(tmpdir(), "law-lens-accuracy-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [index, scenario] of scenarios.entries()) {
    const directory = join(root, String(index));
    mkdirSync(directory);
    const configPath = join(directory, "config.json");
    const manifestPath = join(directory, "cases.json");
    writeFileSync(configPath, `${JSON.stringify(scenario.config)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    writeFileSync(manifestPath, `${JSON.stringify(scenario.manifest)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    const result = spawnSync(
      process.execPath,
      ["scripts/evaluate-legal-accuracy.mjs", "--config", configPath],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.notEqual(result.status, 0, scenario.name);
    assert.match(
      result.stderr,
      /Invalid (?:evaluation config|public pending contract|public case manifest)/,
      scenario.name,
    );
  }
});

test("legal evaluation schema validates public manifests and synthetic contract examples", () => {
  const schema = JSON.parse(
    readFileSync("data/legal-evaluation/evaluation.schema.json", "utf8"),
  );
  const config = JSON.parse(readFileSync("data/legal-evaluation/config.json", "utf8"));
  const publicManifest = JSON.parse(
    readFileSync("data/legal-evaluation/cases.json", "utf8"),
  );
  const exampleNames = [
    "adjudication.synthetic.json",
    "case-manifest.synthetic.json",
    "review-packet.completed.synthetic.json",
    "reviewer-annotations-batch.synthetic.json",
    "reviewer-a.synthetic.json",
    "reviewer-b.synthetic.json",
    "reviewer-from-packet.synthetic.json",
  ];

  assertSchemaValue(config, schema, schema, "config");
  assertSchemaValue(publicManifest, schema, schema, "publicManifest");
  assert.equal(publicManifest.caseCount, publicManifest.cases.length);
  assertNoPublicLabelLeak(publicManifest);

  for (const name of exampleNames) {
    const example = JSON.parse(
      readFileSync(`data/legal-evaluation/examples/${name}`, "utf8"),
    );
    assertSchemaValue(example, schema, schema, name);
  }

  assert.equal(schema.$defs.case.additionalProperties, false);
  assert.equal(schema.$defs.source.additionalProperties, false);
  assert.ok(schema.$defs.case.required.includes("evaluationTextSha256"));
  for (const definitionName of ["reviewerAnnotation", "adjudication"]) {
    assert.ok(schema.$defs[definitionName].required.includes("corpusVersion"));
    assert.ok(schema.$defs[definitionName].required.includes("runtimeManifestHash"));
    assert.ok(schema.$defs[definitionName].required.includes("evaluationTextSha256"));
  }
  for (const definitionName of ["reviewPacket", "reviewerAnnotationBatch"]) {
    assert.ok(schema.$defs[definitionName].required.includes("runtimeManifestHash"));
  }
  for (const pathField of [
    "casesFile",
    "casesPath",
    "goldFile",
    "goldPath",
    "annotationsFile",
    "annotationsPath",
    "adjudicationsFile",
    "adjudicationsPath",
    "runtimeManifestFile",
  ]) {
    assert.equal(schema.$defs.evaluationConfig.properties[pathField].type, "string");
  }
  assert.match(schema.$defs.source.properties.documentSha256.description, /raw fetched source bytes/);
  assert.match(
    schema.$defs.case.properties.evaluationTextSha256.description,
    /exact UTF-8 text passed to analyzePrivacyPolicy/,
  );
  assert.ok(
    schema.oneOf.some((entry) => entry.$ref === "#/$defs/reviewPacket"),
    "reviewPacket must be a top-level contract",
  );
  assert.ok(
    schema.oneOf.some(
      (entry) => entry.$ref === "#/$defs/reviewerAnnotationBatch",
    ),
    "reviewerAnnotationBatch must be a top-level contract",
  );
});

test("public case manifest is an allowlist that rejects labels and raw text", () => {
  const schema = JSON.parse(
    readFileSync("data/legal-evaluation/evaluation.schema.json", "utf8"),
  );
  const example = JSON.parse(
    readFileSync(
      "data/legal-evaluation/examples/case-manifest.synthetic.json",
      "utf8",
    ),
  );
  assert.equal(example.containsExpertLabels, false);
  assert.equal(example.containsFullPolicyText, false);
  assert.equal(example.caseCount, example.cases.length);
  assert.match(example.cases[0].evaluationTextSha256, /^sha256:[a-f0-9]{64}$/);
  for (const privateField of ["companyId", "sector", "split", "track", "source", "corpusRef"]) {
    assert.ok(!Object.hasOwn(example.cases[0], privateField));
  }
  assertNoPublicLabelLeak(example);

  for (const leakedField of [
    "decision",
    "goldLabel",
    "reviewerId",
    "finalDecision",
    "text",
    "companyId",
    "split",
    "sourceUrl",
  ]) {
    const leaked = structuredClone(example.cases[0]);
    leaked[leakedField] = leakedField === "text" ? "private text" : "private label";
    assert.throws(
      () => assertSchemaValue(leaked, schema.$defs.publicCase, schema, "publicCase"),
      /unexpected property/,
      `${leakedField} must not be accepted in a public case record`,
    );
    assert.throws(() => assertNoPublicLabelLeak(leaked), /private label\/text field leaked/);
  }
});

test("completed review packet converts exactly to a label-only reviewer annotation", () => {
  const schema = JSON.parse(
    readFileSync("data/legal-evaluation/evaluation.schema.json", "utf8"),
  );
  const packet = JSON.parse(
    readFileSync(
      "data/legal-evaluation/examples/review-packet.completed.synthetic.json",
      "utf8",
    ),
  );
  const expectedAnnotation = JSON.parse(
    readFileSync(
      "data/legal-evaluation/examples/reviewer-from-packet.synthetic.json",
      "utf8",
    ),
  );
  const item = packet.items[0];

  assert.equal(packet.privateArtifact, true);
  assert.equal(packet.reviewerId, item.reviewerId);
  assert.equal(item.evaluationTextSha256, `sha256:${sha256Text(item.text)}`);
  const annotation = completedPacketItemToAnnotation(packet, item);
  assert.deepEqual(annotation, expectedAnnotation);
  assertSchemaValue(annotation, schema.$defs.reviewerAnnotation, schema, "annotation");
  for (const privateField of [
    "text",
    "contexts",
    "sourceUrl",
    "ruleTitle",
    "family",
  ]) {
    assert.ok(!Object.hasOwn(annotation, privateField), `${privateField} leaked`);
  }

  const draftPacket = structuredClone(packet);
  draftPacket.items[0].decision = null;
  draftPacket.items[0].reviewerConfidence = null;
  assertSchemaValue(draftPacket, schema.$defs.reviewPacket, schema, "draftPacket");
  assert.throws(
    () => completedPacketItemToAnnotation(draftPacket, draftPacket.items[0]),
    /not completed/,
  );
});

test("runtime schema validation rejects malformed expert decisions", () => {
  const adjudication = JSON.parse(
    readFileSync(
      "data/legal-evaluation/examples/adjudication.synthetic.json",
      "utf8",
    ),
  );
  assertLegalEvaluationContract(adjudication, "adjudication");

  const emptyDecision = structuredClone(adjudication);
  emptyDecision.finalDecision = {};
  assert.throws(
    () => assertLegalEvaluationContract(emptyDecision, "adjudication"),
    /Invalid adjudication/,
  );

  const leakingDecision = structuredClone(adjudication);
  leakingDecision.finalDecision.policyText = "private policy text";
  assert.throws(
    () => assertLegalEvaluationContract(leakingDecision, "adjudication"),
    /Invalid adjudication/,
  );

  const contradictory = structuredClone(adjudication.finalDecision);
  contradictory.goldLabel = "confirmed_disclosure";
  contradictory.severity = "high";
  assert.throws(
    () => assertLegalEvaluationDecision(contradictory, "contradictory decision"),
    /confirmed disclosure requires severity pass/,
  );

  const ungroundedMissing = structuredClone(adjudication.finalDecision);
  ungroundedMissing.applicability = "applicable";
  ungroundedMissing.goldLabel = "possible_missing_disclosure";
  ungroundedMissing.severity = "medium";
  ungroundedMissing.requiresFactualVerification = false;
  ungroundedMissing.evidence = [];
  assert.throws(
    () => assertLegalEvaluationDecision(ungroundedMissing, "missing decision"),
    /requires an absence trace/,
  );

  const unsupportedLegalBasis = structuredClone(adjudication.finalDecision);
  unsupportedLegalBasis.legalBases = unsupportedLegalBasis.legalBases.map((basis) => ({
    ...basis,
    fit: "incorrect",
  }));
  assert.throws(
    () => assertLegalEvaluationDecision(unsupportedLegalBasis, "incorrect legal basis"),
    /supporting legal basis/,
  );
});

test("direct corpus evaluation rejects contradictory structured reviewer decisions", () => {
  const corpus = createCorpus();
  const adjudication = JSON.parse(
    readFileSync(
      "data/legal-evaluation/examples/adjudication.synthetic.json",
      "utf8",
    ),
  );
  const contradictory = structuredClone(adjudication.finalDecision);
  contradictory.applicability = "applicable";
  contradictory.goldLabel = "confirmed_disclosure";
  contradictory.severity = "high";
  contradictory.defectCodes = [];
  contradictory.requiresFactualVerification = false;
  corpus.annotations[0].structuredDecision = contradictory;

  assert.throws(
    () => evaluateLegalAccuracyCorpus(corpus, evaluationOptions),
    (error) =>
      error instanceof LegalAccuracyConfigurationError &&
      /confirmed disclosure requires severity pass/.test(error.message),
  );

  const malformed = createCorpus();
  malformed.annotations[0].structuredDecision = "finding";
  assert.throws(
    () => evaluateLegalAccuracyCorpus(malformed, evaluationOptions),
    (error) =>
      error instanceof LegalAccuracyConfigurationError &&
      /structured annotation decision/.test(error.message),
  );
});

test("artifact guard rejects tracked-shape private reviews outside synthetic examples", (t) => {
  const root = mkdtempSync(join(tmpdir(), "law-lens-private-artifact-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const privatePath = join(root, "review.json");
  writeFileSync(
    privatePath,
    `${JSON.stringify({ recordType: "legal_evaluation_review_packet" })}\n`,
    "utf8",
  );
  const rejected = spawnSync(
    process.execPath,
    ["scripts/check-legal-evaluation-artifacts.mjs", "--files", privatePath],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /private legal-evaluation contract is tracked/);

  const allowed = spawnSync(
    process.execPath,
    [
      "scripts/check-legal-evaluation-artifacts.mjs",
      "--files",
      "data/legal-evaluation/examples/reviewer-a.synthetic.json",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(allowed.status, 0, allowed.stderr);
});

test("reviewer annotation batch preserves document binding without private text", () => {
  const schema = JSON.parse(
    readFileSync("data/legal-evaluation/evaluation.schema.json", "utf8"),
  );
  const batch = JSON.parse(
    readFileSync(
      "data/legal-evaluation/examples/reviewer-annotations-batch.synthetic.json",
      "utf8",
    ),
  );
  const expectedAnnotation = JSON.parse(
    readFileSync(
      "data/legal-evaluation/examples/reviewer-from-packet.synthetic.json",
      "utf8",
    ),
  );

  assertSchemaValue(batch, schema.$defs.reviewerAnnotationBatch, schema, "batch");
  assert.deepEqual(batch.annotations, [expectedAnnotation]);
  assert.ok(
    batch.annotations.every(
      (annotation) =>
        annotation.reviewerId === batch.reviewerId &&
        annotation.evaluationId === batch.evaluationId &&
        annotation.corpusVersion === batch.corpusVersion &&
        annotation.runtimeManifestHash === batch.runtimeManifestHash,
    ),
  );
  for (const annotation of batch.annotations) {
    assert.match(annotation.evaluationTextSha256, /^sha256:[a-f0-9]{64}$/);
    assert.ok(!Object.hasOwn(annotation, "text"));
    assert.ok(!Object.hasOwn(annotation, "contexts"));
    assert.ok(!Object.hasOwn(annotation, "sourceUrl"));
  }
  const leakedBatch = structuredClone(batch);
  leakedBatch.annotations[0].text = "private policy text";
  assert.throws(
    () =>
      assertSchemaValue(
        leakedBatch,
        schema.$defs.reviewerAnnotationBatch,
        schema,
        "leakedBatch",
      ),
    /unexpected property text/,
  );
});
