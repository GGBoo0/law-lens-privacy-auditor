#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Text } from "../lib/legal-accuracy-evaluator.mjs";
import { assertLegalEvaluationContract } from "../lib/legal-evaluation-schema.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REVIEWER_CONFIDENCE = new Set(["high", "medium", "low"]);
const APPLICABILITY = new Set(["applicable", "notApplicable", "unknown"]);
const GOLD_LABELS = new Set([
  "confirmed_disclosure",
  "possible_missing_disclosure",
  "ambiguity_or_inconsistency",
  "factual_verification",
  "insufficient_evidence",
]);
const SEVERITIES = new Set(["high", "medium", "low", "pass", "na"]);

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

function safeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function assertCompletedDecision(item) {
  const decision = item.decision;
  if (!decision || typeof decision !== "object") {
    throw new Error(`${item.annotationId ?? item.caseId ?? "item"}: decision is incomplete`);
  }
  if (
    !APPLICABILITY.has(decision.applicability) ||
    !GOLD_LABELS.has(decision.goldLabel) ||
    !SEVERITIES.has(decision.severity) ||
    !Array.isArray(decision.defectCodes) ||
    !Array.isArray(decision.evidence) ||
    !Array.isArray(decision.legalBases) ||
    typeof decision.requiresFactualVerification !== "boolean" ||
    typeof decision.rationale !== "string" ||
    !decision.rationale.trim()
  ) {
    throw new Error(`${item.annotationId}: decision does not match the review contract`);
  }
}

function completedItemToAnnotation(packet, item) {
  if (!item || typeof item !== "object") {
    throw new Error("Review packet contains an invalid item");
  }
  const actualEvaluationTextHash = sha256Text(item.text);
  const expectedEvaluationTextHash = String(item.evaluationTextSha256)
    .replace(/^sha256:/i, "")
    .toLowerCase();
  if (actualEvaluationTextHash !== expectedEvaluationTextHash) {
    throw new Error(
      `${item.annotationId ?? item.caseId ?? "item"}: evaluationTextSha256 does not match item.text`,
    );
  }
  assertCompletedDecision(item);
  if (!REVIEWER_CONFIDENCE.has(item.reviewerConfidence)) {
    throw new Error(
      `${item.annotationId ?? item.caseId ?? "item"}: reviewerConfidence is incomplete`,
    );
  }
  if (item.reviewerId !== packet.reviewerId) {
    throw new Error(`${item.annotationId}: reviewerId does not match the packet`);
  }
  if (
    item.rulesetVersion !== packet.rulesetVersion ||
    item.legalAsOfDate !== packet.legalAsOfDate
  ) {
    throw new Error(`${item.annotationId}: legal pins do not match the packet`);
  }
  if (
    item.reviewMode?.independent !== true ||
    item.reviewMode?.blindToSystemOutput !== true ||
    item.reviewMode?.systemOutputViewed !== false
  ) {
    throw new Error(`${item.annotationId}: blinded independent review flags are invalid`);
  }
  if (item.synthetic === true && item.eligibleForMetrics !== false) {
    throw new Error(`${item.annotationId}: synthetic labels cannot be metric eligible`);
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

const options = parseArgs(process.argv.slice(2));
if (typeof options.packet !== "string" || !options.packet.trim()) {
  throw new Error("--packet <completed-review-packet.json> is required");
}
const packetPath = resolve(repositoryRoot, options.packet);
const packet = JSON.parse(await readFile(packetPath, "utf8"));
assertLegalEvaluationContract(packet, "reviewPacket", "review packet");
if (
  packet.recordType !== "legal_evaluation_review_packet" ||
  packet.privateArtifact !== true ||
  !Array.isArray(packet.items) ||
  packet.items.length === 0
) {
  throw new Error("Input is not a private legal evaluation review packet");
}
const annotations = packet.items.map((item) =>
  completedItemToAnnotation(packet, item),
);
for (const annotation of annotations) {
  assertLegalEvaluationContract(
    annotation,
    "reviewerAnnotation",
    `reviewer annotation ${annotation.annotationId}`,
  );
}
if (new Set(annotations.map((item) => item.annotationId)).size !== annotations.length) {
  throw new Error("Review packet contains duplicate annotationId values");
}

const batch = {
  recordType: "legal_evaluation_reviewer_annotation_batch",
  schemaVersion: packet.schemaVersion,
  evaluationId: packet.evaluationId,
  reviewerId: packet.reviewerId,
  corpusVersion: packet.corpusVersion,
  runtimeManifestHash: packet.runtimeManifestHash,
  annotations,
};
assertLegalEvaluationContract(batch, "reviewerAnnotationBatch", "annotation batch");
const outputPath = resolve(
  repositoryRoot,
  String(
    options.output ??
      `work/legal-evaluation/annotations/${safeFilePart(packet.reviewerId)}.json`,
  ),
);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(batch, null, 2)}\n`, "utf8");
process.stdout.write(
  `${outputPath}\n${annotations.length} label-only reviewer annotations exported\n`,
);
