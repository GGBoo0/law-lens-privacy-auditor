"use client";

import {
  FormEvent,
  KeyboardEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { LEGAL_BASELINE } from "../lib/legal-baseline";

type Severity = "high" | "medium" | "low" | "pass" | "na";
type ContextKey =
  | "thirdParty"
  | "outsourcing"
  | "overseas"
  | "foreignController"
  | "children"
  | "cookies"
  | "ecommerce"
  | "ai"
  | "automatedDecision";
type ContextChoice = "auto" | "yes" | "no";
type ReviewStatus =
  | "unreviewed"
  | "needs_evidence"
  | "needs_action"
  | "not_applicable"
  | "resolved";

type LegalBasis = {
  law: string;
  article: string;
  url: string;
};

type Finding = {
  id: string;
  category: string;
  title: string;
  severity: Severity;
  label: string;
  summary: string;
  evidence?: string;
  recommendation: string;
  legalBasis: LegalBasis[];
  confidence: "높음" | "보통" | "낮음";
  findingType:
    | "possible_missing_disclosure"
    | "ambiguity_or_inconsistency"
    | "factual_verification"
    | "confirmed_disclosure";
  requiresFactualVerification: boolean;
};

type CoverageItem = {
  label: string;
  state: "present" | "missing" | "conditional" | "unknown" | "na";
  detail: string;
};

type EvaluationAxis = {
  key: "appropriateness" | "readability" | "accessibility" | "consistency";
  label: string;
  state: "good" | "review" | "not_evaluated";
  detail: string;
};

type AnalysisResult = {
  sourceUrl?: string;
  policyUrl?: string;
  discoveryPath?: string[];
  policyTitle: string;
  retrievedAt: string;
  textLength: number;
  score: number;
  grade: string;
  documentHash: string;
  scoreMethod: {
    label: string;
    formula: string;
    meaning: string;
  };
  counts: {
    high: number;
    medium: number;
    low: number;
    pass: number;
  };
  headline: string;
  findings: Finding[];
  coverage: CoverageItem[];
  evaluationAxes: EvaluationAxis[];
  detectedSignals: string[];
  policyExcerpt: string;
  analysisEngine: {
    mode: "local_rules";
    name: string;
    version: string;
    aiUsed: false;
    externalApiCalls: 0;
    estimatedApiCostKrw: 0;
    confidenceMeaning: string;
    evaluationStatus: string;
    limitations: string[];
  };
  legalBaseline: {
    date: string;
    verifiedAt: string;
    rulesetVersion: string;
    monitoring: {
      enabled: boolean;
      schedule: string;
      sourceCount: number;
      mode: string;
      workflowUrl: string;
    };
    statutes: Array<{
      name: string;
      version: string;
      scope: string;
      url: string;
    }>;
    upcomingChanges: Array<{
      name: string;
      version: string;
      effectiveFrom: string;
      status: string;
      url: string;
    }>;
  };
};

type ReviewEntry = {
  status: ReviewStatus;
  note: string;
};

const samplePolicy = `1. 개인정보 처리 목적
주식회사 모아는 회원관리, 서비스 제공, 맞춤형 서비스 개선 및 회사가 필요하다고 판단하는 목적으로 개인정보를 처리합니다.

2. 처리하는 개인정보 항목
이름, 이메일, 휴대전화번호와 서비스 이용기록을 처리합니다.

3. 개인정보 처리 및 보유 기간
회원정보는 회원 탈퇴 시까지 보유하며, 관계 법령에 따라 필요한 경우 계속 보관할 수 있습니다.

4. 개인정보 파기 절차와 방법
보유기간이 끝난 전자파일은 복구할 수 없도록 영구 삭제합니다.

5. 정보주체의 권리와 행사 방법
정보주체는 열람, 정정, 삭제, 처리정지 및 동의 철회를 고객센터에 요청할 수 있습니다.

6. 개인정보 처리위탁
결제와 배송 업무를 외부 업체에 위탁할 수 있으며 업체는 사정에 따라 변경될 수 있습니다.

7. 개인정보 국외 이전
회사는 서비스 개선을 위해 해외 클라우드 서비스를 이용할 수 있습니다.

8. 자동수집 장치
서비스 이용 과정에서 쿠키와 접속정보가 자동으로 수집될 수 있습니다.

9. 개인정보 보호책임자
개인정보 관련 문의는 privacy@example.com 또는 02-1234-5678로 연락해 주세요.

10. 개인정보의 안전성 확보조치
접근권한 관리, 암호화와 접속기록 보관 조치를 시행합니다.

본 방침은 2026년 1월 1일부터 시행됩니다.`;

const severityOrder: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
  pass: 3,
  na: 4,
};

const contextOptions: Array<{
  key: ContextKey;
  label: string;
  help: string;
}> = [
  { key: "thirdParty", label: "제3자 제공", help: "다른 회사가 자체 목적으로 이용함" },
  { key: "outsourcing", label: "처리위탁", help: "외부 업체가 우리 업무를 대신 처리함" },
  { key: "cookies", label: "쿠키·행태정보", help: "쿠키·광고·분석 도구를 사용함" },
  { key: "ecommerce", label: "쇼핑·결제", help: "주문·결제·배송을 운영함" },
  { key: "children", label: "만 14세 미만", help: "아동 회원이나 이용자가 있음" },
  { key: "overseas", label: "국외 이전", help: "해외 서버·클라우드를 사용함" },
  { key: "foreignController", label: "해외 사업자", help: "국외 사업자가 국내 정보를 직접 처리함" },
  { key: "ai", label: "생성형 AI", help: "프롬프트·결과물·모델 학습을 처리함" },
  { key: "automatedDecision", label: "자동화된 결정", help: "사람 개입 없이 권리·의무를 결정함" },
];

const reviewLabels: Record<ReviewStatus, string> = {
  unreviewed: "검토 전",
  needs_evidence: "증거 부족·판단 유보",
  needs_action: "조치 필요",
  not_applicable: "해당 없음",
  resolved: "조치 완료",
};

function feedbackUrl(finding: Finding) {
  const title = encodeURIComponent(`[분석 피드백] ${finding.category} · ${finding.id}`);
  const body = encodeURIComponent(
    `규칙 ID: ${finding.id}\n분류: ${finding.category}\n표시 결과: ${finding.label}\n\n오탐·누락이라고 생각한 이유를 적어 주세요. 개인정보나 비공개 처리방침 원문은 첨부하지 마세요.`,
  );
  return `https://github.com/GGBoo0/law-lens-privacy-auditor/issues/new?title=${title}&body=${body}`;
}

function highlightEvidence(text: string, evidence?: string) {
  if (!evidence) return text;
  const directIndex = text.indexOf(evidence);
  let start = directIndex;
  let end = directIndex < 0 ? -1 : directIndex + evidence.length;

  if (directIndex < 0) {
    const pattern = evidence
      .trim()
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const match = new RegExp(pattern, "i").exec(text);
    if (match?.index !== undefined) {
      start = match.index;
      end = match.index + match[0].length;
    }
  }

  if (start < 0 || end < 0) return text;
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

export default function Home() {
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [policyText, setPolicyText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [canPasteRecovery, setCanPasteRecovery] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [openFinding, setOpenFinding] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const [contextOverrides, setContextOverrides] = useState<
    Record<ContextKey, ContextChoice>
  >({
    thirdParty: "auto",
    outsourcing: "auto",
    overseas: "auto",
    foreignController: "auto",
    children: "auto",
    cookies: "auto",
    ecommerce: "auto",
    ai: "auto",
    automatedDecision: "auto",
  });
  const [reviewEntries, setReviewEntries] = useState<Record<string, ReviewEntry>>(
    {},
  );
  const [sourceFindingId, setSourceFindingId] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const reportHeadingRef = useRef<HTMLHeadingElement>(null);
  const sourceRef = useRef<HTMLDetailsElement>(null);
  const policyTextRef = useRef<HTMLTextAreaElement>(null);

  const filteredFindings = useMemo(() => {
    if (!result) return [];
    return [...result.findings]
      .filter((finding) => filter === "all" || finding.severity === filter)
      .sort(
        (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
      );
  }, [filter, result]);

  const selectedSourceFinding = useMemo(
    () =>
      result?.findings.find((finding) => finding.id === sourceFindingId) ?? null,
    [result, sourceFindingId],
  );

  async function requestAnalysis(payload: { url?: string; text?: string }) {
    setError("");
    setCanPasteRecovery(false);
    setLoading(true);
    setResult(null);
    setSourceFindingId(null);
    setSourceOpen(false);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, contexts: contextOverrides }),
      });

      const data = await response.json();
      if (!response.ok) {
        setCanPasteRecovery(Boolean(data.canPaste));
        throw new Error(
          data.error ||
            "방침을 불러오지 못했습니다. 방침 원문을 직접 붙여 넣어 주세요.",
        );
      }

      setResult(data);
      const firstIssue = [...data.findings]
        .sort(
          (a: Finding, b: Finding) =>
            severityOrder[a.severity] - severityOrder[b.severity],
        )
        .find(
          (finding: Finding) =>
            finding.severity === "high" || finding.severity === "medium",
        );
      setOpenFinding(firstIssue?.id ?? null);
      setFilter("all");
      setReviewEntries({});
      window.setTimeout(() => {
        reportHeadingRef.current?.focus({ preventScroll: true });
        document.getElementById("report")?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start",
        });
      }, 80);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "분석 중 오류가 발생했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function analyze(event: FormEvent) {
    event.preventDefault();

    if (mode === "url" && !url.trim()) {
      setError("분석할 회사 또는 개인정보처리방침 URL을 입력해 주세요.");
      return;
    }
    if (mode === "text" && policyText.trim().length < 120) {
      setError("분석할 방침 원문을 120자 이상 붙여 넣어 주세요.");
      return;
    }
    await requestAnalysis(
      mode === "url" ? { url: url.trim() } : { text: policyText.trim() },
    );
  }

  async function loadSample() {
    setMode("text");
    setPolicyText(samplePolicy);
    setError("");
    await requestAnalysis({ text: samplePolicy });
  }

  function openPasteRecovery() {
    setMode("text");
    setError("");
    setCanPasteRecovery(false);
    window.setTimeout(() => policyTextRef.current?.focus(), 0);
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const nextMode =
      event.key === "ArrowLeft" || event.key === "Home" ? "url" : "text";
    setMode(nextMode);
    document.getElementById(`input-tab-${nextMode}`)?.focus();
  }

  function updateReview(id: string, update: Partial<ReviewEntry>) {
    setReviewEntries((current) => ({
      ...current,
      [id]: {
        status: current[id]?.status ?? "unreviewed",
        note: current[id]?.note ?? "",
        ...update,
      },
    }));
  }

  function showEvidence(finding: Finding) {
    setSourceFindingId(finding.id);
    setSourceOpen(true);
    window.setTimeout(() => {
      sourceRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 30);
  }

  function downloadReport() {
    if (!result) return;
    const report = {
      ...result,
      humanReview: {
        exportedAt: new Date().toISOString(),
        entries: reviewEntries,
      },
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `법령렌즈-개인정보처리방침-분석-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  function printReport() {
    const previousFilter = filter;
    setFilter("all");
    window.setTimeout(() => {
      window.print();
      setFilter(previousFilter);
    }, 50);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="법령렌즈 처음으로">
          <span className="brandMark" aria-hidden="true">
            ㄹ
          </span>
          <span>법령렌즈</span>
        </a>
        <div className="topMeta">
          <span className="liveDot" aria-hidden="true" />
          규칙 검토 {LEGAL_BASELINE.verifiedAt.replaceAll("-", ".")}
          <b>· 매일 자동 감시</b>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="heroCopy">
          <div className="eyebrow">PRIVACY POLICY RISK SCANNER</div>
          <h1>
            개인정보처리방침,
            <br />
            <span>어디가 위험한지</span> 먼저 봅니다.
          </h1>
          <p className="heroLead">
            회사 홈페이지를 넣으면 방침을 찾아 추출하고, 누락·모호성·
            위반 소지를 공식 검증일 기준 대한민국 법령과 함께 짚어드립니다.
          </p>
          <div className="proofRow">
            <div>
              <strong>18+</strong>
              <span>핵심 점검 기준</span>
            </div>
            <div>
              <strong>조문별</strong>
              <span>근거와 수정 제안</span>
            </div>
            <div>
              <strong>₩0</strong>
              <span>외부 AI API 분석비</span>
            </div>
          </div>
        </div>

        <div className="analyzerCard">
          <div className="cardHeader">
            <span className="stepPill">01</span>
            <div>
              <h2>검토할 대상을 입력하세요</h2>
              <p>홈페이지 주소만 넣어도 방침 링크를 자동으로 찾습니다.</p>
            </div>
          </div>

          <div className="modeTabs" role="tablist" aria-label="분석 입력 방식">
            <button
              id="input-tab-url"
              className={mode === "url" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={mode === "url"}
              aria-controls="input-panel-url"
              tabIndex={mode === "url" ? 0 : -1}
              onClick={() => setMode("url")}
              onKeyDown={handleTabKey}
            >
              웹사이트 URL
            </button>
            <button
              id="input-tab-text"
              className={mode === "text" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={mode === "text"}
              aria-controls="input-panel-text"
              tabIndex={mode === "text" ? 0 : -1}
              onClick={() => setMode("text")}
              onKeyDown={handleTabKey}
            >
              방침 원문
            </button>
          </div>

          <form onSubmit={analyze} aria-busy={loading}>
            {mode === "url" ? (
              <div
                id="input-panel-url"
                role="tabpanel"
                aria-labelledby="input-tab-url"
              >
                <label className="fieldLabel">
                  회사 또는 방침 주소
                  <div className="urlField">
                    <span aria-hidden="true">https://</span>
                    <input
                      type="text"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="company.co.kr"
                      autoComplete="url"
                      inputMode="url"
                      aria-describedby="url-help"
                    />
                  </div>
                  <small id="url-help">
                    홈페이지의 링크·포함 문서·공통 경로·사이트맵과 일부 공식 공개
                    데이터를 비용 없이 확인해 방침 본문을 찾습니다.
                  </small>
                </label>
              </div>
            ) : (
              <div
                id="input-panel-text"
                role="tabpanel"
                aria-labelledby="input-tab-text"
              >
                <label className="fieldLabel">
                  개인정보처리방침 원문
                  <textarea
                    ref={policyTextRef}
                    value={policyText}
                    onChange={(event) => setPolicyText(event.target.value)}
                    placeholder="수집이 막힌 사이트나 PDF 방침은 원문을 붙여 넣어 주세요."
                    rows={8}
                  />
                  <small>
                    {policyText.length.toLocaleString("ko-KR")}자 입력됨
                  </small>
                </label>
              </div>
            )}

            <fieldset className="contextPicker">
              <legend>서비스 맥락 보정 <small>선택사항</small></legend>
              <p>
                알고 있는 사실을 표시하면 방침에 해당 내용이 빠졌는지 함께
                확인합니다. 본문 신호가 명확하면 ‘비해당’ 선택으로 숨기지 않습니다.
              </p>
              <div>
                {contextOptions.map((option) => (
                  <label key={option.key}>
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.help}</small>
                    </span>
                    <select
                      value={contextOverrides[option.key]}
                      onChange={(event) =>
                        setContextOverrides((current) => ({
                          ...current,
                          [option.key]: event.target.value as ContextChoice,
                        }))
                      }
                      aria-label={`${option.label} 적용 여부`}
                    >
                      <option value="auto">문서 자동 판단</option>
                      <option value="yes">해당함</option>
                      <option value="no">해당 없음</option>
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>

            {error && (
              <div className="errorBox" role="alert">
                <span aria-hidden="true">!</span>
                <div>
                  <p>{error}</p>
                  {canPasteRecovery && (
                    <button type="button" onClick={openPasteRecovery}>
                      원문 붙여넣기로 계속하기
                    </button>
                  )}
                </div>
              </div>
            )}

            <button className="primaryButton" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  방침을 읽고 조문과 대조하는 중
                </>
              ) : (
                <>
                  위험 신호 분석하기
                  <span aria-hidden="true">↗</span>
                </>
              )}
            </button>
            <button
              className="sampleButton"
              type="button"
              onClick={loadSample}
              disabled={loading}
            >
              샘플 원문으로 바로 분석
            </button>
            <p className="srOnly" role="status" aria-live="polite">
              {loading
                ? "개인정보처리방침을 분석하고 있습니다."
                : result
                  ? `분석이 완료되었습니다. 누락 가능성 높음 ${result.counts.high}건, 불명확 또는 보완 ${result.counts.medium}건, 사실 확인 ${result.counts.low}건입니다.`
                  : ""}
            </p>
          </form>

          <div className="privacyNote">
            <span aria-hidden="true">●</span>
            유료 브라우저나 외부 AI API로 전송하지 않습니다. 공식 사이트의 공개
            문서와 공개 데이터만 읽으며 입력 내용은 요청 중 규칙 분석에만 사용하고
            앱 데이터베이스에 저장하지 않습니다. URL은
            IP 리터럴·내부 호스트·이동 주소를 검사하고 공개 인터넷 경로만
            사용합니다. 남용 방지용 클라이언트 키는 복원 불가능하게 해시하여
            짧게 보관합니다.
          </div>
        </div>
      </section>

      <section className="coverageStrip" aria-label="검토 범위">
        <span>검토 범위</span>
        <div>필수 공개항목</div>
        <div>제3자 제공·위탁</div>
        <div>국외 이전</div>
        <div>아동·민감정보</div>
        <div>쿠키·행태정보</div>
        <div>AI·자동화 결정</div>
      </section>

      {result && (
        <section className="reportSection" id="report">
          <div className="reportTopline">
            <div>
              <div className="eyebrow">ANALYSIS REPORT</div>
              <h2 ref={reportHeadingRef} tabIndex={-1}>
                {result.policyTitle}
              </h2>
              <p>
                {result.policyUrl ? (
                  <a
                    href={result.policyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {result.policyUrl}
                  </a>
                ) : (
                  "직접 입력한 방침"
                )}
                <span>·</span>
                {formatDate(result.retrievedAt)} 분석
              </p>
              {result.discoveryPath && result.discoveryPath.length > 1 && (
                <div className="discoveryNote">
                  홈페이지에서 {result.discoveryPath.length - 1}단계의 링크를 따라
                  실제 방침 본문을 찾았습니다.
                </div>
              )}
            </div>
            <div className="reportActions">
              <button className="downloadButton" onClick={printReport}>
                PDF 저장·인쇄
              </button>
              <button className="downloadButton" onClick={downloadReport}>
                검토 포함 JSON
              </button>
            </div>
          </div>

          <div className="scoreGrid">
            <article className={`scoreCard score-${result.grade}`}>
              <div
                className="scoreRing"
                style={{ "--score": result.score } as React.CSSProperties}
                role="img"
                aria-label={`${result.scoreMethod.label} ${result.score}점`}
              >
                <div>
                  <strong>{result.score}</strong>
                  <span>/ 100</span>
                </div>
              </div>
              <div>
                <div className="scoreLabel">
                  {result.scoreMethod.label}
                </div>
                <h3>{result.headline}</h3>
                <p>
                  {result.scoreMethod.meaning} 실제 처리 흐름·동의 화면·위탁계약을
                  함께 확인해야 최종 판단할 수 있습니다.
                </p>
              </div>
            </article>

            <div className="countCards">
              <button
                onClick={() => setFilter("high")}
                aria-pressed={filter === "high"}
              >
                <span className="countDot high" />
                <strong>{result.counts.high}</strong>
                <small>누락 가능성 높음</small>
              </button>
              <button
                onClick={() => setFilter("medium")}
                aria-pressed={filter === "medium"}
              >
                <span className="countDot medium" />
                <strong>{result.counts.medium}</strong>
                <small>불명확·보완</small>
              </button>
              <button
                onClick={() => setFilter("low")}
                aria-pressed={filter === "low"}
              >
                <span className="countDot low" />
                <strong>{result.counts.low}</strong>
                <small>사실 확인</small>
              </button>
              <button
                onClick={() => setFilter("pass")}
                aria-pressed={filter === "pass"}
              >
                <span className="countDot pass" />
                <strong>{result.counts.pass}</strong>
                <small>문구 확인</small>
              </button>
            </div>
          </div>

          <div className="evaluationAxes" aria-label="공식 평가체계 기반 자동 점검 축">
            {result.evaluationAxes.map((axis) => (
              <article className={`axis-${axis.state}`} key={axis.key}>
                <span>
                  {axis.state === "good"
                    ? "자동 확인"
                    : axis.state === "review"
                      ? "검토 필요"
                      : "판단 유보"}
                </span>
                <strong>{axis.label}</strong>
                <p>{axis.detail}</p>
              </article>
            ))}
          </div>

          {result.detectedSignals.length > 0 && (
            <div className="signalBar">
              <span>감지된 처리 맥락</span>
              {result.detectedSignals.map((signal) => (
                <em key={signal}>{signal}</em>
              ))}
            </div>
          )}

          <div className="engineStrip" aria-label="분석 엔진 정보">
            <div>
              <span>API 비용</span>
              <strong>₩{result.analysisEngine.estimatedApiCostKrw}</strong>
            </div>
            <div>
              <span>분석 방식</span>
              <strong>{result.analysisEngine.name}</strong>
            </div>
            <div>
              <span>외부 AI 전송</span>
              <strong>{result.analysisEngine.aiUsed ? "사용" : "없음"}</strong>
            </div>
            <div>
              <span>검증 상태</span>
              <strong>{result.analysisEngine.evaluationStatus}</strong>
            </div>
            <details>
              <summary>무료 분석의 한계</summary>
              <ul>
                {result.analysisEngine.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
              <p>{result.analysisEngine.confidenceMeaning}</p>
              <p>{result.scoreMethod.formula}</p>
            </details>
          </div>

          <div className="reportLayout">
            <div className="findingsPanel">
              <div className="sectionHeading">
                <div>
                  <span className="stepPill">02</span>
                  <div>
                    <h3>근거가 있는 점검 결과</h3>
                    <p>누락 가능성·불명확성·사실 확인 순서로 정렬했습니다.</p>
                  </div>
                </div>
                <div className="filterRow" aria-label="결과 필터">
                  {(
                    [
                      ["all", "전체"],
                      ["high", "누락 가능성"],
                      ["medium", "불명확·보완"],
                      ["low", "사실 확인"],
                      ["pass", "문구 확인"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      className={filter === value ? "active" : ""}
                      onClick={() => setFilter(value)}
                      aria-pressed={filter === value}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="findingsList">
                {filteredFindings.map((finding, index) => {
                  const opened = openFinding === finding.id;
                  return (
                    <article
                      className={`finding severity-${finding.severity}`}
                      key={finding.id}
                    >
                      <button
                        className="findingSummary"
                        onClick={() =>
                          setOpenFinding(opened ? null : finding.id)
                        }
                        aria-expanded={opened}
                        aria-controls={`finding-detail-${finding.id}`}
                      >
                        <span className="findingIndex">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className={`statusTag ${finding.severity}`}>
                          {finding.label}
                        </span>
                        <span className="findingTitle">
                          <small>{finding.category}</small>
                          <strong>{finding.title}</strong>
                          {finding.requiresFactualVerification && (
                            <em className="verificationTag">현장 검증 필요</em>
                          )}
                        </span>
                        <span className="chevron" aria-hidden="true">
                          {opened ? "−" : "+"}
                        </span>
                      </button>
                      <div
                        className="findingDetail"
                        id={`finding-detail-${finding.id}`}
                        hidden={!opened}
                      >
                          <p className="findingSummaryText">{finding.summary}</p>
                          {finding.evidence && (
                            <blockquote>
                              <span>발견 문구</span>
                              “{finding.evidence}”
                            </blockquote>
                          )}
                          <div className="legalBasis">
                            <span>적용 근거</span>
                            <div>
                              {finding.legalBasis.map((basis) => (
                                <a
                                  key={`${basis.law}-${basis.article}`}
                                  href={basis.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {basis.law} {basis.article} ↗
                                </a>
                              ))}
                            </div>
                          </div>
                          <div className="recommendation">
                            <span>권고 조치</span>
                            <p>{finding.recommendation}</p>
                          </div>
                          <div className="confidence">
                            패턴 일치 수준 {finding.confidence}
                            {finding.requiresFactualVerification &&
                              " · 현장 검증 필요"}
                          </div>
                          <div className="findingTools">
                            {finding.evidence && (
                              <button type="button" onClick={() => showEvidence(finding)}>
                                원문에서 보기
                              </button>
                            )}
                            <a
                              href={feedbackUrl(finding)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              오탐·누락 신고 ↗
                            </a>
                          </div>
                          <div className="reviewBox">
                            <div>
                              <span>사람 검토</span>
                              <select
                                value={
                                  reviewEntries[finding.id]?.status ?? "unreviewed"
                                }
                                onChange={(event) =>
                                  updateReview(finding.id, {
                                    status: event.target.value as ReviewStatus,
                                  })
                                }
                                aria-label={`${finding.title} 검토 상태`}
                              >
                                {Object.entries(reviewLabels).map(([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <label>
                              검토 메모
                              <textarea
                                value={reviewEntries[finding.id]?.note ?? ""}
                                onChange={(event) =>
                                  updateReview(finding.id, { note: event.target.value })
                                }
                                placeholder="담당자 확인사항이나 조치 내용을 남기세요."
                                rows={2}
                              />
                            </label>
                          </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <aside className="coveragePanel">
              <div className="sectionHeading compact">
                <div>
                  <span className="stepPill">03</span>
                  <div>
                    <h3>기재요소 적용 상태</h3>
                    <p>법 제30조·시행령 제31조 및 조건부 기준</p>
                  </div>
                </div>
              </div>
              <div className="coverageList">
                {result.coverage.map((item) => (
                  <div key={item.label}>
                    <span className={`coverageState ${item.state}`}>
                      {item.state === "present"
                        ? "✓"
                        : item.state === "missing"
                          ? "!"
                          : item.state === "conditional"
                            ? "?"
                            : item.state === "unknown"
                              ? "…"
                            : "—"}
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>

          <div className="sourceGrid">
            <div>
              <div className="eyebrow">LEGAL BASELINE</div>
              <h3>공식 원문으로 검증한 법령과 지침</h3>
              <p>
                공식 검증일 {result.legalBaseline.verifiedAt} · 규칙셋{" "}
                {result.legalBaseline.rulesetVersion}. 조건부 법률은 관련
                처리 신호가 있을 때만 검사합니다.
              </p>
              <a
                className="monitoringCard"
                href={result.legalBaseline.monitoring.workflowUrl}
                target="_blank"
                rel="noreferrer"
              >
                <strong>
                  <span aria-hidden="true" /> 공식 소스 매일 자동 감시
                </strong>
                <small>
                  {result.legalBaseline.monitoring.sourceCount}개 법령·지침 ·{" "}
                  {result.legalBaseline.monitoring.schedule}
                </small>
                <em>{result.legalBaseline.monitoring.mode} ↗</em>
              </a>
              {result.legalBaseline.upcomingChanges.map((change) => (
                <a
                  className="pendingLaw"
                  href={change.url}
                  target="_blank"
                  rel="noreferrer"
                  key={`${change.name}-${change.effectiveFrom}`}
                >
                  <strong>{change.status}</strong>
                  <span>{change.version}</span>
                </a>
              ))}
            </div>
            <div className="statuteList">
              {result.legalBaseline.statutes.map((statute) => (
                <a
                  href={statute.url}
                  target="_blank"
                  rel="noreferrer"
                  key={statute.name}
                >
                  <span>
                    <strong>{statute.name}</strong>
                    <small>
                      {statute.version} · {statute.scope}
                    </small>
                  </span>
                  <b aria-hidden="true">↗</b>
                </a>
              ))}
            </div>
          </div>

          <details
            className="excerpt"
            ref={sourceRef}
            open={sourceOpen}
            onToggle={(event) => setSourceOpen(event.currentTarget.open)}
          >
            <summary>분석에 사용한 추출 원문과 근거 위치 보기</summary>
            <div className="excerptMeta">
              <span>
                문서 SHA-256 <code>{result.documentHash.slice(0, 16)}…</code>
              </span>
              {selectedSourceFinding && (
                <strong>{selectedSourceFinding.title} 근거 표시 중</strong>
              )}
            </div>
            <pre>
              {highlightEvidence(
                result.policyExcerpt,
                selectedSourceFinding?.evidence,
              )}
            </pre>
          </details>
        </section>
      )}

      <section className="methodSection">
        <div>
          <div className="eyebrow">HOW IT WORKS</div>
          <h2>판정과 추측을 섞지 않습니다.</h2>
        </div>
        <div className="methodCards">
          <article>
            <span>1</span>
            <h3>방침 발견·추출</h3>
            <p>공개된 홈페이지에서 처리방침 링크와 본문을 찾아 정리합니다.</p>
          </article>
          <article>
            <span>2</span>
            <h3>무료 규칙·문장 패턴 검사</h3>
            <p>외부 AI 없이 필수항목, 포괄 표현과 문단 간 충돌을 검사합니다.</p>
          </article>
          <article>
            <span>3</span>
            <h3>위험도와 불확실성 분리</h3>
            <p>누락 가능성과 실제 위법 확정을 구분하고 추가 확인사항을 남깁니다.</p>
          </article>
        </div>
      </section>

      <footer>
        <div className="brand">
          <span className="brandMark" aria-hidden="true">
            ㄹ
          </span>
          <span>법령렌즈</span>
        </div>
        <p>
          법률 리스크의 조기 발견을 위한 자동화 도구이며 변호사의 법률의견을
          대체하지 않습니다.
        </p>
        <a
          href="https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=&nttId=12018"
          target="_blank"
          rel="noreferrer"
        >
          2026 처리방침 작성지침 ↗
        </a>
        <a
          href="https://github.com/GGBoo0/law-lens-privacy-auditor/issues/new/choose"
          target="_blank"
          rel="noreferrer"
        >
          피드백 남기기 ↗
        </a>
      </footer>
    </main>
  );
}
