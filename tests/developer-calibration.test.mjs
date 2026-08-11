import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertDeveloperCalibrationDataset,
  buildDeveloperCalibrationAggregate,
  createEmptyDeveloperCalibrationDataset,
  DEVELOPER_CALIBRATION_DEFAULT_PINS,
  DEVELOPER_CALIBRATION_MAX_JSON_BYTES,
  DEVELOPER_CALIBRATION_SECTORS,
  DEVELOPER_CALIBRATION_SLOT_COUNT,
  DeveloperCalibrationValidationError,
  parseDeveloperCalibrationDataset,
  refreshDeveloperCalibrationAggregate,
  serializeDeveloperCalibrationDataset,
} from "../lib/developer-calibration.mjs";
import { LEGAL_BASELINE } from "../lib/legal-baseline.ts";
import {
  assertCalibrationAnalyzerOutputCompatible,
  assertCalibrationTransferCompatible,
  buildCalibrationTransferPayload,
  calibrationAnalyzerOutputIdentity,
  parseCalibrationTransferPayload,
} from "../lib/developer-calibration-transfer.ts";
import {
  presentationFromTransfer,
  sanitizeCalibrationWorkspace,
} from "../lib/developer-calibration-local.ts";

const status = JSON.parse(
  readFileSync(
    new URL("../data/developer-calibration/status.json", import.meta.url),
    "utf8",
  ),
);

async function fetchBuiltPage(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "developer-calibration-page-test",
    `${process.pid}-${Date.now()}-${Math.random()}`,
  );
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

function hash(character) {
  return `sha256:${character.repeat(64)}`;
}

function calibrationTransferFixture() {
  const evidence = "해외 서버에서 개인정보를 보관합니다.";
  return {
    sourceUrl: "https://private.example/internal-entry",
    policyUrl: "https://private.example/privacy?account=secret",
    policyTitle: "테스트 처리방침",
    retrievedAt: "2026-08-12T00:00:00.000Z",
    documentHash: "a".repeat(64),
    policyExcerpt: `RAW_POLICY_SECRET ${evidence} 원문 나머지`,
    humanReview: {
      entries: [{ memo: "HUMAN_REVIEW_MEMO_SECRET" }],
    },
    legalBaseline: {
      rulesetVersion: LEGAL_BASELINE.rulesetVersion,
      asOfDate: "2026-08-12",
      overdueLegalReview: false,
      runtimeManifest: {
        source: "live",
        status: "valid",
        generatedAt: "2026-08-11T23:59:00.000Z",
        canonicalSha256: "c".repeat(64),
        legalStateSha256: "d".repeat(64),
      },
    },
    analysisEngine: { version: LEGAL_BASELINE.rulesetVersion },
    findings: [
      {
        id: "overseas-transfer",
        ruleId: "overseas.transfer",
        category: "국외 이전",
        title: "국외 이전 고지 확인",
        severity: "medium",
        findingType: "possible_missing_disclosure",
        requiresFactualVerification: true,
        summary: "국외 이전 기재사항을 확인해야 합니다.",
        evidence,
        recommendation: "이전 국가와 이전받는 자를 확인하세요.",
        legalBasis: [
          {
            sourceId: "privacy-protection-act",
            article: "제28조의8",
            law: "개인정보 보호법",
          },
        ],
      },
    ],
  };
}

function completedCase({
  caseId = "case-alpha",
  sourceHash = hash("1"),
  inputHash = hash("2"),
  outputHash = hash("3"),
} = {}) {
  return {
    caseId,
    reviewMode: "developer_self_review",
    validationLevel: "not_expert_validated",
    documentCompleteness: "full",
    omissionCheckCompleted: true,
    analyzerFindingCount: 3,
    sourcePins: {
      sourceDocumentSha256: sourceHash,
      analysisInputSha256: inputHash,
      analyzerOutputSha256: outputHash,
      analyzerVersion: "KR-PRIVACY-2026.08.11-r4",
      rulesetVersion: "KR-PRIVACY-2026.08.11-r4",
      legalAsOfDate: "2026-08-12",
      runtimeManifestCanonicalSha256: hash("6"),
      runtimeLegalStateSha256: hash("7"),
      runtimeManifestSource: "live",
      runtimeManifestStatus: "valid",
      runtimeManifestGeneratedAt: "2026-08-11T23:59:00.000Z",
      retrievedAt: "2026-08-12T00:00:00.000Z",
      analyzedAt: "2026-08-12T00:01:00.000Z",
    },
    reviewedAt: "2026-08-12T00:02:00.000Z",
    findingReviews: [
      {
        findingId: "finding-one",
        ruleId: "core.purpose",
        decision: "confirmed",
        reasonCodes: [],
        severityFit: "appropriate",
        evidenceAssessment: {
          outcome: "supported",
          anchors: [{ start: 10, end: 20, anchorSha256: hash("4") }],
        },
        legalBasisAssessment: {
          outcome: "supported",
          basisRefs: [
            { sourceId: "privacy-protection-act", provisionId: "제30조" },
          ],
        },
      },
      {
        findingId: "finding-two",
        ruleId: "core.retention",
        decision: "false_positive",
        reasonCodes: ["disclosure_present"],
        severityFit: "overstated",
        evidenceAssessment: { outcome: "unsupported", anchors: [] },
        legalBasisAssessment: { outcome: "unsupported", basisRefs: [] },
      },
      {
        findingId: "finding-three",
        ruleId: "core.destruction",
        decision: "uncertain",
        reasonCodes: ["insufficient_context"],
        severityFit: "uncertain",
        evidenceAssessment: { outcome: "uncertain", anchors: [] },
        legalBasisAssessment: { outcome: "uncertain", basisRefs: [] },
      },
    ],
    manualMissedFindings: [
      {
        missedFindingId: "missed-one",
        ruleId: "overseas.transfer",
        severity: "medium",
        reasonCodes: ["missing_rule_output"],
        evidenceAssessment: {
          outcome: "supported",
          anchors: [{ start: 30, end: 45, anchorSha256: hash("5") }],
        },
        legalBasisAssessment: {
          outcome: "supported",
          basisRefs: [
            { sourceId: "privacy-protection-act", provisionId: "제28조의8" },
          ],
        },
      },
    ],
  };
}

function oneCompletedDataset() {
  const dataset = createEmptyDeveloperCalibrationDataset({
    now: "2026-08-12T00:03:00.000Z",
  });
  dataset.slots[0] = {
    ...dataset.slots[0],
    status: "completed",
    caseReview: completedCase(),
  };
  dataset.legalCohort = {
    runtimeLegalStateSha256: hash("7"),
    rulesetVersion: "KR-PRIVACY-2026.08.11-r4",
  };
  dataset.datasetRevision = 1;
  dataset.updatedAt = "2026-08-12T00:03:00.000Z";
  return refreshDeveloperCalibrationAggregate(dataset);
}

test("server-renders the calibration workspace with its safety boundaries", async () => {
  const response = await fetchBuiltPage("/calibration");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /분석 결과를 직접 교정해 보세요/);
  assert.match(html, /개발자 사전 교정 · 전문가 평가 아님/);
  assert.match(html, /기기 안에만 저장됩니다/);
  assert.match(html, /24개/);
  assert.match(html, /href="\/privacy"/);
});

test("keeps the home-to-calibration transfer action and public navigation wired", async () => {
  const homeSource = readFileSync(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    homeSource,
    /storeCalibrationTransferDraft\(result\)[\s\S]{0,160}router\.push\("\/calibration"\)/,
  );
  assert.match(
    homeSource,
    /onClick=\{openDeveloperCalibration\}[\s\S]{0,160}사전 교정으로 보내기/,
  );

  const response = await fetchBuiltPage("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /href="\/calibration"[^>]*>개발자 사전 교정<\/a>/);
});

test("publishes the calibration storage and transient-transfer notice", async () => {
  const response = await fetchBuiltPage("/privacy");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /IndexedDB에만 저장합니다/);
  assert.match(html, /처리방침 원문·발견 문구·URL을/);
  assert.match(html, /교정 화면이[\s\S]{0,180}읽는 즉시 삭제합니다/);
  assert.match(html, /IndexedDB나 교정용 백업에 남기지/);
});

test("ships an empty 24-slot, six-sector developer calibration dataset", () => {
  assertDeveloperCalibrationDataset(status);
  assert.equal(status.slots.length, DEVELOPER_CALIBRATION_SLOT_COUNT);
  assert.deepEqual(
    new Set(status.slots.map((slot) => slot.sector)),
    new Set(DEVELOPER_CALIBRATION_SECTORS),
  );
  for (const sector of DEVELOPER_CALIBRATION_SECTORS) {
    assert.equal(status.slots.filter((slot) => slot.sector === sector).length, 4);
  }
  assert.equal(status.reviewMode, "developer_self_review");
  assert.equal(status.validationLevel, "not_expert_validated");
  assert.equal(status.legalCohort, null);
});

test("pins the exact analyzer and legal source files used by the template", () => {
  const filePins = {
    analyzerSourceSha256: "../lib/privacy-analyzer.ts",
    ruleCatalogSha256: "../lib/legal-accuracy-taxonomy.mjs",
    legalRuntimeManifestSha256: "../data/legal-runtime-manifest.json",
    legalSourceSnapshotSha256: "../data/legal-source-snapshot.json",
  };

  assert.deepEqual(status.pins, DEVELOPER_CALIBRATION_DEFAULT_PINS);
  assert.equal(status.pins.rulesetVersion, LEGAL_BASELINE.rulesetVersion);
  assert.equal(status.pins.analyzerVersion, LEGAL_BASELINE.rulesetVersion);
  for (const [pinName, relativePath] of Object.entries(filePins)) {
    const normalizedText = readFileSync(
      new URL(relativePath, import.meta.url),
      "utf8",
    ).replace(/\r\n?/g, "\n");
    const actual = `sha256:${createHash("sha256")
      .update(normalizedText, "utf8")
      .digest("hex")}`;
    assert.equal(status.pins[pinName], actual, `${pinName} is stale`);
  }
});

test("computes only calibration counts and rates from completed reviews", () => {
  const dataset = oneCompletedDataset();
  const { calibrationCounts: counts, calibrationRates: rates } = dataset.aggregate;

  assert.equal(counts.completedSlots, 1);
  assert.equal(counts.findingDecisions, 3);
  assert.equal(counts.confirmed, 1);
  assert.equal(counts.falsePositive, 1);
  assert.equal(counts.uncertain, 1);
  assert.equal(counts.manualMissedFindings, 1);
  assert.equal(counts.omissionEligibleCompletedSlots, 1);
  assert.equal(rates.findingConfirmationRate, 0.333333);
  assert.equal(rates.falsePositiveRate, 0.333333);
  assert.equal(rates.uncertainDecisionRate, 0.333333);
  assert.equal(rates.omissionCheckedSlotMissRate, 1);
  assert.equal("legalAccuracy" in rates, false);
});

test("round-trips an export only after fail-closed validation", () => {
  const dataset = oneCompletedDataset();
  const exported = serializeDeveloperCalibrationDataset(dataset);
  const imported = parseDeveloperCalibrationDataset(exported);

  assert.deepEqual(imported, dataset);
  assert.equal(exported.includes("policyText"), false);
  assert.equal(exported.includes("sourceUrl"), false);
});

test("keeps raw text, URLs, review memos, and transient evidence out of local backups", () => {
  const transfer = buildCalibrationTransferPayload(calibrationTransferFixture());
  const transient = JSON.stringify(transfer);

  assert.equal(transient.includes("RAW_POLICY_SECRET"), false);
  assert.equal(transient.includes("private.example"), false);
  assert.equal(transient.includes("HUMAN_REVIEW_MEMO_SECRET"), false);
  assert.match(transient, /해외 서버에서 개인정보를 보관합니다/);

  const presentation = presentationFromTransfer("slot-01", transfer);
  const workspace = sanitizeCalibrationWorkspace({
    schemaVersion: 1,
    savedAt: "2026-08-12T00:05:00.000Z",
    dataset: oneCompletedDataset(),
    presentations: {
      "slot-01": {
        ...presentation,
        policyText: "RAW_POLICY_SECRET",
        sourceUrl: "https://private.example/privacy",
        reviewMemo: "HUMAN_REVIEW_MEMO_SECRET",
        findings: transfer.findings.map((finding) => ({
          ...finding,
          policyText: "RAW_POLICY_SECRET",
          sourceUrl: "https://private.example/privacy",
          reviewMemo: "HUMAN_REVIEW_MEMO_SECRET",
        })),
      },
    },
  });
  const backup = JSON.stringify(workspace);
  assert.equal(backup.includes("RAW_POLICY_SECRET"), false);
  assert.equal(backup.includes("private.example"), false);
  assert.equal(backup.includes("HUMAN_REVIEW_MEMO_SECRET"), false);
  assert.equal(backup.includes("해외 서버에서 개인정보를 보관합니다"), false);

  const canonical = serializeDeveloperCalibrationDataset(oneCompletedDataset());
  for (const forbidden of [
    "policyText",
    "policyUrl",
    "sourceUrl",
    "reviewMemo",
  ]) {
    assert.equal(canonical.includes(forbidden), false, forbidden);
  }
  assert.equal(
    canonical.includes("해외 서버에서 개인정보를 보관합니다"),
    false,
  );
});

test("rejects raw policy text and URL fields instead of silently stripping them", () => {
  for (const field of ["policyText", "policyUrl", "displayLabel"]) {
    const dataset = structuredClone(status);
    dataset.slots[0][field] = "원문 또는 식별 정보";
    assert.throws(
      () => assertDeveloperCalibrationDataset(dataset),
      DeveloperCalibrationValidationError,
    );
  }
});

test("rejects duplicate case IDs and document hashes", () => {
  const dataset = oneCompletedDataset();
  dataset.slots[1] = {
    ...dataset.slots[1],
    status: "completed",
    caseReview: completedCase({ outputHash: hash("6") }),
  };
  dataset.aggregate = buildDeveloperCalibrationAggregate(dataset);

  assert.throws(
    () => assertDeveloperCalibrationDataset(dataset),
    (error) =>
      error instanceof DeveloperCalibrationValidationError &&
      error.message.includes("duplicate caseId") &&
      error.message.includes("duplicate source document hash"),
  );
});

test("requires reasons for false positives and uncertain decisions", () => {
  const dataset = oneCompletedDataset();
  dataset.slots[0].caseReview.findingReviews[1].reasonCodes = [];
  dataset.aggregate = buildDeveloperCalibrationAggregate(dataset);

  assert.throws(
    () => assertDeveloperCalibrationDataset(dataset),
    /requires a structured reason code/,
  );
});

test("rejects case results produced by a different analyzer or ruleset", () => {
  for (const field of ["analyzerVersion", "rulesetVersion"]) {
    const dataset = oneCompletedDataset();
    dataset.slots[0].caseReview.sourcePins[field] = "KR-PRIVACY-old-r1";
    dataset.aggregate = buildDeveloperCalibrationAggregate(dataset);
    assert.throws(
      () => assertDeveloperCalibrationDataset(dataset),
      new RegExp(`${field} does not match dataset pins`),
    );
  }
});

test("pins active cases to one evaluation-affecting legal cohort", () => {
  const missingCohort = oneCompletedDataset();
  missingCohort.legalCohort = null;
  assert.throws(
    () => assertDeveloperCalibrationDataset(missingCohort),
    /active case requires a legal cohort/,
  );

  const wrongState = oneCompletedDataset();
  wrongState.slots[0].caseReview.sourcePins.runtimeLegalStateSha256 = hash("8");
  wrongState.aggregate = buildDeveloperCalibrationAggregate(wrongState);
  assert.throws(
    () => assertDeveloperCalibrationDataset(wrongState),
    /runtime legal state does not match legal cohort/,
  );

  const emptyWithCohort = createEmptyDeveloperCalibrationDataset();
  emptyWithCohort.legalCohort = {
    runtimeLegalStateSha256: hash("7"),
    rulesetVersion: emptyWithCohort.pins.rulesetVersion,
  };
  assert.throws(
    () => assertDeveloperCalibrationDataset(emptyWithCohort),
    /empty dataset must not have a legal cohort/,
  );
});

test("allows canonical runtime manifest revisions inside the same legal state", () => {
  const dataset = oneCompletedDataset();
  const second = completedCase({
    caseId: "case-beta",
    sourceHash: hash("8"),
    inputHash: hash("9"),
    outputHash: hash("a"),
  });
  second.sourcePins.runtimeManifestCanonicalSha256 = hash("b");
  second.sourcePins.retrievedAt = "2026-08-12T00:04:00.000Z";
  second.sourcePins.analyzedAt = "2026-08-12T00:05:00.000Z";
  second.reviewedAt = "2026-08-12T00:06:00.000Z";
  dataset.updatedAt = "2026-08-12T00:07:00.000Z";
  dataset.slots[1] = {
    ...dataset.slots[1],
    status: "completed",
    caseReview: second,
  };
  dataset.aggregate = buildDeveloperCalibrationAggregate(dataset);

  assertDeveloperCalibrationDataset(dataset);
  assert.notEqual(
    dataset.slots[0].caseReview.sourcePins.runtimeManifestCanonicalSha256,
    dataset.slots[1].caseReview.sourcePins.runtimeManifestCanonicalSha256,
  );
  assert.equal(
    dataset.slots[0].caseReview.sourcePins.runtimeLegalStateSha256,
    dataset.slots[1].caseReview.sourcePins.runtimeLegalStateSha256,
  );
});

test("rejects stale transfer rulesets and analyzer-output hash mismatches", () => {
  const transfer = buildCalibrationTransferPayload(calibrationTransferFixture());
  assert.deepEqual(
    assertCalibrationTransferCompatible(transfer, status.pins),
    transfer,
  );

  assert.throws(
    () =>
      assertCalibrationTransferCompatible(
        { ...transfer, rulesetVersion: "KR-PRIVACY-old-r1" },
        status.pins,
      ),
    /같은 버전으로 다시 분석한 JSON만 넣을 수 있습니다/,
  );
  assert.throws(
    () => assertCalibrationAnalyzerOutputCompatible(hash("8"), hash("9")),
    /분석 결과가 다릅니다/,
  );
  assert.equal(
    calibrationAnalyzerOutputIdentity(transfer).rulesetVersion,
    LEGAL_BASELINE.rulesetVersion,
  );
});

test("rejects completed reviews with missing or zero analyzer finding decisions", () => {
  const mismatch = oneCompletedDataset();
  mismatch.slots[0].caseReview.analyzerFindingCount = 2;
  mismatch.aggregate = buildDeveloperCalibrationAggregate(mismatch);
  assert.throws(
    () => assertDeveloperCalibrationDataset(mismatch),
    /findingReviews length must equal analyzerFindingCount/,
  );

  const empty = oneCompletedDataset();
  empty.slots[0].caseReview.findingReviews = [];
  empty.aggregate = buildDeveloperCalibrationAggregate(empty);
  assert.throws(
    () => assertDeveloperCalibrationDataset(empty),
    /findingReviews length must equal analyzerFindingCount/,
  );
});

test("allows partial draft progress without disguising it as completed", () => {
  const draft = createEmptyDeveloperCalibrationDataset({
    now: "2026-08-12T00:03:00.000Z",
  });
  const caseReview = completedCase();
  caseReview.documentCompleteness = "unknown";
  caseReview.omissionCheckCompleted = false;
  caseReview.findingReviews = [];
  caseReview.manualMissedFindings = [];
  draft.slots[0] = {
    ...draft.slots[0],
    status: "in_review",
    caseReview,
  };
  draft.legalCohort = {
    runtimeLegalStateSha256: hash("7"),
    rulesetVersion: draft.pins.rulesetVersion,
  };
  draft.aggregate = buildDeveloperCalibrationAggregate(draft);
  assertDeveloperCalibrationDataset(draft);

  draft.slots[0].caseReview.analyzerFindingCount = 1;
  draft.slots[0].caseReview.findingReviews = completedCase().findingReviews;
  draft.aggregate = buildDeveloperCalibrationAggregate(draft);
  assert.throws(
    () => assertDeveloperCalibrationDataset(draft),
    /draft findingReviews cannot exceed analyzerFindingCount/,
  );
});

test("requires evidence and legal references for supported assessments", () => {
  const dataset = oneCompletedDataset();
  dataset.slots[0].caseReview.findingReviews[0].evidenceAssessment.anchors = [];
  dataset.slots[0].caseReview.findingReviews[0].legalBasisAssessment.basisRefs = [];
  dataset.aggregate = buildDeveloperCalibrationAggregate(dataset);

  assert.throws(
    () => assertDeveloperCalibrationDataset(dataset),
    (error) =>
      error.message.includes("requires at least one hashed anchor") &&
      error.message.includes("requires at least one legal basis reference"),
  );
});

test("does not treat unknown or unchecked documents as omission evidence", () => {
  const unknown = oneCompletedDataset();
  unknown.slots[0].caseReview.documentCompleteness = "unknown";
  unknown.aggregate = buildDeveloperCalibrationAggregate(unknown);
  assert.throws(
    () => assertDeveloperCalibrationDataset(unknown),
    /must declare full or partial document completeness/,
  );

  const unchecked = oneCompletedDataset();
  unchecked.slots[0].caseReview.omissionCheckCompleted = false;
  unchecked.aggregate = buildDeveloperCalibrationAggregate(unchecked);
  assert.throws(
    () => assertDeveloperCalibrationDataset(unchecked),
    (error) =>
      error.message.includes("requires an omission check") &&
      error.message.includes("manual missed findings require a completed omission check"),
  );

  const partial = oneCompletedDataset();
  partial.slots[0].caseReview.documentCompleteness = "partial";
  partial.slots[0].caseReview.omissionCheckCompleted = false;
  partial.slots[0].caseReview.manualMissedFindings = [];
  partial.aggregate = buildDeveloperCalibrationAggregate(partial);
  assertDeveloperCalibrationDataset(partial);
  assert.equal(
    partial.aggregate.calibrationCounts.omissionEligibleCompletedSlots,
    0,
  );
  assert.equal(partial.aggregate.calibrationRates.omissionCheckedSlotMissRate, null);
});

test("rejects placeholder hashes, stale aggregates, and incomplete final exports", () => {
  const placeholder = structuredClone(status);
  placeholder.pins.analyzerSourceSha256 = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => assertDeveloperCalibrationDataset(placeholder),
    /placeholder hash/,
  );

  const stale = oneCompletedDataset();
  stale.aggregate.calibrationCounts.completedSlots = 0;
  assert.throws(
    () => assertDeveloperCalibrationDataset(stale),
    /aggregate does not match/,
  );

  assert.throws(
    () => serializeDeveloperCalibrationDataset(status, { requireComplete: true }),
    /is not completed/,
  );
});

test("rejects malformed JSON imports without returning partial data", () => {
  assert.throws(
    () => parseDeveloperCalibrationDataset('{"schemaVersion":'),
    /JSON parsing failed/,
  );
  assert.equal(DEVELOPER_CALIBRATION_MAX_JSON_BYTES, 5_000_000);
  assert.throws(
    () =>
      parseDeveloperCalibrationDataset(
        " ".repeat(DEVELOPER_CALIBRATION_MAX_JSON_BYTES + 1),
      ),
    /import exceeds 5000000 UTF-8 bytes/,
  );
  const multibyteOverLimit = "가".repeat(
    Math.floor(DEVELOPER_CALIBRATION_MAX_JSON_BYTES / 3) + 1,
  );
  assert.ok(multibyteOverLimit.length < DEVELOPER_CALIBRATION_MAX_JSON_BYTES);
  assert.throws(
    () => parseDeveloperCalibrationDataset(multibyteOverLimit),
    /import exceeds 5000000 UTF-8 bytes/,
  );
  assert.throws(
    () => parseCalibrationTransferPayload(" ".repeat(2_000_001)),
    /2MB를 초과합니다/,
  );
  const roundTripJson = serializeDeveloperCalibrationDataset(oneCompletedDataset());
  assert.ok(
    new TextEncoder().encode(roundTripJson).byteLength <
      DEVELOPER_CALIBRATION_MAX_JSON_BYTES,
  );
  assert.deepEqual(
    parseDeveloperCalibrationDataset(roundTripJson),
    oneCompletedDataset(),
  );
});

test("precompiled schema validation preserves date, date-time, and unique-item checks", () => {
  const invalidDate = oneCompletedDataset();
  invalidDate.slots[0].caseReview.sourcePins.legalAsOfDate = "2026-02-30";
  assert.throws(
    () => assertDeveloperCalibrationDataset(invalidDate),
    /must match format "date"/,
  );

  const missingTimezone = oneCompletedDataset();
  missingTimezone.slots[0].caseReview.sourcePins.retrievedAt =
    "2026-08-12T00:00:00";
  assert.throws(
    () => assertDeveloperCalibrationDataset(missingTimezone),
    /must match format "date-time"/,
  );

  const duplicateReason = oneCompletedDataset();
  duplicateReason.slots[0].caseReview.findingReviews[1].reasonCodes = [
    "disclosure_present",
    "disclosure_present",
  ];
  assert.throws(
    () => assertDeveloperCalibrationDataset(duplicateReason),
    /must NOT have duplicate items/,
  );
});
