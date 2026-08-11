export const CALIBRATION_TRANSFER_SESSION_KEY =
  "law-lens:developer-calibration-transfer:v1";

export const CALIBRATION_TRANSFER_SCHEMA_VERSION = 1 as const;

export type CalibrationTransferFinding = {
  findingId: string;
  ruleId: string;
  category: string;
  title: string;
  severity: "high" | "medium" | "low" | "pass" | "na";
  findingType: string;
  requiresFactualVerification: boolean;
  summary: string;
  evidence: string;
  recommendation: string;
  anchorStart: number | null;
  anchorEnd: number | null;
  legalBasis: Array<{
    sourceId: string;
    provisionId: string;
    label: string;
  }>;
};

export type CalibrationTransferPayload = {
  schemaVersion: typeof CALIBRATION_TRANSFER_SCHEMA_VERSION;
  transferMode: "developer_self_review";
  createdAt: string;
  policyTitle: string;
  retrievedAt: string;
  documentHash: string;
  rulesetVersion: string;
  legalAsOfDate: string;
  analysisEngineVersion: string;
  runtimeManifestSource: "live" | "bundled";
  runtimeManifestStatus: "valid";
  runtimeManifestGeneratedAt: string;
  runtimeManifestCanonicalSha256: string;
  runtimeLegalStateSha256: string;
  findings: CalibrationTransferFinding[];
};

export type CalibrationTransferTargetPins = {
  analyzerVersion: string;
  rulesetVersion: string;
};

export type CalibrationTransferLegalCohort = {
  runtimeLegalStateSha256: string;
  rulesetVersion: string;
};

export function calibrationAnalyzerOutputIdentity(
  payload: CalibrationTransferPayload,
) {
  return {
    documentHash: payload.documentHash,
    rulesetVersion: payload.rulesetVersion,
    legalAsOfDate: payload.legalAsOfDate,
    analysisEngineVersion: payload.analysisEngineVersion,
    runtimeManifestSource: payload.runtimeManifestSource,
    runtimeManifestStatus: payload.runtimeManifestStatus,
    runtimeManifestGeneratedAt: payload.runtimeManifestGeneratedAt,
    runtimeManifestCanonicalSha256: payload.runtimeManifestCanonicalSha256,
    runtimeLegalStateSha256: payload.runtimeLegalStateSha256,
    findings: payload.findings,
  };
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function toIsoDate(value: unknown) {
  const input = safeString(value, 64);
  if (!input) return "";
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function safeSeverity(
  value: unknown,
): CalibrationTransferFinding["severity"] {
  return ["high", "medium", "low", "pass", "na"].includes(String(value))
    ? (value as CalibrationTransferFinding["severity"])
    : "na";
}

function provisionIdFromBasis(basis: UnknownRecord) {
  const direct = safeString(basis.provisionId, 160);
  if (direct) return direct;
  return safeString(basis.article, 160) || "unspecified";
}

function sanitizeLegalBasis(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .slice(0, 16)
    .map((basis) => {
      const sourceId = safeString(basis.sourceId, 100);
      const provisionId = provisionIdFromBasis(basis);
      const law = safeString(basis.law, 160);
      const article = safeString(basis.article, 160);
      const existingLabel = safeString(basis.label, 240);
      return {
        sourceId,
        provisionId,
        label:
          existingLabel || [law, article].filter(Boolean).join(" · ").slice(0, 240),
      };
    })
    .filter((basis) => basis.sourceId);
}

function sanitizeFinding(
  value: unknown,
  policyExcerpt: string,
): CalibrationTransferFinding | null {
  if (!isRecord(value)) return null;
  const findingId = safeString(value.id ?? value.findingId, 160);
  if (!findingId) return null;
  const evidence = safeString(value.evidence, 800);
  const directStart = Number.isInteger(value.anchorStart)
    ? Number(value.anchorStart)
    : evidence
      ? policyExcerpt.indexOf(evidence)
      : -1;
  const directEnd = Number.isInteger(value.anchorEnd)
    ? Number(value.anchorEnd)
    : directStart >= 0
      ? directStart + evidence.length
      : -1;
  return {
    findingId,
    ruleId: safeString(value.ruleId, 160) || findingId,
    category: safeString(value.category, 160) || "미분류",
    title: safeString(value.title, 240) || findingId,
    severity: safeSeverity(value.severity),
    findingType: safeString(value.findingType, 120) || "unspecified",
    requiresFactualVerification: value.requiresFactualVerification === true,
    summary: safeString(value.summary, 1_200),
    evidence,
    recommendation: safeString(value.recommendation, 1_200),
    anchorStart: directStart >= 0 ? directStart : null,
    anchorEnd: directEnd > directStart ? directEnd : null,
    legalBasis: sanitizeLegalBasis(value.legalBasis),
  };
}

/**
 * Creates a transient, session-only review payload. The policy excerpt, URLs
 * and human-review notes are discarded. A capped evidence quote, summary and
 * recommendation remain only long enough to render the review screen; the
 * IndexedDB calibration record and canonical JSON export exclude them.
 */
export function buildCalibrationTransferPayload(
  value: unknown,
): CalibrationTransferPayload {
  if (!isRecord(value)) {
    throw new Error("분석 JSON 형식을 확인할 수 없습니다.");
  }

  const analysis = isRecord(value.analysis) ? value.analysis : value;
  const legalBaseline = isRecord(analysis.legalBaseline)
    ? analysis.legalBaseline
    : {};
  const runtimeManifest = isRecord(legalBaseline.runtimeManifest)
    ? legalBaseline.runtimeManifest
    : {};
  const analysisEngine = isRecord(analysis.analysisEngine)
    ? analysis.analysisEngine
    : {};
  const documentHash = safeString(analysis.documentHash, 128).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(documentHash)) {
    throw new Error("문서 SHA-256이 없거나 잘못되었습니다.");
  }

  const policyExcerpt = safeString(analysis.policyExcerpt, 20_000);
  const findings = Array.isArray(analysis.findings)
    ? analysis.findings
        .map((finding) => sanitizeFinding(finding, policyExcerpt))
        .filter((item) => item !== null)
    : [];
  if (findings.length === 0) {
    throw new Error("검토할 분석 결과가 없습니다.");
  }

  const rulesetVersion =
    safeString(legalBaseline.rulesetVersion, 160) ||
    safeString(analysisEngine.version, 160);
  const legalAsOfDate =
    safeString(legalBaseline.asOfDate, 32) ||
    safeString(legalBaseline.verifiedAt, 32) ||
    safeString(legalBaseline.date, 32);

  const runtimeManifestStatus = safeString(runtimeManifest.status, 40);
  const runtimeManifestSource = safeString(runtimeManifest.source, 40);
  const runtimeManifestGeneratedAt = toIsoDate(runtimeManifest.generatedAt);
  const runtimeManifestCanonicalSha256 = safeString(
    runtimeManifest.canonicalSha256,
    80,
  ).toLowerCase();
  const runtimeLegalStateSha256 = safeString(
    runtimeManifest.legalStateSha256,
    80,
  ).toLowerCase();

  if (!rulesetVersion || !legalAsOfDate) {
    throw new Error("법령 기준일 또는 규칙셋 버전을 확인할 수 없습니다.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(legalAsOfDate)) {
    throw new Error("법령 기준일 형식을 확인할 수 없습니다.");
  }
  if (
    runtimeManifestStatus !== "valid" ||
    !["live", "bundled"].includes(runtimeManifestSource) ||
    !runtimeManifestGeneratedAt ||
    !/^[a-f0-9]{64}$/.test(runtimeManifestCanonicalSha256) ||
    !/^[a-f0-9]{64}$/.test(runtimeLegalStateSha256)
  ) {
    throw new Error(
      "최신 법령 상태가 유효하게 고정된 분석 결과만 사전 교정에 넣을 수 있습니다. 다시 분석한 뒤 시도해 주세요.",
    );
  }
  if (legalBaseline.overdueLegalReview === true) {
    throw new Error(
      "시행 법령의 규칙 검토가 끝나지 않아 판단이 유보된 분석은 주 사전 교정 표본에 넣을 수 없습니다.",
    );
  }

  return {
    schemaVersion: CALIBRATION_TRANSFER_SCHEMA_VERSION,
    transferMode: "developer_self_review",
    createdAt: new Date().toISOString(),
    policyTitle:
      safeString(analysis.policyTitle, 240) || "이름 없는 개인정보처리방침",
    retrievedAt: toIsoDate(analysis.retrievedAt) || new Date().toISOString(),
    documentHash,
    rulesetVersion,
    legalAsOfDate,
    analysisEngineVersion:
      safeString(analysisEngine.version, 160) || rulesetVersion,
    runtimeManifestSource: runtimeManifestSource as "live" | "bundled",
    runtimeManifestStatus: "valid",
    runtimeManifestGeneratedAt,
    runtimeManifestCanonicalSha256,
    runtimeLegalStateSha256,
    findings,
  };
}

export function parseCalibrationTransferPayload(
  json: string,
): CalibrationTransferPayload {
  if (json.length > 2_000_000) {
    throw new Error("파일이 2MB를 초과합니다.");
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("잘못된 JSON 파일입니다.");
  }
  if (
    isRecord(value) &&
    value.schemaVersion === CALIBRATION_TRANSFER_SCHEMA_VERSION &&
    value.transferMode === "developer_self_review"
  ) {
    const payload = buildCalibrationTransferPayload({
      ...value,
      legalBaseline: {
        rulesetVersion: value.rulesetVersion,
        asOfDate: value.legalAsOfDate,
        runtimeManifest: {
          source: value.runtimeManifestSource,
          status: value.runtimeManifestStatus,
          generatedAt: value.runtimeManifestGeneratedAt,
          canonicalSha256: value.runtimeManifestCanonicalSha256,
          legalStateSha256: value.runtimeLegalStateSha256,
        },
      },
      analysisEngine: { version: value.analysisEngineVersion },
      findings: Array.isArray(value.findings)
        ? value.findings.map((finding) =>
            isRecord(finding)
              ? {
                  ...finding,
                  id: finding.findingId,
                  legalBasis: finding.legalBasis,
                }
              : finding,
          )
        : [],
    });
    return {
      ...payload,
      createdAt: toIsoDate(value.createdAt) || payload.createdAt,
    };
  }
  return buildCalibrationTransferPayload(value);
}

export function assertCalibrationTransferCompatible(
  payload: CalibrationTransferPayload,
  pins: CalibrationTransferTargetPins,
) {
  if (
    payload.rulesetVersion !== pins.rulesetVersion ||
    payload.analysisEngineVersion !== pins.analyzerVersion
  ) {
    throw new Error(
      `이 분석은 ${payload.rulesetVersion} 규칙셋으로 만들어졌지만 현재 작업공간은 ${pins.rulesetVersion} 기준입니다. 같은 버전으로 다시 분석한 JSON만 넣을 수 있습니다.`,
    );
  }
  return payload;
}

export function assertCalibrationTransferLegalCohortCompatible(
  payload: CalibrationTransferPayload,
  cohort: CalibrationTransferLegalCohort | null,
) {
  if (!cohort) return payload;
  if (
    cohort.rulesetVersion !== payload.rulesetVersion ||
    cohort.runtimeLegalStateSha256 !==
      `sha256:${payload.runtimeLegalStateSha256}`
  ) {
    throw new Error(
      "현재 24개 작업공간의 법령 상태와 다른 분석입니다. 법령 기준을 섞으면 비교가 왜곡되므로 새 교정 데이터셋에서 검토해 주세요.",
    );
  }
  return payload;
}

export function assertCalibrationAnalyzerOutputCompatible(
  expectedSha256: string,
  actualSha256: string,
) {
  if (expectedSha256 !== actualSha256) {
    throw new Error(
      "같은 문서 해시지만 분석 결과가 다릅니다. 기존 판정과 섞지 않도록 현재 표본을 비운 뒤 다시 넣어 주세요.",
    );
  }
  return actualSha256;
}

export function storeCalibrationTransferDraft(value: unknown) {
  if (typeof window === "undefined") return false;
  const payload = buildCalibrationTransferPayload(value);
  window.sessionStorage.setItem(
    CALIBRATION_TRANSFER_SESSION_KEY,
    JSON.stringify(payload),
  );
  return true;
}

export function consumeCalibrationTransferDraft() {
  if (typeof window === "undefined") return null;
  const json = window.sessionStorage.getItem(CALIBRATION_TRANSFER_SESSION_KEY);
  if (!json) return null;
  window.sessionStorage.removeItem(CALIBRATION_TRANSFER_SESSION_KEY);
  return parseCalibrationTransferPayload(json);
}
