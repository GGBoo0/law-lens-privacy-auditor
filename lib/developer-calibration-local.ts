import type {
  CalibrationTransferFinding,
  CalibrationTransferPayload,
} from "./developer-calibration-transfer";

const DATABASE_NAME = "law-lens-developer-calibration";
const DATABASE_VERSION = 1;
const STORE_NAME = "workspace";
const WORKSPACE_KEY = "current";

export const CALIBRATION_BACKUP_SCHEMA_VERSION = 1 as const;

export type CalibrationPresentationFinding = Pick<
  CalibrationTransferFinding,
  | "findingId"
  | "ruleId"
  | "category"
  | "title"
  | "severity"
  | "findingType"
  | "requiresFactualVerification"
  | "legalBasis"
>;

export type CalibrationCasePresentation = {
  slotId: string;
  organizationAlias: string;
  policyTitle: string;
  importedAt: string;
  findings: CalibrationPresentationFinding[];
};

export type CalibrationLocalWorkspace = {
  schemaVersion: typeof CALIBRATION_BACKUP_SCHEMA_VERSION;
  savedAt: string;
  dataset: unknown;
  presentations: Record<string, CalibrationCasePresentation>;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function sanitizeFinding(value: unknown): CalibrationPresentationFinding | null {
  if (!isRecord(value)) return null;
  const findingId = safeString(value.findingId, 160);
  if (!findingId) return null;
  const severity = ["high", "medium", "low", "pass", "na"].includes(
    String(value.severity),
  )
    ? (value.severity as CalibrationPresentationFinding["severity"])
    : "na";
  return {
    findingId,
    ruleId: safeString(value.ruleId, 160) || findingId,
    category: safeString(value.category, 160) || "미분류",
    title: safeString(value.title, 240) || findingId,
    severity,
    findingType: safeString(value.findingType, 120) || "unspecified",
    requiresFactualVerification: value.requiresFactualVerification === true,
    legalBasis: Array.isArray(value.legalBasis)
      ? value.legalBasis
          .filter(isRecord)
          .slice(0, 16)
          .map((basis) => ({
            sourceId: safeString(basis.sourceId, 100),
            provisionId: safeString(basis.provisionId, 160) || "unspecified",
            label: safeString(basis.label, 240),
          }))
          .filter((basis) => basis.sourceId)
      : [],
  };
}

export function presentationFromTransfer(
  slotId: string,
  payload: CalibrationTransferPayload,
  organizationAlias: string,
): CalibrationCasePresentation {
  return {
    slotId: safeString(slotId, 24),
    organizationAlias: safeString(organizationAlias, 120),
    policyTitle: safeString(payload.policyTitle, 240),
    importedAt: new Date().toISOString(),
    findings: payload.findings.map(sanitizeFinding).filter((item) => item !== null),
  };
}

function sanitizePresentations(value: unknown) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 24)
      .map(([key, raw]) => {
        if (!isRecord(raw)) return null;
        const slotId = safeString(raw.slotId, 24) || safeString(key, 24);
        if (!/^slot-\d{2}$/.test(slotId)) return null;
        const findings = Array.isArray(raw.findings)
          ? raw.findings.map(sanitizeFinding).filter((item) => item !== null)
          : [];
        return [
          slotId,
          {
            slotId,
            organizationAlias: safeString(raw.organizationAlias, 120),
            policyTitle:
              safeString(raw.policyTitle, 240) || "이름 없는 개인정보처리방침",
            importedAt:
              safeString(raw.importedAt, 64) || new Date().toISOString(),
            findings,
          },
        ] as const;
      })
      .filter((entry) => entry !== null),
  );
}

export function sanitizeCalibrationWorkspace(
  value: unknown,
): CalibrationLocalWorkspace {
  if (!isRecord(value) || !("dataset" in value)) {
    throw new Error("사전 교정 백업 형식을 확인할 수 없습니다.");
  }
  return {
    schemaVersion: CALIBRATION_BACKUP_SCHEMA_VERSION,
    savedAt: safeString(value.savedAt, 64) || new Date().toISOString(),
    dataset: value.dataset,
    presentations: sanitizePresentations(value.presentations),
  };
}

function openDatabase() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(
      new Error("이 브라우저에서 기기 저장소를 사용할 수 없습니다."),
    );
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("기기 저장소를 열지 못했습니다."));
  });
}

export async function loadCalibrationWorkspace() {
  const database = await openDatabase();
  try {
    return await new Promise<CalibrationLocalWorkspace | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(WORKSPACE_KEY);
      request.onsuccess = () => {
        if (request.result === undefined) {
          resolve(null);
          return;
        }
        try {
          resolve(sanitizeCalibrationWorkspace(request.result));
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () =>
        reject(request.error ?? new Error("기기 저장 기록을 읽지 못했습니다."));
    });
  } finally {
    database.close();
  }
}

export async function saveCalibrationWorkspace(
  workspace: CalibrationLocalWorkspace,
) {
  const sanitized = sanitizeCalibrationWorkspace({
    ...workspace,
    savedAt: new Date().toISOString(),
  });
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(sanitized, WORKSPACE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("기기 저장에 실패했습니다."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("기기 저장이 취소됐습니다."));
    });
    return sanitized;
  } finally {
    database.close();
  }
}

export async function resetCalibrationWorkspace() {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(WORKSPACE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("기기 저장 기록을 삭제하지 못했습니다."));
    });
  } finally {
    database.close();
  }
}
