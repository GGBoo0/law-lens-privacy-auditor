#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Text } from "../lib/legal-accuracy-evaluator.mjs";
import { LEGAL_BASELINE } from "../lib/legal-baseline.ts";
import { assertLegalEvaluationContract } from "../lib/legal-evaluation-schema.mjs";
import {
  canonicalizeLegalAccuracyRuleId,
  LEGAL_ACCURACY_RULE_BY_ID,
  LEGAL_ACCURACY_RULES,
} from "../lib/legal-accuracy-taxonomy.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const [name, inline] = argument.slice(2).split("=", 2);
    const value = inline ?? argv[index + 1];
    if (inline === undefined && value && !value.startsWith("--")) index += 1;
    result[name] = inline ?? (value?.startsWith("--") ? true : value ?? true);
  }
  return result;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const options = parseArgs(process.argv.slice(2));
if (typeof options.reviewer !== "string" || !options.reviewer.trim()) {
  throw new Error("--reviewer <pseudonymous-id> is required");
}
const configPath = resolve(
  repositoryRoot,
  String(options.config ?? "data/legal-evaluation/config.json"),
);
const config = await readJson(configPath);
const configDirectory = dirname(configPath);
const runtimeManifestOverride =
  typeof options["runtime-manifest"] === "string"
    ? options["runtime-manifest"]
    : undefined;
const configuredRuntimeManifest =
  typeof config.runtimeManifestFile === "string"
    ? config.runtimeManifestFile
    : undefined;
const runtimeManifestPath = resolve(
  runtimeManifestOverride || !configuredRuntimeManifest
    ? repositoryRoot
    : configDirectory,
  String(
    runtimeManifestOverride ??
      configuredRuntimeManifest ??
      "data/legal-runtime-manifest.json",
  ),
);
const runtimeManifestHash = `sha256:${sha256Text(
  await readFile(runtimeManifestPath, "utf8"),
)}`;
const casesOverride =
  typeof options.cases === "string" ? options.cases : undefined;
const casesPath = resolve(
  casesOverride ? repositoryRoot : configDirectory,
  String(casesOverride ?? config.casesFile ?? config.casesPath ?? "cases.json"),
);
const casesPayload = await readJson(casesPath);
const cases = Array.isArray(casesPayload) ? casesPayload : casesPayload.cases;
if (!Array.isArray(cases)) throw new Error("Cases file must contain cases[]");
if (cases.length === 0) {
  throw new Error(
    "No private evaluation cases are available; refusing to create a zero-item review packet",
  );
}
const reviewRulesetVersion = config.rulesetVersion ?? LEGAL_BASELINE.rulesetVersion;
const reviewLegalAsOfDate =
  config.legalAsOfDate ??
  config.legalContext?.verifiedAt ??
  LEGAL_BASELINE.verifiedAt;

for (const testCase of cases) {
  testCase.id ??= testCase.caseId;
  testCase.documentHash ??=
    testCase.evaluationTextSha256 ?? testCase.source?.documentSha256;
  testCase.documentScope ??=
    testCase.documentCompleteness === "fullDocument" ? "full_policy" : "partial";
  testCase.sourceUrl ??= testCase.source?.sourceUrl;
  testCase.policyUrl ??= testCase.source?.policyUrl;
  if (typeof testCase.text !== "string") {
    const documentPath = testCase.documentPath ?? testCase.textFile;
    if (typeof documentPath !== "string") {
      throw new Error(`${testCase.id}: text or documentPath is required`);
    }
    testCase.text = await readFile(resolve(dirname(casesPath), documentPath), "utf8");
  }
  const actualHash = sha256Text(testCase.text);
  const expectedHash = String(testCase.documentHash ?? "").replace(/^sha256:/, "");
  if (actualHash !== expectedHash) {
    throw new Error(`${testCase.id}: documentHash mismatch`);
  }
  testCase.evaluationTextSha256 = `sha256:${actualHash}`;
  if (
    testCase.legalAsOfDate &&
    testCase.legalAsOfDate !== reviewLegalAsOfDate
  ) {
    throw new Error(`${testCase.id}: legalAsOfDate does not match the review pin`);
  }
  if (
    testCase.rulesetVersion &&
    testCase.rulesetVersion !== reviewRulesetVersion
  ) {
    throw new Error(`${testCase.id}: rulesetVersion does not match the review pin`);
  }
}

const normalizeMode = (mode) =>
  mode === "policyOnly"
    ? "policy_only"
    : mode === "contextAssisted"
      ? "context_assisted"
      : mode;
const contractTrack = (mode) =>
  mode === "policy_only" ? "policyOnly" : "contextAssisted";
const normalizeContexts = (contexts) => {
  const normalized = {};
  for (const [key, value] of Object.entries(contexts ?? {})) {
    if (!["auto", "yes", "no"].includes(value)) {
      throw new Error(`Unsupported context value for ${key}: ${value}`);
    }
    normalized[key] = value;
  }
  return normalized;
};
const configuredRuleIds =
  typeof options.rules === "string"
    ? options.rules.split(",").map((value) => value.trim()).filter(Boolean)
    : config.ruleIds ?? LEGAL_ACCURACY_RULES.map((rule) => rule.id);
const ruleIds = configuredRuleIds.map(
  (ruleId) => canonicalizeLegalAccuracyRuleId(ruleId) ?? ruleId,
);
const items = [];
for (const testCase of cases) {
  const modes = testCase.track
    ? [normalizeMode(testCase.track)]
    : (config.modes ?? config.corpus?.tracks ?? ["policy_only", "context_assisted"]).map(
        normalizeMode,
      );
  for (const mode of modes) {
    for (const ruleId of ruleIds) {
      const rule = LEGAL_ACCURACY_RULE_BY_ID.get(ruleId);
      if (!rule) throw new Error(`Unknown canonical rule id: ${ruleId}`);
      const track = contractTrack(mode);
      items.push({
        annotationId: `${testCase.id}-${mode}-${ruleId}-${options.reviewer}`,
        caseId: testCase.id,
        track,
        ruleId,
        ruleTitle: rule.title,
        family: rule.family,
        reviewerId: options.reviewer,
        synthetic: testCase.synthetic === true,
        eligibleForMetrics:
          testCase.synthetic !== true && testCase.eligibleForMetrics !== false,
        documentCompleteness:
          testCase.documentCompleteness ??
          (testCase.documentScope === "full_policy" ? "fullDocument" : "partial"),
        evaluationTextSha256: testCase.evaluationTextSha256,
        sourceUrl: testCase.policyUrl ?? testCase.sourceUrl,
        text: testCase.text,
        contexts:
          mode === "context_assisted"
            ? normalizeContexts(testCase.contexts)
            : {},
        legalAsOfDate: testCase.legalAsOfDate ?? reviewLegalAsOfDate,
        rulesetVersion: testCase.rulesetVersion ?? reviewRulesetVersion,
        guidelineVersion: testCase.guidelineVersion ?? "gold-v1-draft",
        reviewMode: {
          independent: true,
          blindToSystemOutput: true,
          systemOutputViewed: false,
        },
        decision: null,
        reviewerConfidence: null,
      });
    }
  }
}

const packet = {
  recordType: "legal_evaluation_review_packet",
  schemaVersion: config.schemaVersion ?? "1.0.0",
  evaluationId: config.evaluationId ?? config.corpusVersion ?? "legal-accuracy",
  packetId: `${config.evaluationId ?? config.corpusVersion ?? "legal-accuracy"}-${String(options.reviewer).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
  reviewerId: options.reviewer,
  corpusVersion: config.corpusVersion ?? config.evaluationId,
  rulesetVersion: reviewRulesetVersion,
  legalAsOfDate: reviewLegalAsOfDate,
  runtimeManifestHash,
  privateArtifact: true,
  instructions: {
    decisionValues: config.labels?.goldLabel ?? [
      "confirmed_disclosure",
      "possible_missing_disclosure",
      "ambiguity_or_inconsistency",
      "factual_verification",
      "insufficient_evidence",
    ],
    note:
      "분석기 출력은 제공되지 않습니다. 원문과 고정 법령 기준만 보고 decision과 reviewerConfidence를 독립적으로 작성하세요. 완료본은 원문 필드를 제거한 reviewer annotation으로 변환해 보관하세요.",
  },
  items,
};
assertLegalEvaluationContract(packet, "reviewPacket", "prepared review packet");
const outputPath = resolve(
  repositoryRoot,
  String(
    options.output ??
      `work/legal-evaluation/review-${options.reviewer.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`,
  ),
);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
process.stdout.write(`${outputPath}\n${items.length} blinded review items prepared\n`);
