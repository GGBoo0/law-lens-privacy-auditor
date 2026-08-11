"use client";

import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import seedDataset from "../../data/developer-calibration/status.json";
import {
  assertDeveloperCalibrationDataset,
  createEmptyDeveloperCalibrationDataset,
  DEVELOPER_CALIBRATION_MAX_JSON_BYTES,
  type DeveloperCalibrationReasonCode,
  type DeveloperCalibrationSha256,
  parseDeveloperCalibrationDataset,
  refreshDeveloperCalibrationAggregate,
  serializeDeveloperCalibrationDataset,
} from "../../lib/developer-calibration.mjs";
import {
  type CalibrationCasePresentation,
  type CalibrationLocalWorkspace,
  loadCalibrationWorkspace,
  presentationFromTransfer,
  resetCalibrationWorkspace,
  saveCalibrationWorkspace,
} from "../../lib/developer-calibration-local";
import {
  type CalibrationTransferFinding,
  type CalibrationTransferPayload,
  assertCalibrationAnalyzerOutputCompatible,
  assertCalibrationTransferCompatible,
  assertCalibrationTransferLegalCohortCompatible,
  calibrationAnalyzerOutputIdentity,
  consumeCalibrationTransferDraft,
  parseCalibrationTransferPayload,
} from "../../lib/developer-calibration-transfer";
import styles from "./calibration.module.css";

type Decision = "" | "confirmed" | "false_positive" | "uncertain";
type AssessmentOutcome = "supported" | "unsupported" | "uncertain";
type SeverityFit =
  | "appropriate"
  | "overstated"
  | "understated"
  | "uncertain";

type FindingDraft = {
  decision: Decision;
  reasonCode: "" | DeveloperCalibrationReasonCode;
  evidenceOutcome: AssessmentOutcome;
  legalBasisOutcome: AssessmentOutcome;
  severityFit: SeverityFit;
};

type MissedDraft = {
  ruleId: string;
  severity: "high" | "medium" | "low";
  reasonCode:
    | "missing_rule_output"
    | "wrong_pass_classification"
    | "severity_understated"
    | "finding_type_mismatch";
  evidenceOutcome: AssessmentOutcome;
  evidencePhrase: string;
  evidenceStart: string;
  legalBasisOutcome: AssessmentOutcome;
  sourceId: string;
  provisionId: string;
};

const sectorLabels: Record<string, string> = {
  commerce: "전자상거래",
  finance: "금융",
  online_platform: "온라인 플랫폼·콘텐츠",
  telecom: "통신·이동·숙박",
  healthcare: "의료·건강",
  education: "교육·아동",
};

const statusLabels: Record<string, string> = {
  unassigned: "비어 있음",
  in_review: "검토 중",
  completed: "완료",
};

const severityLabels: Record<string, string> = {
  high: "높음",
  medium: "중간",
  low: "낮음",
  pass: "문구 확인",
  na: "판단 유보",
};

const decisionLabels: Record<Exclude<Decision, "">, string> = {
  confirmed: "맞음",
  false_positive: "오탐",
  uncertain: "판단 유보",
};

const reasonOptions = [
  ["disclosure_present", "필요한 내용이 이미 있음"],
  ["rule_not_applicable", "이 문서에는 적용되지 않음"],
  ["evidence_mismatch", "발견 문구가 판단과 맞지 않음"],
  ["legal_basis_mismatch", "적용 근거가 맞지 않음"],
  ["severity_overstated", "위험도를 너무 높게 표시함"],
  ["insufficient_context", "문맥이 부족해 확정하기 어려움"],
  ["source_incomplete", "원문이 일부라 판단하기 어려움"],
  ["requires_domain_expertise", "전문가 확인이 필요함"],
  ["legal_change_pending", "법령 변경 검토가 진행 중임"],
] as const;

const assessmentOptions: Array<[AssessmentOutcome, string]> = [
  ["supported", "뒷받침함"],
  ["unsupported", "뒷받침하지 못함"],
  ["uncertain", "판단 유보"],
];

const severityFitOptions: Array<[SeverityFit, string]> = [
  ["appropriate", "표시 강도가 적절함"],
  ["overstated", "표시 강도가 과함"],
  ["understated", "표시 강도가 약함"],
  ["uncertain", "강도 판단 유보"],
];

const emptyMissedDraft: MissedDraft = {
  ruleId: "",
  severity: "medium",
  reasonCode: "missing_rule_output",
  evidenceOutcome: "uncertain",
  evidencePhrase: "",
  evidenceStart: "",
  legalBasisOutcome: "uncertain",
  sourceId: "",
  provisionId: "",
};

function defaultFindingDraft(): FindingDraft {
  return {
    decision: "",
    reasonCode: "",
    evidenceOutcome: "uncertain",
    legalBasisOutcome: "uncertain",
    severityFit: "uncertain",
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<DeveloperCalibrationSha256> {
  const bytes = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}` as DeveloperCalibrationSha256;
}

function downloadJson(json: string, name: string) {
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(href);
}

function caseTitle(
  presentation: CalibrationCasePresentation | undefined,
  slotId: string,
) {
  return (
    presentation?.organizationAlias ||
    presentation?.policyTitle ||
    `${slotId} 익명 표본`
  );
}

function findingDraftFromReview(review: Record<string, unknown> | undefined) {
  if (!review) return defaultFindingDraft();
  const reasonCodes = Array.isArray(review.reasonCodes)
    ? review.reasonCodes
    : [];
  const evidence = review.evidenceAssessment as
    | { outcome?: AssessmentOutcome }
    | undefined;
  const legalBasis = review.legalBasisAssessment as
    | { outcome?: AssessmentOutcome }
    | undefined;
  return {
    decision: (review.decision as Decision) || "",
    reasonCode: (reasonCodes[0] ?? "") as FindingDraft["reasonCode"],
    evidenceOutcome: evidence?.outcome ?? "uncertain",
    legalBasisOutcome: legalBasis?.outcome ?? "uncertain",
    severityFit: (review.severityFit as SeverityFit) ?? "uncertain",
  } satisfies FindingDraft;
}

function dateForFile() {
  return new Date().toISOString().slice(0, 10);
}

export default function CalibrationWorkspace() {
  const [dataset, setDataset] = useState<ReturnType<
    typeof createEmptyDeveloperCalibrationDataset
  >>(() =>
    assertDeveloperCalibrationDataset(structuredClone(seedDataset)),
  );
  const [presentations, setPresentations] = useState<
    Record<string, CalibrationCasePresentation>
  >({});
  const [transfers, setTransfers] = useState<
    Record<string, CalibrationTransferPayload>
  >({});
  const [pendingTransfer, setPendingTransfer] =
    useState<CalibrationTransferPayload | null>(null);
  const [pendingOrganizationAlias, setPendingOrganizationAlias] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("slot-01");
  const [drafts, setDrafts] = useState<Record<string, FindingDraft>>({});
  const [missedDraft, setMissedDraft] =
    useState<MissedDraft>(emptyMissedDraft);
  const [findingErrors, setFindingErrors] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState("");
  const [fatalError, setFatalError] = useState("");
  const [busy, setBusy] = useState(false);
  const analysisFileRef = useRef<HTMLInputElement>(null);
  const datasetFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;

    async function initialize() {
      let nextDataset: ReturnType<
        typeof createEmptyDeveloperCalibrationDataset
      >;
      let nextPresentations: Record<string, CalibrationCasePresentation> = {};
      try {
        const saved = await loadCalibrationWorkspace();
        if (saved) {
          nextDataset = assertDeveloperCalibrationDataset(saved.dataset);
          nextPresentations = saved.presentations;
        } else {
          nextDataset = assertDeveloperCalibrationDataset(
            structuredClone(seedDataset),
          );
        }
      } catch (error) {
        nextDataset = assertDeveloperCalibrationDataset(
          structuredClone(seedDataset),
        );
        if (active) {
          setFatalError(
            error instanceof Error
              ? `기기 저장 기록을 불러오지 못해 새 작업공간을 열었습니다. ${error.message}`
              : "기기 저장 기록을 불러오지 못해 새 작업공간을 열었습니다.",
          );
        }
      }

      if (!active) return;
      setDataset(nextDataset);
      setPresentations(nextPresentations);
      const firstOpen = nextDataset.slots.find(
        (slot) => slot.status !== "completed",
      );
      if (firstOpen) setSelectedSlotId(firstOpen.slotId);

      try {
        const transfer = consumeCalibrationTransferDraft();
        if (transfer) {
          setPendingTransfer(transfer);
          setPendingOrganizationAlias(transfer.policyTitle);
          setAnnouncement(
            "분석 화면에서 보낸 결과를 안전하게 가져왔습니다. 넣을 표본 칸을 확인해 주세요.",
          );
        }
      } catch (error) {
        setAnnouncement(
          error instanceof Error
            ? error.message
            : "분석 화면에서 보낸 결과를 읽지 못했습니다.",
        );
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, []);

  const selectedSlot = dataset?.slots.find(
    (slot) => slot.slotId === selectedSlotId,
  );
  const selectedPresentation = presentations[selectedSlotId];
  const selectedTransfer = transfers[selectedSlotId];
  const selectedFindings =
    selectedTransfer?.findings ?? selectedPresentation?.findings ?? [];

  const aggregate = dataset?.aggregate;
  const completedSlots = aggregate?.calibrationCounts.completedSlots ?? 0;
  const inReviewSlots = aggregate?.calibrationCounts.inReviewSlots ?? 0;
  const confirmationCount = aggregate?.calibrationCounts.confirmed ?? 0;
  const falsePositiveCount = aggregate?.calibrationCounts.falsePositive ?? 0;
  const missedCount = aggregate?.calibrationCounts.manualMissedFindings ?? 0;
  const completionPercent = Math.round((completedSlots / 24) * 100);
  const calibrationStage =
    completedSlots >= 24
      ? "권장 목표 완료"
      : completedSlots >= 20
        ? "1차 교정 가능"
        : "사례 수집 중";

  const reviewedFindingCount = selectedSlot?.caseReview?.findingReviews.length ?? 0;
  const totalFindingCount =
    selectedSlot?.caseReview?.analyzerFindingCount ?? selectedFindings.length;

  const groupedSlots = useMemo(() => {
    if (!dataset) return [];
    return dataset.sectorPlan.map((plan) => ({
      sector: plan.sector,
      slots: dataset.slots.filter((slot) => slot.sector === plan.sector),
    }));
  }, [dataset]);

  async function persist(
    nextDataset: ReturnType<typeof createEmptyDeveloperCalibrationDataset>,
    nextPresentations = presentations,
    message = "기기에 저장했습니다.",
  ) {
    const refreshed = refreshDeveloperCalibrationAggregate(nextDataset);
    assertDeveloperCalibrationDataset(refreshed);
    setDataset(refreshed);
    setPresentations(nextPresentations);
    try {
      const workspace: CalibrationLocalWorkspace = {
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        dataset: refreshed,
        presentations: nextPresentations,
      };
      await saveCalibrationWorkspace(workspace);
      setAnnouncement(message);
      setFatalError("");
    } catch (error) {
      setFatalError(
        error instanceof Error
          ? `화면에는 반영됐지만 기기에 저장하지 못했습니다. ${error.message}`
          : "화면에는 반영됐지만 기기에 저장하지 못했습니다.",
      );
    }
    return refreshed;
  }

  function mutableDataset() {
    if (!dataset) throw new Error("작업공간을 아직 준비하는 중입니다.");
    const next = structuredClone(dataset);
    next.datasetRevision += 1;
    next.updatedAt = new Date().toISOString();
    return next;
  }

  function touchReview(
    review: { reviewedAt: string },
    nextDataset: ReturnType<typeof createEmptyDeveloperCalibrationDataset>,
  ) {
    const now = new Date().toISOString();
    review.reviewedAt = now;
    nextDataset.updatedAt = now;
  }

  async function handleAnalysisFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) {
      setAnnouncement("2MB 이하의 JSON 파일만 가져올 수 있습니다.");
      return;
    }
    setBusy(true);
    try {
      const transfer = parseCalibrationTransferPayload(await file.text());
      setPendingTransfer(transfer);
      setPendingOrganizationAlias(transfer.policyTitle);
      setAnnouncement(
        `분석 결과 ${transfer.findings.length}건을 읽었습니다. 넣을 표본 칸을 확인해 주세요.`,
      );
    } catch (error) {
      setAnnouncement(
        error instanceof Error
          ? error.message
          : "분석 JSON을 읽지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function assignPendingTransfer() {
    if (!dataset || !selectedSlot || !pendingTransfer) return;
    const organizationAlias = pendingOrganizationAlias.trim();
    if (!organizationAlias) {
      setAnnouncement("업종 편중과 중복을 확인할 수 있게 이 기기에서만 쓸 조직 별칭을 입력해 주세요.");
      return;
    }
    const duplicateAlias = Object.entries(presentations).find(
      ([slotId, presentation]) =>
        slotId !== selectedSlot.slotId &&
        presentation.organizationAlias.localeCompare(organizationAlias, "ko", {
          sensitivity: "base",
        }) === 0,
    );
    if (
      duplicateAlias &&
      !window.confirm(
        `동일한 조직 별칭이 ${duplicateAlias[0]}에 있습니다. 표본 편중 가능성을 감수하고 계속할까요?`,
      )
    ) {
      return;
    }
    try {
      assertCalibrationTransferCompatible(pendingTransfer, dataset.pins);
      assertCalibrationTransferLegalCohortCompatible(
        pendingTransfer,
        dataset.legalCohort,
      );
    } catch (error) {
      setAnnouncement(
        error instanceof Error
          ? error.message
          : "분석 규칙셋이 현재 작업공간과 다릅니다.",
      );
      return;
    }
    const duplicate = dataset.slots.find(
      (slot) =>
        slot.slotId !== selectedSlot.slotId &&
        slot.caseReview?.sourcePins.sourceDocumentSha256 ===
          `sha256:${pendingTransfer.documentHash}`,
    );
    if (duplicate) {
      setSelectedSlotId(duplicate.slotId);
      setAnnouncement(
        `같은 문서가 이미 ${duplicate.slotId}에 있습니다. 중복 표본은 저장하지 않았습니다.`,
      );
      return;
    }

    setBusy(true);
    let outputHash: DeveloperCalibrationSha256;
    try {
      outputHash = await sha256(
        stableStringify(calibrationAnalyzerOutputIdentity(pendingTransfer)),
      );
    } catch {
      setAnnouncement("분석 결과 무결성 해시를 계산하지 못했습니다.");
      setBusy(false);
      return;
    }
    if (
      selectedSlot.caseReview?.sourcePins.sourceDocumentSha256 ===
      `sha256:${pendingTransfer.documentHash}`
    ) {
      try {
        assertCalibrationAnalyzerOutputCompatible(
          selectedSlot.caseReview.sourcePins.analyzerOutputSha256,
          outputHash,
        );
        const nextPresentations = {
          ...presentations,
          [selectedSlot.slotId]: presentationFromTransfer(
            selectedSlot.slotId,
            pendingTransfer,
            organizationAlias ||
              presentations[selectedSlot.slotId]?.organizationAlias ||
              pendingTransfer.policyTitle,
          ),
        };
        setPresentations(nextPresentations);
        setTransfers((current) => ({
          ...current,
          [selectedSlot.slotId]: pendingTransfer,
        }));
        setPendingTransfer(null);
        setPendingOrganizationAlias("");
        await saveCalibrationWorkspace({
          schemaVersion: 1,
          savedAt: new Date().toISOString(),
          dataset,
          presentations: nextPresentations,
        });
        setAnnouncement(
          "같은 분석 결과의 발견 문구를 다시 불러왔습니다. 기존 판정은 유지했습니다.",
        );
      } catch (error) {
        setAnnouncement(
          error instanceof Error
            ? error.message
            : "분석 결과 해시가 기존 판정과 다릅니다.",
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    if (
      selectedSlot.caseReview &&
      !window.confirm(
        `${selectedSlot.slotId}의 기존 검토를 이 분석 결과로 바꿀까요? 기존 판정은 사라집니다.`,
      )
    ) {
      setBusy(false);
      return;
    }

    try {
      const analyzedAtMs = Math.max(
        Date.parse(pendingTransfer.retrievedAt),
        Date.parse(pendingTransfer.createdAt),
      );
      const reviewedAt = new Date(
        Math.max(Date.now(), Number.isNaN(analyzedAtMs) ? 0 : analyzedAtMs),
      ).toISOString();
      const next = mutableDataset();
      next.updatedAt = reviewedAt;
      const slot = next.slots.find(
        (entry) => entry.slotId === selectedSlot.slotId,
      );
      if (!slot) throw new Error("선택한 표본 칸을 찾지 못했습니다.");
      if (!next.legalCohort) {
        next.legalCohort = {
          runtimeLegalStateSha256:
            `sha256:${pendingTransfer.runtimeLegalStateSha256}`,
          rulesetVersion: pendingTransfer.rulesetVersion,
        };
      }
      slot.status = "in_review";
      slot.caseReview = {
        caseId: `case-${pendingTransfer.documentHash.slice(0, 20)}`,
        reviewMode: "developer_self_review",
        validationLevel: "not_expert_validated",
        documentCompleteness: "unknown",
        omissionCheckCompleted: false,
        analyzerFindingCount: pendingTransfer.findings.length,
        sourcePins: {
          sourceDocumentSha256: `sha256:${pendingTransfer.documentHash}`,
          analysisInputSha256: `sha256:${pendingTransfer.documentHash}`,
          analyzerOutputSha256: outputHash,
          analyzerVersion: pendingTransfer.analysisEngineVersion,
          rulesetVersion: pendingTransfer.rulesetVersion,
          legalAsOfDate: pendingTransfer.legalAsOfDate,
          runtimeManifestCanonicalSha256:
            `sha256:${pendingTransfer.runtimeManifestCanonicalSha256}`,
          runtimeLegalStateSha256:
            `sha256:${pendingTransfer.runtimeLegalStateSha256}`,
          runtimeManifestSource: pendingTransfer.runtimeManifestSource,
          runtimeManifestStatus: pendingTransfer.runtimeManifestStatus,
          runtimeManifestGeneratedAt:
            pendingTransfer.runtimeManifestGeneratedAt,
          retrievedAt: pendingTransfer.retrievedAt,
          analyzedAt: new Date(analyzedAtMs).toISOString(),
        },
        reviewedAt,
        findingReviews: [],
        manualMissedFindings: [],
      };
      const nextPresentations = {
        ...presentations,
        [selectedSlot.slotId]: presentationFromTransfer(
          selectedSlot.slotId,
          pendingTransfer,
          organizationAlias,
        ),
      };
      await persist(
        next,
        nextPresentations,
        `${selectedSlot.slotId}에 분석 결과를 넣었습니다. 각 지적을 검토해 주세요.`,
      );
      setTransfers((current) => ({
        ...current,
        [selectedSlot.slotId]: pendingTransfer,
      }));
      setPendingTransfer(null);
      setPendingOrganizationAlias("");
      setDrafts({});
      setFindingErrors({});
    } catch (error) {
      setAnnouncement(
        error instanceof Error
          ? error.message
          : "분석 결과를 표본 칸에 넣지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(findingId: string, update: Partial<FindingDraft>) {
    const persisted = selectedSlot?.caseReview?.findingReviews.find(
      (review) => review.findingId === findingId,
    );
    setDrafts((current) => ({
      ...current,
      [findingId]: {
        ...(current[findingId] ?? findingDraftFromReview(persisted)),
        ...update,
      },
    }));
    setFindingErrors((current) => ({ ...current, [findingId]: "" }));
  }

  async function evidenceAnchors(finding: CalibrationTransferFinding) {
    if (
      !finding.evidence ||
      finding.anchorStart === null ||
      finding.anchorEnd === null
    ) {
      return [];
    }
    return [
      {
        start: finding.anchorStart,
        end: finding.anchorEnd,
        anchorSha256: await sha256(finding.evidence),
      },
    ];
  }

  async function saveFindingReview(finding: CalibrationTransferFinding) {
    if (!dataset || !selectedSlot?.caseReview) return;
    const existing = selectedSlot.caseReview.findingReviews.find(
      (review) => review.findingId === finding.findingId,
    );
    const draft = drafts[finding.findingId] ?? findingDraftFromReview(existing);
    if (!draft.decision) {
      setFindingErrors((current) => ({
        ...current,
        [finding.findingId]: "맞음, 오탐, 판단 유보 중 하나를 선택해 주세요.",
      }));
      return;
    }
    if (draft.decision !== "confirmed" && !draft.reasonCode) {
      setFindingErrors((current) => ({
        ...current,
        [finding.findingId]: "오탐 또는 판단 유보의 이유를 선택해 주세요.",
      }));
      return;
    }
    const anchors = await evidenceAnchors(finding);
    if (draft.evidenceOutcome === "supported" && anchors.length === 0) {
      setFindingErrors((current) => ({
        ...current,
        [finding.findingId]:
          "근거 문구의 위치를 확인할 수 없어 ‘뒷받침함’으로 저장할 수 없습니다.",
      }));
      return;
    }
    const basisRefs = finding.legalBasis.map((basis) => ({
      sourceId: basis.sourceId,
      provisionId: basis.provisionId,
    }));
    if (draft.legalBasisOutcome === "supported" && basisRefs.length === 0) {
      setFindingErrors((current) => ({
        ...current,
        [finding.findingId]:
          "연결된 법적 근거가 없어 ‘뒷받침함’으로 저장할 수 없습니다.",
      }));
      return;
    }

    try {
      const next = mutableDataset();
      const slot = next.slots.find(
        (entry) => entry.slotId === selectedSlot.slotId,
      );
      if (!slot?.caseReview) throw new Error("검토 중인 표본을 찾지 못했습니다.");
      const reasonCodes: DeveloperCalibrationReasonCode[] =
        draft.decision === "confirmed"
          ? []
          : [draft.reasonCode as DeveloperCalibrationReasonCode];
      const review = {
        findingId: finding.findingId,
        ruleId: finding.ruleId,
        decision: draft.decision,
        severityFit: draft.severityFit,
        reasonCodes,
        evidenceAssessment: {
          outcome: draft.evidenceOutcome,
          anchors,
        },
        legalBasisAssessment: {
          outcome: draft.legalBasisOutcome,
          basisRefs,
        },
      };
      const index = slot.caseReview.findingReviews.findIndex(
        (entry) => entry.findingId === finding.findingId,
      );
      if (index >= 0) slot.caseReview.findingReviews[index] = review;
      else slot.caseReview.findingReviews.push(review);
      slot.status = "in_review";
      touchReview(slot.caseReview, next);
      await persist(next, presentations, `‘${finding.title}’ 판정을 저장했습니다.`);
    } catch (error) {
      setFindingErrors((current) => ({
        ...current,
        [finding.findingId]:
          error instanceof Error ? error.message : "판정을 저장하지 못했습니다.",
      }));
    }
  }

  async function updateDocumentReview(
    update: Partial<{
      documentCompleteness: "full" | "partial" | "unknown";
      omissionCheckCompleted: boolean;
    }>,
  ) {
    if (!selectedSlot?.caseReview) return;
    try {
      const next = mutableDataset();
      const slot = next.slots.find(
        (entry) => entry.slotId === selectedSlot.slotId,
      );
      if (!slot?.caseReview) return;
      Object.assign(slot.caseReview, update);
      if (slot.caseReview.documentCompleteness === "unknown") {
        slot.caseReview.omissionCheckCompleted = false;
      }
      slot.status = "in_review";
      touchReview(slot.caseReview, next);
      await persist(next, presentations, "문서 범위 확인 상태를 저장했습니다.");
    } catch (error) {
      setAnnouncement(
        error instanceof Error ? error.message : "문서 상태를 저장하지 못했습니다.",
      );
    }
  }

  async function addMissedFinding() {
    if (!selectedSlot?.caseReview) return;
    const normalizedRuleId = missedDraft.ruleId.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(normalizedRuleId)) {
      setAnnouncement(
        "놓친 규칙 ID는 영문 소문자나 숫자로 시작하고 영문·숫자·점·밑줄·하이픈만 사용해 주세요.",
      );
      return;
    }
    if (
      selectedSlot.caseReview.documentCompleteness === "full" &&
      !selectedSlot.caseReview.omissionCheckCompleted
    ) {
      setAnnouncement(
        "먼저 원문 전체의 놓친 항목 확인을 완료했다고 표시해 주세요.",
      );
      return;
    }
    const start = Number.parseInt(missedDraft.evidenceStart, 10);
    const hasAnchor =
      missedDraft.evidencePhrase.trim().length > 0 && Number.isInteger(start) && start >= 0;
    if (missedDraft.evidenceOutcome === "supported" && !hasAnchor) {
      setAnnouncement(
        "근거가 뒷받침한다고 표시하려면 발견 문구와 원문 시작 위치를 입력해 주세요.",
      );
      return;
    }
    const hasBasis =
      missedDraft.sourceId.trim().length > 0 &&
      missedDraft.provisionId.trim().length > 0;
    if (missedDraft.legalBasisOutcome === "supported" && !hasBasis) {
      setAnnouncement(
        "법적 근거가 뒷받침한다고 표시하려면 출처 ID와 조항을 입력해 주세요.",
      );
      return;
    }
    try {
      const phrase = missedDraft.evidencePhrase.trim();
      const anchors = hasAnchor
        ? [
            {
              start,
              end: start + phrase.length,
              anchorSha256: await sha256(phrase),
            },
          ]
        : [];
      const next = mutableDataset();
      const slot = next.slots.find(
        (entry) => entry.slotId === selectedSlot.slotId,
      );
      if (!slot?.caseReview) return;
      slot.caseReview.manualMissedFindings.push({
        missedFindingId: `missed-${Date.now().toString(36)}`,
        ruleId: normalizedRuleId,
        severity: missedDraft.severity,
        reasonCodes: [missedDraft.reasonCode],
        evidenceAssessment: {
          outcome: missedDraft.evidenceOutcome,
          anchors,
        },
        legalBasisAssessment: {
          outcome: missedDraft.legalBasisOutcome,
          basisRefs: hasBasis
            ? [
                {
                  sourceId: missedDraft.sourceId.trim(),
                  provisionId: missedDraft.provisionId.trim(),
                },
              ]
            : [],
        },
      });
      slot.status = "in_review";
      touchReview(slot.caseReview, next);
      await persist(next, presentations, `놓친 항목 ${normalizedRuleId}를 추가했습니다.`);
      setMissedDraft(emptyMissedDraft);
    } catch (error) {
      setAnnouncement(
        error instanceof Error ? error.message : "놓친 항목을 저장하지 못했습니다.",
      );
    }
  }

  async function removeMissedFinding(missedFindingId: string) {
    if (!selectedSlot?.caseReview) return;
    try {
      const next = mutableDataset();
      const slot = next.slots.find(
        (entry) => entry.slotId === selectedSlot.slotId,
      );
      if (!slot?.caseReview) return;
      slot.caseReview.manualMissedFindings =
        slot.caseReview.manualMissedFindings.filter(
          (finding) => finding.missedFindingId !== missedFindingId,
        );
      slot.status = "in_review";
      touchReview(slot.caseReview, next);
      await persist(next, presentations, "놓친 항목을 삭제했습니다.");
    } catch (error) {
      setAnnouncement(
        error instanceof Error ? error.message : "놓친 항목을 삭제하지 못했습니다.",
      );
    }
  }

  async function completeSlot() {
    if (!selectedSlot?.caseReview) return;
    if (totalFindingCount === 0) {
      setAnnouncement(
        "완료 전에 같은 분석 JSON을 다시 가져와 검토 대상 수를 확인해 주세요.",
      );
      return;
    }
    if (reviewedFindingCount !== totalFindingCount) {
      setAnnouncement(
        `아직 ${totalFindingCount - reviewedFindingCount}개 지적의 판정이 남았습니다.`,
      );
      return;
    }
    if (selectedSlot.caseReview.documentCompleteness === "unknown") {
      setAnnouncement("분석한 문서가 전체인지 일부인지 먼저 선택해 주세요.");
      return;
    }
    if (
      selectedSlot.caseReview.documentCompleteness === "full" &&
      !selectedSlot.caseReview.omissionCheckCompleted
    ) {
      setAnnouncement("시스템이 놓친 항목 확인을 완료해 주세요.");
      return;
    }
    try {
      const next = mutableDataset();
      const slot = next.slots.find(
        (entry) => entry.slotId === selectedSlot.slotId,
      );
      if (!slot?.caseReview) return;
      slot.status = "completed";
      touchReview(slot.caseReview, next);
      await persist(
        next,
        presentations,
        `${selectedSlot.slotId} 사전 교정을 완료했습니다. 전문가 평가로 간주되지는 않습니다.`,
      );
    } catch (error) {
      setAnnouncement(
        error instanceof Error ? error.message : "표본을 완료하지 못했습니다.",
      );
    }
  }

  async function reopenSlot() {
    if (!selectedSlot?.caseReview) return;
    const next = mutableDataset();
    const slot = next.slots.find(
      (entry) => entry.slotId === selectedSlot.slotId,
    );
    if (!slot?.caseReview) return;
    slot.status = "in_review";
    touchReview(slot.caseReview, next);
    await persist(next, presentations, `${selectedSlot.slotId}을 다시 열었습니다.`);
  }

  async function clearSelectedSlot() {
    if (!dataset || !selectedSlot?.caseReview) return;
    if (
      !window.confirm(
        `${selectedSlot.slotId}의 판정과 해시 기록을 모두 지울까요? 이 작업은 되돌릴 수 없습니다.`,
      )
    ) {
      return;
    }
    const next = mutableDataset();
    const slot = next.slots.find(
      (entry) => entry.slotId === selectedSlot.slotId,
    );
    if (!slot) return;
    slot.status = "unassigned";
    slot.caseReview = null;
    if (next.slots.every((entry) => entry.caseReview === null)) {
      next.legalCohort = null;
    }
    const nextPresentations = { ...presentations };
    delete nextPresentations[selectedSlot.slotId];
    setTransfers((current) => {
      const nextTransfers = { ...current };
      delete nextTransfers[selectedSlot.slotId];
      return nextTransfers;
    });
    await persist(next, nextPresentations, `${selectedSlot.slotId}을 비웠습니다.`);
  }

  async function exportDataset() {
    if (!dataset) return;
    setBusy(true);
    try {
      const refreshed = refreshDeveloperCalibrationAggregate(dataset);
      const json = serializeDeveloperCalibrationDataset(refreshed);
      downloadJson(json, `법령렌즈-개발자-사전교정-${dateForFile()}.json`);
      setAnnouncement("익명 교정 데이터 JSON을 내보냈습니다. 데이터 버전은 바뀌지 않습니다.");
    } catch (error) {
      setAnnouncement(
        error instanceof Error ? error.message : "교정 데이터를 내보내지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function importDataset(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > DEVELOPER_CALIBRATION_MAX_JSON_BYTES) {
      setAnnouncement("5MB 이하의 교정 데이터 JSON만 가져올 수 있습니다.");
      return;
    }
    if (
      dataset &&
      dataset.aggregate.calibrationCounts.unassignedSlots < 24 &&
      !window.confirm(
        "현재 기기 기록을 가져온 데이터로 바꿀까요? 먼저 내보내기로 백업하는 것을 권합니다.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const imported = parseDeveloperCalibrationDataset(await file.text());
      const nextPresentations: Record<string, CalibrationCasePresentation> = {};
      await persist(imported, nextPresentations, "교정 데이터 JSON을 복원했습니다.");
      setTransfers({});
      setPendingTransfer(null);
      setPendingOrganizationAlias("");
      const firstOpen = imported.slots.find(
        (slot) => slot.status !== "completed",
      );
      setSelectedSlotId(firstOpen?.slotId ?? imported.slots[0].slotId);
    } catch (error) {
      setAnnouncement(
        error instanceof Error ? error.message : "교정 데이터 JSON을 복원하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resetAll() {
    if (
      !window.confirm(
        "이 기기의 24개 사전 교정 기록을 모두 삭제할까요? 내보내지 않은 기록은 복구할 수 없습니다.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await resetCalibrationWorkspace();
      const fresh = createEmptyDeveloperCalibrationDataset({
        datasetId: "devcal-local-v1",
        now: new Date().toISOString(),
      });
      setDataset(fresh);
      setPresentations({});
      setTransfers({});
      setPendingTransfer(null);
      setPendingOrganizationAlias("");
      setSelectedSlotId("slot-01");
      setDrafts({});
      setMissedDraft(emptyMissedDraft);
      setAnnouncement("이 기기의 사전 교정 기록을 모두 삭제했습니다.");
    } catch (error) {
      setAnnouncement(
        error instanceof Error ? error.message : "기기 기록을 초기화하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!dataset || !selectedSlot) {
    return <div className={styles.loading}>사전 교정 작업공간을 준비하고 있습니다.</div>;
  }

  return (
    <div className={styles.shell}>
      <section className={styles.hero} aria-labelledby="calibration-title">
        <span className={styles.eyebrow}>PRIVATE REVIEW WORKSPACE</span>
        <h1 id="calibration-title">분석 결과를 직접 교정해 보세요</h1>
        <p className={styles.heroLead}>
          업종별 4개씩, 총 24개 실제 처리방침을 같은 방식으로 살펴보며 시스템의
          지적이 맞는지와 놓친 문제가 있는지를 기록합니다. 이 기록은 규칙을
          다듬기 위한 개발 단계 자료입니다.
        </p>
        <div className={styles.notExpertNotice} role="note">
          <span className={styles.noticeIcon} aria-hidden="true">
            !
          </span>
          <div>
            <strong>개발자 사전 교정 · 전문가 평가 아님</strong>
            <p>
              아래 결과는 법률 정확도, 준수율 또는 위법 판단을 증명하지 않습니다.
              정식 정확도 공개에는 독립된 개인정보 전문가의 별도 검토가 필요합니다.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.metrics} aria-label="사전 교정 진행 요약">
        <article className={styles.metric}>
          <span>완료한 표본</span>
          <strong>{completedSlots} / 24</strong>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-label="완료한 표본"
            aria-valuemin={0}
            aria-valuemax={24}
            aria-valuenow={completedSlots}
          >
            <span style={{ width: `${completionPercent}%` }} />
          </div>
          <small>{calibrationStage} · 정확도 의미 아님</small>
        </article>
        <article className={styles.metric}>
          <span>현재 검토 중</span>
          <strong>{inReviewSlots}</strong>
          <small>기기에서 이어서 검토할 표본</small>
        </article>
        <article className={styles.metric}>
          <span>완료 표본의 맞음 / 오탐</span>
          <strong>
            {confirmationCount} / {falsePositiveCount}
          </strong>
          <small>정확도 수치가 아닌 개발자 판정 건수</small>
        </article>
        <article className={styles.metric}>
          <span>완료 표본에서 놓친 항목</span>
          <strong>{missedCount}</strong>
          <small>전체 원문을 확인한 표본에서 기록</small>
        </article>
      </section>

      <div className={styles.privacyStrip} role="note">
        <span>
          <strong>기기 안에만 저장됩니다.</strong> 서버·AI·외부 API로 교정 기록을
          보내지 않습니다.
        </span>
        <span>발견 문구는 화면 이동 중에만 잠시 보관하고 열자마자 삭제</span>
      </div>

      <div className={styles.workspace} id="calibration-workspace" tabIndex={-1}>
        <aside className={styles.slotPanel} aria-label="24개 표본 목록">
          <div className={styles.panelHeading}>
            <h2>표본 24개</h2>
            <span>{completionPercent}% 완료</span>
          </div>
          {groupedSlots.map((group) => (
            <section className={styles.sectorGroup} key={group.sector}>
              <h3>{sectorLabels[group.sector]}</h3>
              <div className={styles.slotList}>
                {group.slots.map((slot) => (
                  <button
                    className={styles.slotButton}
                    type="button"
                    key={slot.slotId}
                    aria-current={slot.slotId === selectedSlotId}
                    onClick={() => {
                      setSelectedSlotId(slot.slotId);
                      setFindingErrors({});
                    }}
                  >
                    <span className={styles.slotNumber}>
                      {slot.slotId.slice(-2)}
                    </span>
                    <span className={styles.slotName}>
                      {caseTitle(presentations[slot.slotId], slot.slotId)}
                    </span>
                    <span
                      className={styles.statusDot}
                      data-status={slot.status}
                      title={statusLabels[slot.status]}
                      aria-hidden="true"
                    />
                    <span className="srOnly">상태: {statusLabels[slot.status]}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </aside>

        <div className={styles.content}>
          <div className={styles.mobileSlotPicker}>
            <label htmlFor="mobile-slot">검토할 표본</label>
            <select
              id="mobile-slot"
              value={selectedSlotId}
              onChange={(event) => setSelectedSlotId(event.target.value)}
            >
              {dataset.slots.map((slot) => (
                <option key={slot.slotId} value={slot.slotId}>
                  {slot.slotId} · {sectorLabels[slot.sector]} · {statusLabels[slot.status]}
                </option>
              ))}
            </select>
          </div>

          <section className={styles.card} aria-labelledby="import-title">
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.kicker}>STEP 1 · 분석 결과 가져오기</span>
                <h2 id="import-title">법령렌즈 분석 JSON을 불러오세요</h2>
                <p>
                  홈의 ‘사전 교정으로 보내기’를 쓰거나, ‘검토 포함 JSON’ 파일을
                  선택할 수 있습니다. 발견 문구는 화면 이동 중 세션 저장소에
                  잠시 두었다가 이 화면이 열리면 즉시 삭제하며, IndexedDB와
                  내보내는 JSON에는 남기지 않습니다.
                </p>
              </div>
              <span className={styles.statusBadge}>무료 · 외부 전송 0회</span>
            </div>
            <div className={styles.importGrid}>
              <input
                ref={analysisFileRef}
                className={styles.fileInput}
                type="file"
                accept="application/json,.json"
                onChange={handleAnalysisFile}
                disabled={busy}
                aria-label="분석 결과 JSON 선택"
              />
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => analysisFileRef.current?.click()}
                disabled={busy}
              >
                분석 JSON 선택
              </button>
            </div>
            {pendingTransfer && (
              <div className={styles.pendingTransfer}>
                <div>
                  <strong>{pendingTransfer.policyTitle}</strong>
                  <p>
                    지적 {pendingTransfer.findings.length}건 · 문서 해시 {pendingTransfer.documentHash.slice(0, 12)}…
                  </p>
                </div>
                <label className={styles.field}>
                  <span>조직 별칭 · 이 브라우저에만 저장</span>
                  <input
                    value={pendingOrganizationAlias}
                    onChange={(event) =>
                      setPendingOrganizationAlias(event.target.value.slice(0, 120))
                    }
                    placeholder="예: 쇼핑 A"
                    maxLength={120}
                    required
                  />
                </label>
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={assignPendingTransfer}
                  disabled={busy}
                >
                  {selectedSlotId}에 넣기
                </button>
              </div>
            )}
            <details className={styles.privacyDetails}>
              <summary>무엇을 남기고 무엇을 버리나요?</summary>
              <ul>
                <li>남김: 규칙 ID, 판정 코드, 원문 위치, SHA-256, 법령 출처 ID</li>
                <li>교정 기록·내보내기에서 제외: 원문·발견 문구·URL·자유 메모</li>
                <li>화면용 처리방침 제목은 이 브라우저의 별도 표시 정보로만 저장되며 내보내기에서 제외</li>
              </ul>
            </details>
          </section>

          <section className={styles.card} aria-labelledby="slot-title">
            <div className={styles.slotSummary}>
              <div>
                <span className={styles.kicker}>
                  {selectedSlot.slotId} · {sectorLabels[selectedSlot.sector]}
                </span>
                <h2 id="slot-title">
                  {caseTitle(selectedPresentation, selectedSlot.slotId)}
                </h2>
                <p>
                  {statusLabels[selectedSlot.status]} · 개발자 자기검토 · 전문가 검증 전
                </p>
              </div>
              <span className={styles.statusBadge} data-status={selectedSlot.status}>
                {statusLabels[selectedSlot.status]}
              </span>
            </div>
            {selectedSlot.caseReview && (
              <div className={styles.documentMeta}>
                <span>판정 {reviewedFindingCount}건</span>
                <span>놓친 항목 {selectedSlot.caseReview.manualMissedFindings.length}건</span>
                <code>
                  {selectedSlot.caseReview.sourcePins.sourceDocumentSha256.slice(0, 20)}…
                </code>
              </div>
            )}
          </section>

          {!selectedSlot.caseReview ? (
            <section className={styles.card}>
              <div className={styles.emptyState}>
                <strong>아직 분석 결과가 없는 표본 칸입니다</strong>
                <p>
                  위에서 분석 JSON을 선택한 다음 ‘{selectedSlot.slotId}에 넣기’를
                  누르세요. 업종별 네 칸에는 서로 다른 회사의 방침을 넣는 것이 좋습니다.
                </p>
              </div>
            </section>
          ) : !selectedTransfer ? (
            <section className={styles.card}>
              <div className={styles.reloadNotice}>
                <strong>판정 근거를 보려면 같은 분석 JSON이 필요합니다</strong>
                <p>
                  원문과 발견 문구는 개인정보 보호를 위해 기기에 저장하지 않습니다.
                  판정을 새로 하거나 바꾸기 전에 같은 문서의 분석 JSON을 다시
                  가져오세요. 기존 해시 판정은 그대로 보존됩니다.
                </p>
              </div>
            </section>
          ) : (
            <>
              <section className={styles.card} aria-labelledby="review-guide-title">
                <div className={styles.omissionHeader}>
                  <h3 id="review-guide-title">판정은 세 가지로 단순하게</h3>
                  <p>
                    발견 문구와 분석 이유, 연결된 법적 근거를 함께 읽고 선택하세요.
                  </p>
                </div>
                <div className={styles.reviewGuide}>
                  <div>
                    <strong>맞음</strong>
                    <span>지적과 위험 강도가 원문·법적 근거에 비춰 타당함</span>
                  </div>
                  <div>
                    <strong>오탐</strong>
                    <span>필요한 내용이 있거나 규칙이 잘못 적용된 것으로 보임</span>
                  </div>
                  <div>
                    <strong>판단 유보</strong>
                    <span>문맥·사실관계·전문가 검토가 더 있어야 판단 가능함</span>
                  </div>
                </div>
              </section>

              <div className={styles.findings} aria-label="분석 지적 검토">
                {selectedTransfer.findings.map((finding, index) => {
                  const persisted = selectedSlot.caseReview?.findingReviews.find(
                    (review) => review.findingId === finding.findingId,
                  );
                  const draft =
                    drafts[finding.findingId] ?? findingDraftFromReview(persisted);
                  return (
                    <article
                      className={styles.findingCard}
                      data-severity={finding.severity}
                      key={finding.findingId}
                    >
                      <div className={styles.findingTopline}>
                        <div>
                          <div className={styles.findingMeta}>
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            <span>·</span>
                            <span>{finding.category}</span>
                            <span>·</span>
                            <code>{finding.ruleId}</code>
                          </div>
                          <h3>{finding.title}</h3>
                        </div>
                        <div className={styles.findingMeta}>
                          <span className={styles.severityTag}>
                            {severityLabels[finding.severity]}
                          </span>
                          {persisted && (
                            <span className={styles.reviewedTag}>
                              {decisionLabels[persisted.decision]}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className={styles.findingSummary}>
                        {finding.summary || "이 지적의 요약 설명이 없습니다."}
                      </p>
                      <blockquote className={styles.evidenceBox}>
                        <strong>발견 문구</strong>
                        {finding.evidence ? (
                          `“${finding.evidence}”`
                        ) : (
                          <em className={styles.noEvidence}>
                            직접 인용된 문구가 없습니다. 이 경우 근거 확인은 판단 유보가
                            안전합니다.
                          </em>
                        )}
                      </blockquote>
                      {finding.legalBasis.length > 0 && (
                        <ul className={styles.basisList} aria-label="연결된 법적 근거">
                          {finding.legalBasis.map((basis) => (
                            <li key={`${basis.sourceId}-${basis.provisionId}`}>
                              {basis.label || `${basis.sourceId} ${basis.provisionId}`}
                            </li>
                          ))}
                        </ul>
                      )}
                      {finding.recommendation && (
                        <details className={styles.recommendation}>
                          <summary>분석기가 제안한 확인 방법</summary>
                          <p>{finding.recommendation}</p>
                        </details>
                      )}

                      <div className={styles.decisionForm}>
                        <fieldset>
                          <legend>이 지적은 맞나요?</legend>
                          <div className={styles.decisionChoices}>
                            {(
                              [
                                ["confirmed", "맞음", "지적과 근거가 타당함"],
                                ["false_positive", "오탐", "잘못 경고한 것으로 보임"],
                                ["uncertain", "판단 유보", "추가 확인이 필요함"],
                              ] as const
                            ).map(([value, label, help]) => (
                              <label className={styles.choice} key={value}>
                                <input
                                  type="radio"
                                  name={`decision-${finding.findingId}`}
                                  value={value}
                                  checked={draft.decision === value}
                                  onChange={() =>
                                    updateDraft(finding.findingId, {
                                      decision: value,
                                      severityFit:
                                        value === "confirmed"
                                          ? "appropriate"
                                          : value === "false_positive"
                                            ? "overstated"
                                            : "uncertain",
                                      evidenceOutcome:
                                        value === "confirmed" && finding.evidence
                                          ? "supported"
                                          : "uncertain",
                                      legalBasisOutcome:
                                        value === "confirmed" &&
                                        finding.legalBasis.length > 0
                                          ? "supported"
                                          : "uncertain",
                                      reasonCode:
                                        value === "confirmed" ? "" : draft.reasonCode,
                                    })
                                  }
                                />
                                <strong>{label}</strong>
                                <small>{help}</small>
                              </label>
                            ))}
                          </div>
                        </fieldset>

                        <div className={styles.assessmentGrid}>
                          {draft.decision && draft.decision !== "confirmed" && (
                            <label className={styles.field}>
                              <span>이유 · 필수</span>
                              <select
                                value={draft.reasonCode}
                                onChange={(event) =>
                                  updateDraft(finding.findingId, {
                                    reasonCode: event.target
                                      .value as FindingDraft["reasonCode"],
                                  })
                                }
                              >
                                <option value="">이유 선택</option>
                                {reasonOptions.map(([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <label className={styles.field}>
                            <span>발견 문구가 판단을 뒷받침하나요?</span>
                            <select
                              value={draft.evidenceOutcome}
                              onChange={(event) =>
                                updateDraft(finding.findingId, {
                                  evidenceOutcome: event.target.value as AssessmentOutcome,
                                })
                              }
                            >
                              {assessmentOptions.map(([value, label]) => (
                                <option
                                  key={value}
                                  value={value}
                                  disabled={value === "supported" && !finding.evidence}
                                >
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className={styles.field}>
                            <span>연결된 법적 근거가 적절한가요?</span>
                            <select
                              value={draft.legalBasisOutcome}
                              onChange={(event) =>
                                updateDraft(finding.findingId, {
                                  legalBasisOutcome: event.target.value as AssessmentOutcome,
                                })
                              }
                            >
                              {assessmentOptions.map(([value, label]) => (
                                <option
                                  key={value}
                                  value={value}
                                  disabled={
                                    value === "supported" && finding.legalBasis.length === 0
                                  }
                                >
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className={styles.field}>
                            <span>표시한 위험 강도는 적절한가요?</span>
                            <select
                              value={draft.severityFit}
                              onChange={(event) =>
                                updateDraft(finding.findingId, {
                                  severityFit: event.target.value as SeverityFit,
                                })
                              }
                            >
                              {severityFitOptions.map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className={styles.formActions}>
                          {findingErrors[finding.findingId] && (
                            <span className={styles.inlineError} role="alert">
                              {findingErrors[finding.findingId]}
                            </span>
                          )}
                          <button
                            className={styles.secondaryButton}
                            type="button"
                            onClick={() => saveFindingReview(finding)}
                            disabled={busy}
                          >
                            판정 저장
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}

          {selectedSlot.caseReview && (
            <section className={styles.card} aria-labelledby="omission-title">
              <div className={styles.omissionHeader}>
                <h3 id="omission-title">시스템이 놓친 항목도 확인하세요</h3>
                <p>
                  누락 여부는 전체 방침을 봐야 평가할 수 있습니다. 일부 문서라면
                  ‘일부·불확실’을 선택하고 결과를 보수적으로 해석합니다.
                </p>
              </div>
              <fieldset className={styles.decisionForm}>
                <legend>확인한 문서 범위</legend>
                <div className={styles.completenessChoices}>
                  {(
                    [
                      ["full", "전체 방침", "처음부터 끝까지 확인"],
                      ["partial", "일부·불확실", "일부만 있거나 범위 불명확"],
                      ["unknown", "아직 모름", "범위를 먼저 확인해야 함"],
                    ] as const
                  ).map(([value, label, help]) => (
                    <label className={styles.choice} key={value}>
                      <input
                        type="radio"
                        name={`completeness-${selectedSlot.slotId}`}
                        value={value}
                        checked={
                          selectedSlot.caseReview?.documentCompleteness === value
                        }
                        onChange={() =>
                          updateDocumentReview({ documentCompleteness: value })
                        }
                      />
                      <strong>{label}</strong>
                      <small>{help}</small>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={selectedSlot.caseReview.omissionCheckCompleted}
                  disabled={selectedSlot.caseReview.documentCompleteness === "unknown"}
                  onChange={(event) =>
                    updateDocumentReview({
                      omissionCheckCompleted: event.target.checked,
                    })
                  }
                />
                시스템 출력과 별개로 원문에서 놓친 항목을 확인했습니다
              </label>

              <div className={styles.missedForm}>
                <h4>놓친 항목 추가</h4>
                <div className={styles.threeColumns}>
                  <label className={styles.field}>
                    <span>문제 종류 ID</span>
                    <input
                      value={missedDraft.ruleId}
                      onChange={(event) =>
                        setMissedDraft((current) => ({
                          ...current,
                          ruleId: event.target.value,
                        }))
                      }
                      placeholder="예: missing-overseas-recipient"
                      maxLength={80}
                    />
                    <small className={styles.fieldHelp}>
                      어떤 규칙을 추가·수정할지 알 수 있는 짧은 영문 이름입니다.
                    </small>
                  </label>
                  <label className={styles.field}>
                    <span>중요도</span>
                    <select
                      value={missedDraft.severity}
                      onChange={(event) =>
                        setMissedDraft((current) => ({
                          ...current,
                          severity: event.target.value as MissedDraft["severity"],
                        }))
                      }
                    >
                      <option value="high">높음</option>
                      <option value="medium">중간</option>
                      <option value="low">낮음</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>놓친 이유</span>
                    <select
                      value={missedDraft.reasonCode}
                      onChange={(event) =>
                        setMissedDraft((current) => ({
                          ...current,
                          reasonCode: event.target.value as MissedDraft["reasonCode"],
                        }))
                      }
                    >
                      <option value="missing_rule_output">필요한 지적 자체가 없음</option>
                      <option value="wrong_pass_classification">문제인데 문구 확인으로 표시</option>
                      <option value="severity_understated">위험도를 너무 낮게 표시</option>
                      <option value="finding_type_mismatch">지적 유형을 잘못 분류</option>
                    </select>
                  </label>
                </div>

                <details className={styles.optionalDetails}>
                  <summary>근거 위치와 법 조항 기록(선택)</summary>
                  <div className={styles.assessmentGrid}>
                    <label className={styles.field}>
                    <span>근거 문구 평가</span>
                    <select
                      value={missedDraft.evidenceOutcome}
                      onChange={(event) =>
                        setMissedDraft((current) => ({
                          ...current,
                          evidenceOutcome: event.target.value as AssessmentOutcome,
                        }))
                      }
                    >
                      {assessmentOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    </label>
                    <label className={styles.field}>
                    <span>근거 문구 · 저장하지 않음</span>
                    <input
                      value={missedDraft.evidencePhrase}
                      onChange={(event) =>
                        setMissedDraft((current) => ({
                          ...current,
                          evidencePhrase: event.target.value.slice(0, 800),
                        }))
                      }
                      placeholder="해시로 바꾼 뒤 즉시 폐기"
                      maxLength={800}
                    />
                    <small className={styles.fieldHelp}>
                      JSON에는 문구 대신 SHA-256만 남습니다.
                    </small>
                    </label>
                    <label className={styles.field}>
                    <span>원문 시작 위치</span>
                    <input
                      type="number"
                      min={0}
                      value={missedDraft.evidenceStart}
                      onChange={(event) =>
                        setMissedDraft((current) => ({
                          ...current,
                          evidenceStart: event.target.value,
                        }))
                      }
                      placeholder="예: 1240"
                    />
                    </label>
                    <label className={styles.field}>
                    <span>법적 근거 평가</span>
                    <select
                      value={missedDraft.legalBasisOutcome}
                      onChange={(event) =>
                        setMissedDraft((current) => ({
                          ...current,
                          legalBasisOutcome: event.target.value as AssessmentOutcome,
                        }))
                      }
                    >
                      {assessmentOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    </label>
                    <label className={styles.field}>
                    <span>법령 출처 ID</span>
                    <input
                      value={missedDraft.sourceId}
                      onChange={(event) =>
                        setMissedDraft((current) => ({
                          ...current,
                          sourceId: event.target.value,
                        }))
                      }
                      placeholder="예: pipa"
                      maxLength={80}
                    />
                    </label>
                    <label className={styles.field}>
                    <span>조항</span>
                    <input
                      value={missedDraft.provisionId}
                      onChange={(event) =>
                        setMissedDraft((current) => ({
                          ...current,
                          provisionId: event.target.value,
                        }))
                      }
                      placeholder="예: 제30조"
                      maxLength={80}
                    />
                    </label>
                  </div>
                </details>
                <div className={styles.formActions}>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={addMissedFinding}
                    disabled={busy || !selectedSlot.caseReview.omissionCheckCompleted}
                  >
                    놓친 항목 저장
                  </button>
                </div>
              </div>

              {selectedSlot.caseReview.manualMissedFindings.length > 0 && (
                <ul className={styles.missedList} aria-label="기록한 놓친 항목">
                  {selectedSlot.caseReview.manualMissedFindings.map((finding) => (
                    <li key={finding.missedFindingId}>
                      <span>
                        <code>{finding.ruleId}</code> · {severityLabels[finding.severity]}
                      </span>
                      <button
                        className={styles.textButton}
                        type="button"
                        onClick={() => removeMissedFinding(finding.missedFindingId)}
                      >
                        삭제
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {selectedSlot.caseReview && (
            <div className={styles.completionBar}>
              <div>
                <strong>
                  지적 판정 {reviewedFindingCount} / {totalFindingCount || "재가져오기 필요"}
                </strong>
                <span>완료해도 전문가 평가나 법률 정확도 수치로 바뀌지 않습니다.</span>
              </div>
              {selectedSlot.status === "completed" ? (
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={reopenSlot}
                  disabled={busy}
                >
                  검토 다시 열기
                </button>
              ) : (
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={completeSlot}
                  disabled={busy}
                >
                  이 표본 완료
                </button>
              )}
            </div>
          )}

          <section className={styles.card} aria-labelledby="data-tools-title">
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.kicker}>PRIVATE DATA TOOLS</span>
                <h3 id="data-tools-title">백업과 기기 기록 관리</h3>
                <p>
                  내보내는 JSON에는 회사명·URL·원문·발견 문구가 없습니다. 다른
                  기기에서 이어갈 때는 같은 분석 JSON도 다시 준비해야 합니다.
                </p>
              </div>
            </div>
            <div className={styles.tools}>
              <div className={styles.toolRow}>
                <div>
                  <strong>익명 교정 데이터 JSON</strong>
                  <p>판정 코드·해시·원문 위치·법령 출처 ID만 백업</p>
                </div>
                <div className={styles.toolActions}>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={exportDataset}
                    disabled={busy}
                  >
                    내보내기
                  </button>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => datasetFileRef.current?.click()}
                    disabled={busy}
                  >
                    복원하기
                  </button>
                  <input
                    ref={datasetFileRef}
                    className="srOnly"
                    type="file"
                    accept="application/json,.json"
                    onChange={importDataset}
                    tabIndex={-1}
                  />
                </div>
              </div>
              <div className={styles.toolRow}>
                <div>
                  <strong>선택한 표본 비우기</strong>
                  <p>현재 표본의 판정과 해시 기록만 삭제</p>
                </div>
                <button
                  className={styles.dangerButton}
                  type="button"
                  onClick={clearSelectedSlot}
                  disabled={busy || !selectedSlot.caseReview}
                >
                  {selectedSlotId} 비우기
                </button>
              </div>
              <div className={styles.toolRow}>
                <div>
                  <strong>기기 기록 전체 초기화</strong>
                  <p>24개 표본을 모두 지움 · 내보내지 않은 기록은 복구 불가</p>
                </div>
                <button
                  className={styles.dangerButton}
                  type="button"
                  onClick={resetAll}
                  disabled={busy}
                >
                  전체 초기화
                </button>
              </div>
            </div>
          </section>

          {fatalError && (
            <div className={styles.inlineError} role="alert">
              {fatalError}
            </div>
          )}
          <div className={styles.liveRegion} role="status" aria-live="polite">
            {announcement}
          </div>
        </div>
      </div>
    </div>
  );
}
