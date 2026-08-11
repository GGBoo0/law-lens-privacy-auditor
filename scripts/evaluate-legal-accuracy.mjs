#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LEGAL_BASELINE } from "../lib/legal-baseline.ts";
import { assertLegalEvaluationContract } from "../lib/legal-evaluation-schema.mjs";
import { analyzePrivacyPolicy } from "../lib/privacy-analyzer.ts";
import {
  evaluateLegalAccuracyCorpus,
  sha256Text,
} from "../lib/legal-accuracy-evaluator.mjs";
import {
  canonicalizeLegalAccuracyRuleId,
  LEGAL_ACCURACY_RULES,
} from "../lib/legal-accuracy-taxonomy.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const [name, inline] = argument.slice(2).split("=", 2);
    const value = inline ?? argv[index + 1];
    if (inline === undefined && value && !value.startsWith("--")) index += 1;
    options[name] = inline ?? (value?.startsWith("--") ? true : value ?? true);
  }
  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function attachContractMeta(records, payload) {
  const contractMeta = {
    corpusVersion: payload?.corpusVersion,
    evaluationId: payload?.evaluationId,
    reviewerId: payload?.reviewerId,
    runtimeManifestHash: payload?.runtimeManifestHash,
    schemaVersion: payload?.schemaVersion,
  };
  return records.map((record) => ({ ...record, __contractMeta: contractMeta }));
}

function payloadArray(payload, key) {
  if (key === "annotations") {
    if (payload?.recordType === "legal_evaluation_reviewer_annotation_batch") {
      assertLegalEvaluationContract(payload, "reviewerAnnotationBatch");
      return attachContractMeta(payload.annotations, payload);
    }
    if (payload?.recordType === "legal_evaluation_review_packet") {
      assertLegalEvaluationContract(payload, "reviewPacket");
      return attachContractMeta(payload.items, payload);
    }
    if (payload?.recordType === "legal_evaluation_reviewer_annotation") {
      assertLegalEvaluationContract(payload, "reviewerAnnotation");
      return [payload];
    }
    const annotations = Array.isArray(payload) ? payload : payload?.annotations;
    if (Array.isArray(annotations)) {
      for (const annotation of annotations) {
        assertLegalEvaluationContract(annotation, "reviewerAnnotation");
      }
      return annotations;
    }
  }
  if (key === "adjudications") {
    if (payload?.recordType === "legal_evaluation_adjudication") {
      assertLegalEvaluationContract(payload, "adjudication");
      return [payload];
    }
    const adjudications = Array.isArray(payload)
      ? payload
      : payload?.adjudications;
    if (Array.isArray(adjudications)) {
      for (const adjudication of adjudications) {
        assertLegalEvaluationContract(adjudication, "adjudication");
      }
      return adjudications;
    }
  }
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  throw new Error(`${key} file must contain an array or { ${key}: [] }`);
}

async function loadOptionalPart(config, configDirectory, override, keys, resultKey) {
  if (Array.isArray(config[resultKey])) return config[resultKey];
  const configured =
    override ?? keys.map((key) => config[key]).find((value) => typeof value === "string");
  if (!configured) return [];
  const baseDirectory = typeof override === "string" ? repositoryRoot : configDirectory;
  const paths = String(configured)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const records = [];
  for (const configuredPath of paths) {
    const path = resolve(baseDirectory, configuredPath);
    records.push(...payloadArray(await readJson(path), resultKey));
  }
  return records;
}

function normalizedMode(value) {
  return value === "policyOnly"
    ? "policy_only"
    : value === "contextAssisted"
      ? "context_assisted"
      : value;
}

function decisionFromContract(decision) {
  if (!decision || typeof decision !== "object") return null;
  if (decision.applicability === "notApplicable") return "not_applicable";
  if (decision.goldLabel === "factual_verification") return "finding";
  if (
    decision.applicability === "unknown" ||
    decision.goldLabel === "insufficient_evidence"
  ) {
    return "uncertain";
  }
  return decision.goldLabel === "confirmed_disclosure"
    ? "no_finding"
    : "finding";
}

function adaptContractData(config, cases, gold, annotations, adjudications) {
  const expectedEvaluationId = config.evaluationId ?? config.corpusVersion;
  const expectedCorpusVersion = config.corpusVersion ?? config.evaluationId;
  for (const item of annotations) {
    if (!item.decision || typeof item.decision !== "object") {
      throw new Error(`${item.annotationId ?? item.caseId}: review is incomplete`);
    }
    const contractMeta = item.__contractMeta ?? {};
    const evaluationId = item.evaluationId ?? contractMeta.evaluationId;
    const corpusVersion = item.corpusVersion ?? contractMeta.corpusVersion;
    const schemaVersion = item.schemaVersion ?? contractMeta.schemaVersion;
    if (evaluationId !== expectedEvaluationId) {
      throw new Error(`${item.annotationId}: evaluationId does not match config`);
    }
    if (corpusVersion !== expectedCorpusVersion) {
      throw new Error(`${item.annotationId}: corpusVersion does not match config`);
    }
    if (schemaVersion !== config.schemaVersion) {
      throw new Error(`${item.annotationId}: schemaVersion does not match config`);
    }
    if (
      contractMeta.reviewerId &&
      item.reviewerId !== contractMeta.reviewerId
    ) {
      throw new Error(`${item.annotationId}: reviewerId does not match its batch`);
    }
  }
  for (const item of adjudications) {
    if (item.evaluationId !== expectedEvaluationId) {
      throw new Error(`${item.adjudicationId}: evaluationId does not match config`);
    }
    if (item.corpusVersion !== expectedCorpusVersion) {
      throw new Error(`${item.adjudicationId}: corpusVersion does not match config`);
    }
  }
  const annotationById = new Map(
    annotations.map((item) => [item.annotationId, item]),
  );
  const normalizedCases = cases.map((item) => ({
    ...item,
    id: item.id ?? item.caseId,
    track: normalizedMode(item.track),
    documentHash:
      item.evaluationTextSha256 ?? item.documentHash ?? item.source?.documentSha256,
    documentScope:
      item.documentScope ??
      (item.documentCompleteness === "partial" ? "partial" : "full_policy"),
    sourceUrl: item.sourceUrl ?? item.source?.sourceUrl,
    policyUrl: item.policyUrl ?? item.source?.policyUrl,
    retrievedAt: item.retrievedAt ?? item.source?.retrievedAt,
  }));
  const caseById = new Map(normalizedCases.map((item) => [item.id, item]));
  const normalizedAnnotations = annotations.map((item) => ({
    ...item,
    evaluationId: item.evaluationId ?? item.__contractMeta?.evaluationId,
    corpusVersion: item.corpusVersion ?? item.__contractMeta?.corpusVersion,
    runtimeManifestHash:
      item.runtimeManifestHash ?? item.__contractMeta?.runtimeManifestHash,
    schemaVersion: item.schemaVersion ?? item.__contractMeta?.schemaVersion,
    mode: normalizedMode(
      item.mode ?? item.track ?? caseById.get(item.caseId)?.track,
    ),
    ruleId: canonicalizeLegalAccuracyRuleId(item.ruleId) ?? item.ruleId,
    decision:
      typeof item.decision === "string"
        ? item.decision
        : decisionFromContract(item.decision),
  }));
  const adjudicatedGold = adjudications
    .filter((item) => item.eligibleForMetrics !== false && item.synthetic !== true)
    .map((item) => {
      const decision = item.finalDecision;
      const testCase = caseById.get(item.caseId);
      const reviewers = item.inputAnnotationIds
        ?.map((id) => annotationById.get(id)?.reviewerId)
        .filter(Boolean);
      const absence = decision?.evidence?.find(
        (entry) => entry.kind === "absence_trace",
      );
      return {
        caseId: item.caseId,
        mode: normalizedMode(item.mode ?? item.track ?? testCase?.track),
        ruleId: canonicalizeLegalAccuracyRuleId(item.ruleId) ?? item.ruleId,
        decision: decisionFromContract(decision),
        expectedSeverity: decision?.severity,
        expectedFindingType: decision?.goldLabel,
        expectedRequiresFactualVerification:
          decision?.requiresFactualVerification,
        corpusVersion: item.corpusVersion,
        evaluationId: item.evaluationId,
        evaluationTextSha256: item.evaluationTextSha256,
        runtimeManifestHash: item.runtimeManifestHash,
        evidence: decision?.evidence?.filter((entry) => entry.kind === "span") ?? [],
        absenceTrace: absence
          ? {
              documentHash: testCase?.documentHash,
              checkedSections: absence.checkedSections ?? [],
              checkedFields: absence.checkedFields ?? [],
              support: absence.support,
            }
          : null,
        adjudication: {
          status: "adjudicated",
          reviewerIds: reviewers ?? [],
          inputAnnotationIds: item.inputAnnotationIds ?? [],
        },
      };
    });
  return {
    cases: normalizedCases,
    gold: adjudicatedGold.length ? adjudicatedGold : gold,
    annotations: normalizedAnnotations.filter(
      (item) => item.eligibleForMetrics !== false && item.synthetic !== true,
    ),
  };
}

async function loadCorpus(options) {
  const configPath = resolve(
    repositoryRoot,
    String(options.config ?? options.corpus ?? "data/legal-evaluation/config.json"),
  );
  const config = await readJson(configPath);
  assertLegalEvaluationContract(config, "evaluationConfig", "evaluation config");
  const configDirectory = dirname(configPath);
  const casesOverride =
    typeof options.cases === "string" ? options.cases : undefined;
  const configuredCasesPath =
    casesOverride ?? config.casesFile ?? config.casesPath ?? "cases.json";
  const publicCasesPath = resolve(
    casesOverride ? repositoryRoot : configDirectory,
    String(configuredCasesPath),
  );
  const publicCaseManifest = await readJson(publicCasesPath);
  if (publicCaseManifest?.recordType === "legal_evaluation_case_manifest") {
    assertLegalEvaluationContract(
      publicCaseManifest,
      "caseManifest",
      "public case manifest",
    );
  }
  const cases = await loadOptionalPart(
    config,
    configDirectory,
    casesOverride,
    ["casesFile", "casesPath"],
    "cases",
  );
  const gold = await loadOptionalPart(
    config,
    configDirectory,
    options.gold,
    ["goldFile", "goldPath"],
    "gold",
  );
  const annotations = await loadOptionalPart(
    config,
    configDirectory,
    options.annotations,
    ["annotationsFile", "annotationsPath"],
    "annotations",
  );
  const adjudications = await loadOptionalPart(
    config,
    configDirectory,
    options.adjudications,
    ["adjudicationsFile", "adjudicationsPath"],
    "adjudications",
  );

  const documentBase = dirname(publicCasesPath);
  for (const testCase of cases) {
    if (typeof testCase.text === "string") continue;
    const documentPath = testCase.documentPath ?? testCase.textFile;
    if (typeof documentPath !== "string") continue;
    testCase.text = await readFile(resolve(documentBase, documentPath), "utf8");
  }
  const adapted = adaptContractData(config, cases, gold, annotations, adjudications);
  const uniqueDates = [...new Set(adapted.cases.map((item) => item.legalAsOfDate).filter(Boolean))];
  const uniqueRulesets = [...new Set(adapted.cases.map((item) => item.rulesetVersion).filter(Boolean))];
  const modes = (config.modes ?? config.corpus?.tracks ?? [])
    .map(normalizedMode);
  const ruleIds = (config.ruleIds ?? LEGAL_ACCURACY_RULES.map((rule) => rule.id)).map(
    (ruleId) => canonicalizeLegalAccuracyRuleId(ruleId) ?? ruleId,
  );
  return {
    ...config,
    contractSchemaVersion: config.schemaVersion,
    schemaVersion: 1,
    corpusVersion: config.corpusVersion ?? config.evaluationId,
    datasetKind: "expert",
    rulesetVersion: config.rulesetVersion ?? uniqueRulesets[0],
    legalAsOfDate:
      config.legalAsOfDate ?? uniqueDates[0] ?? config.legalContext?.verifiedAt,
    modes: modes.length ? modes : ["policy_only", "context_assisted"],
    ruleIds,
    supportPolicy: {
      minPositivePerRule:
        config.supportPolicy?.minPositivePerRule ??
        config.minimumSampleRequirements?.perRuleGoldPositiveForRecall ??
        1,
      minNegativePerRule:
        config.supportPolicy?.minNegativePerRule ??
        config.minimumSampleRequirements?.perRuleGoldNegativeForF1 ??
        1,
      minPredictedPositivePerRule:
        config.supportPolicy?.minPredictedPositivePerRule ??
        config.minimumSampleRequirements?.perRulePredictedPositiveForPrecision ??
        1,
    },
    gate: {
      mode:
        config.gate?.mode ??
        (config.provisionalReleaseGate?.active && config.certified
          ? "enforced"
          : "calibration"),
      calibrated: config.certified === true,
      minCases:
        config.minimumSampleRequirements?.expertReviewedPoliciesForCertification,
      minDistinctCompanies:
        config.minimumSampleRequirements?.minimumDistinctCompanies,
      minSectors: config.minimumSampleRequirements?.minimumSectors,
      minLockedTestFraction:
        config.minimumSampleRequirements?.lockedTestFractionMinimum,
      minHighRiskGold:
        config.minimumSampleRequirements?.highRiskGoldPositiveTotal,
      minHighRiskFamilies:
        config.minimumSampleRequirements?.highRiskMinimumRuleFamilies,
      maxHighRiskSingleFamilyFraction:
        config.minimumSampleRequirements?.highRiskMaximumSingleFamilyFraction,
      thresholds: {
        minMacroF1:
          config.provisionalReleaseGate?.thresholds
            ?.rule_balanced_actionable_macro_f1?.minimumPointEstimate,
        minHighStrictActionableRecall:
          config.provisionalReleaseGate?.thresholds?.high_risk_recall_strict
            ?.minimumPointEstimate,
        minStrictEvidenceGroundingRate:
          config.provisionalReleaseGate?.thresholds
            ?.strict_evidence_grounding_rate?.minimumPointEstimate,
        minPossibleMissingPrecision:
          config.provisionalReleaseGate?.thresholds?.possible_missing_precision
            ?.minimumPointEstimate,
        maxUnsafeHighEscalationRate:
          config.provisionalReleaseGate?.thresholds?.unsafe_high_escalation_rate
            ?.maximumPointEstimate,
        minCohenKappa:
          config.provisionalReleaseGate?.thresholds?.cohen_kappa
            ?.minimumPointEstimate,
      },
    },
    ...adapted,
    configPath,
    publicCaseManifest,
  };
}

function containsForbiddenPublicPayload(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenPublicPayload);
  const forbiddenKeys = new Set([
    "adjudicationId",
    "annotationId",
    "companyId",
    "corpusRef",
    "decision",
    "text",
    "documentText",
    "evidence",
    "finalDecision",
    "goldLabel",
    "policyText",
    "policyUrl",
    "rawHtml",
    "html",
    "inputAnnotationIds",
    "legalBases",
    "rationale",
    "reviewerId",
    "source",
    "sourceUrl",
    "split",
  ]);
  return Object.entries(value).some(
    ([key, entry]) =>
      forbiddenKeys.has(key) ||
      containsForbiddenPublicPayload(entry),
  );
}

function validatePublicPendingContract(corpus) {
  const errors = [];
  const manifest = corpus.publicCaseManifest;
  if (corpus.recordType !== "legal_evaluation_config") {
    errors.push("config recordType is invalid");
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(corpus.contractSchemaVersion ?? ""))) {
    errors.push("config schemaVersion is invalid");
  }
  if (corpus.status !== "calibration_pending" || corpus.certified !== false) {
    errors.push("pending config status/certified fields are inconsistent");
  }
  if (corpus.provisionalReleaseGate?.active !== false) {
    errors.push("pending config must keep the performance gate inactive");
  }
  if (corpus.currentState?.metrics !== null) {
    errors.push("pending config must not publish accuracy metrics");
  }
  if (manifest?.recordType !== "legal_evaluation_case_manifest") {
    errors.push("case manifest recordType is invalid");
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest?.schemaVersion ?? ""))) {
    errors.push("case manifest schemaVersion is invalid");
  }
  if (!Array.isArray(manifest?.cases) || manifest.caseCount !== manifest.cases.length) {
    errors.push("case manifest count does not match cases[]");
  }
  if (manifest?.containsFullPolicyText !== false) {
    errors.push("public case manifest must not contain full policy text");
  }
  if (manifest?.containsExpertLabels !== false) {
    errors.push("public pending manifest must not claim expert labels");
  }
  if (containsForbiddenPublicPayload(manifest?.cases)) {
    errors.push("public case manifest contains private labels or raw policy text");
  }
  const reviewedPolicies = corpus.currentState?.expertReviewedPolicies;
  if (
    !Number.isInteger(reviewedPolicies) ||
    reviewedPolicies < 0 ||
    reviewedPolicies > (manifest?.caseCount ?? -1)
  ) {
    errors.push("current expertReviewedPolicies exceeds the public case manifest");
  }
  if (errors.length) throw new Error(`Invalid public pending contract: ${errors.join("; ")}`);
}

function pendingMarkdown(corpus, reason) {
  return `# 법률 판단 정확도 평가\n\n- 상태: calibration_pending\n- 평가 ID: ${corpus.evaluationId ?? "unknown"}\n- 전문가 검토 사례: ${corpus.currentState?.expertReviewedPolicies ?? 0}개\n- 안내: ${reason}\n`;
}

function percent(value) {
  return value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function markdown(report) {
  return `# 법률 판단 정확도 평가\n\n` +
    `- 코퍼스: ${report.corpusVersion}\n` +
    `- 규칙셋: ${report.rulesetVersion}\n` +
    `- 사례: ${report.caseCount}개 · 분석 실행: ${report.analysisRunCount}회\n` +
    `- 게이트: ${report.gate.status} (${report.gate.mode})\n\n` +
    `| 지표 | 결과 |\n|---|---:|\n` +
    `| Micro precision | ${percent(report.metrics.micro.precision)} |\n` +
    `| Micro recall | ${percent(report.metrics.micro.recall)} |\n` +
    `| Micro F1 | ${percent(report.metrics.micro.f1)} |\n` +
    `| Macro F1 | ${percent(report.metrics.macro.f1)} |\n` +
    `| 누락 가능성 precision | ${percent(report.special.possibleMissing.precision)} |\n` +
    `| 고위험 엄격 판정 recall | ${percent(report.special.highStrictActionable.recall)} |\n` +
    `| 엄격 근거 grounding | ${percent(report.evidence.strictEvidenceGroundingRate)} |\n` +
    `| Cohen kappa | ${report.agreement.meanPairwiseKappa?.toFixed(3) ?? "n/a"} |\n` +
    (report.gate.failures.length
      ? `\n## 게이트 실패\n\n${report.gate.failures.map((failure) => `- ${failure}`).join("\n")}\n`
      : "");
}

const options = parseArgs(process.argv.slice(2));
const corpus = await loadCorpus(options);
const runtimeManifestOverride =
  typeof options["runtime-manifest"] === "string"
    ? options["runtime-manifest"]
    : undefined;
const configuredRuntimeManifest =
  typeof corpus.runtimeManifestFile === "string"
    ? corpus.runtimeManifestFile
    : undefined;
const manifestPath = resolve(
  runtimeManifestOverride || !configuredRuntimeManifest
    ? repositoryRoot
    : dirname(corpus.configPath),
  String(
    runtimeManifestOverride ??
      configuredRuntimeManifest ??
      "data/legal-runtime-manifest.json",
  ),
);
const runtimeManifestRaw = await readFile(manifestPath, "utf8");
const runtimeLegalManifest = JSON.parse(runtimeManifestRaw);
const actualRuntimeManifestHash = sha256Text(runtimeManifestRaw);
const requestedRuntimeManifestHash =
  typeof options["runtime-manifest-hash"] === "string"
    ? options["runtime-manifest-hash"].replace(/^sha256:/, "").toLowerCase()
    : null;
if (
  requestedRuntimeManifestHash &&
  requestedRuntimeManifestHash !== actualRuntimeManifestHash
) {
  throw new Error("--runtime-manifest-hash does not match the runtime manifest bytes");
}
if (
  corpus.cases.length === 0 ||
  corpus.gold.length === 0 ||
  corpus.ruleIds.length === 0 ||
  corpus.cases.some((item) => typeof item.text !== "string")
) {
  validatePublicPendingContract(corpus);
  const reason =
    "공개 저장소에는 전문가 원문·확정 라벨이 없으므로 성능 수치를 계산하지 않았습니다.";
  const output = pendingMarkdown(corpus, reason);
  process.stdout.write(output);
  if (options["json-out"]) {
    await writeFile(
      resolve(repositoryRoot, String(options["json-out"])),
      `${JSON.stringify({
        schemaVersion: 1,
        evaluationId: corpus.evaluationId,
        status: "calibration_pending",
        certified: false,
        expertReviewedPolicies:
          corpus.currentState?.expertReviewedPolicies ?? corpus.cases.length,
        metrics: null,
        reason,
      }, null, 2)}\n`,
      "utf8",
    );
  }
  if (options["markdown-out"]) {
    await writeFile(
      resolve(repositoryRoot, String(options["markdown-out"])),
      output,
      "utf8",
    );
  }
  if (options["require-expert-results"]) process.exitCode = 1;
} else {
  corpus.runtimeManifestHash ??= `sha256:${actualRuntimeManifestHash}`;
const report = evaluateLegalAccuracyCorpus(corpus, {
  analyze: analyzePrivacyPolicy,
  runtimeLegalManifest,
  runtimeManifestHash: actualRuntimeManifestHash,
  activeRulesetVersion: LEGAL_BASELINE.rulesetVersion,
});

const publicReport = {
  ...report,
  sampleIntegrity: {
    distinctCompanyCount: report.sampleIntegrity.distinctCompanyCount,
    distinctSectorCount: report.sampleIntegrity.distinctSectorCount,
    distinctDocumentCount: report.sampleIntegrity.distinctDocumentCount,
    lockedTestCaseCount: report.sampleIntegrity.lockedTestCaseCount,
    lockedTestFraction: report.sampleIntegrity.lockedTestFraction,
    splitViolatingCompanyCount:
      report.sampleIntegrity.splitViolatingCompanies.length,
    duplicateDocumentCount:
      report.sampleIntegrity.duplicateDocumentHashes.length,
    missingCompanyIdCount: report.sampleIntegrity.missingCompanyIds.length,
    missingSectorCount: report.sampleIntegrity.missingSectors.length,
    missingSplitCount: report.sampleIntegrity.missingSplits.length,
  },
  agreement: {
    status: report.agreement.status,
    reviewerCount: report.agreement.reviewerCount,
    meanPairwiseKappa: report.agreement.meanPairwiseKappa,
    byMode: Object.fromEntries(
      Object.entries(report.agreement.byMode).map(([mode, value]) => [
        mode,
        {
          status: value.status,
          meanPairwiseKappa: value.meanPairwiseKappa,
        },
      ]),
    ),
  },
};
delete publicReport.rows;
if (options["json-out"]) {
  await writeFile(
    resolve(repositoryRoot, String(options["json-out"])),
    `${JSON.stringify(publicReport, null, 2)}\n`,
    "utf8",
  );
}
if (options["markdown-out"]) {
  await writeFile(
    resolve(repositoryRoot, String(options["markdown-out"])),
    markdown(report),
    "utf8",
  );
}

process.stdout.write(markdown(report));
if (report.gate.enforced && report.gate.status !== "pass") process.exitCode = 1;
}
