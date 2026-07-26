"use client";

import { FormEvent, useMemo, useState } from "react";

type Severity = "high" | "medium" | "low" | "pass" | "na";

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
  state: "present" | "missing" | "conditional" | "na";
  detail: string;
};

type AnalysisResult = {
  sourceUrl?: string;
  policyUrl?: string;
  policyTitle: string;
  retrievedAt: string;
  textLength: number;
  score: number;
  grade: string;
  counts: {
    high: number;
    medium: number;
    low: number;
    pass: number;
  };
  headline: string;
  findings: Finding[];
  coverage: CoverageItem[];
  detectedSignals: string[];
  policyExcerpt: string;
  analysisEngine: {
    mode: "local_rules";
    name: string;
    version: string;
    aiUsed: false;
    externalApiCalls: 0;
    estimatedApiCostKrw: 0;
    limitations: string[];
  };
  legalBaseline: {
    date: string;
    statutes: Array<{
      name: string;
      version: string;
      url: string;
    }>;
  };
};

const samplePolicy = `주식회사 모아는 회원가입 및 서비스 제공을 위하여 이름, 이메일, 휴대전화번호를 수집합니다.
수집한 정보는 서비스 제공, 맞춤형 서비스 개선, 마케팅 등 회사가 필요하다고 판단하는 목적으로 이용할 수 있습니다.
개인정보는 회원 탈퇴 시까지 보유하며, 관계 법령에 따라 필요한 경우 계속 보관할 수 있습니다.
결제와 배송 업무를 외부 업체에 위탁할 수 있으며 업체는 사정에 따라 변경될 수 있습니다.
서비스 이용 과정에서 쿠키와 접속정보가 자동으로 수집될 수 있습니다.
회사는 서비스 개선을 위해 해외 클라우드 서비스를 이용할 수 있습니다.
개인정보 관련 문의는 고객센터로 연락해 주세요.
본 방침은 2026년 1월 1일부터 적용됩니다.`;

const severityOrder: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
  pass: 3,
  na: 4,
};

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
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [openFinding, setOpenFinding] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Severity>("all");

  const filteredFindings = useMemo(() => {
    if (!result) return [];
    return [...result.findings]
      .filter((finding) => filter === "all" || finding.severity === filter)
      .sort(
        (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
      );
  }, [filter, result]);

  async function analyze(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (mode === "url" && !url.trim()) {
      setError("분석할 회사 또는 개인정보처리방침 URL을 입력해 주세요.");
      return;
    }
    if (mode === "text" && policyText.trim().length < 120) {
      setError("분석할 방침 원문을 120자 이상 붙여 넣어 주세요.");
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "url" ? { url: url.trim() } : { text: policyText.trim() },
        ),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error ||
            "방침을 불러오지 못했습니다. 방침 원문을 직접 붙여 넣어 주세요.",
        );
      }

      setResult(data);
      const firstIssue = data.findings.find(
        (finding: Finding) =>
          finding.severity === "high" || finding.severity === "medium",
      );
      setOpenFinding(firstIssue?.id ?? null);
      setFilter("all");
      window.setTimeout(() => {
        document
          .getElementById("report")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  function loadSample() {
    setMode("text");
    setPolicyText(samplePolicy);
    setError("");
  }

  function downloadReport() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], {
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
          대한민국 법령 기준일 2026.07.26
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
            위반 소지를 오늘 기준 대한민국 법령과 함께 짚어드립니다.
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
              className={mode === "url" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={mode === "url"}
              onClick={() => setMode("url")}
            >
              웹사이트 URL
            </button>
            <button
              className={mode === "text" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={mode === "text"}
              onClick={() => setMode("text")}
            >
              방침 원문
            </button>
          </div>

          <form onSubmit={analyze}>
            {mode === "url" ? (
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
                  로그인 없이 공개된 HTML 방침을 분석할 수 있습니다.
                </small>
              </label>
            ) : (
              <label className="fieldLabel">
                개인정보처리방침 원문
                <textarea
                  value={policyText}
                  onChange={(event) => setPolicyText(event.target.value)}
                  placeholder="수집이 막힌 사이트나 PDF 방침은 원문을 붙여 넣어 주세요."
                  rows={8}
                />
                <small>{policyText.length.toLocaleString("ko-KR")}자 입력됨</small>
              </label>
            )}

            {error && (
              <div className="errorBox" role="alert">
                <span aria-hidden="true">!</span>
                {error}
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
            <button className="sampleButton" type="button" onClick={loadSample}>
              입력 전에 샘플 결과 확인
            </button>
          </form>

          <div className="privacyNote">
            <span aria-hidden="true">●</span>
            외부 AI API로 전송하지 않습니다. 입력 내용은 요청 중 규칙
            분석에만 사용하며 앱 데이터베이스에 저장하지 않습니다.
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
              <h2>{result.policyTitle}</h2>
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
            </div>
            <button className="downloadButton" onClick={downloadReport}>
              JSON 내려받기
            </button>
          </div>

          <div className="scoreGrid">
            <article className={`scoreCard score-${result.grade}`}>
              <div className="scoreRing" style={{ "--score": result.score } as React.CSSProperties}>
                <div>
                  <strong>{result.score}</strong>
                  <span>/ 100</span>
                </div>
              </div>
              <div>
                <div className="scoreLabel">{result.grade}</div>
                <h3>{result.headline}</h3>
                <p>
                  자동화 검토 결과입니다. 실제 처리 흐름·동의 화면·위탁계약을
                  함께 확인해야 최종 판단할 수 있습니다.
                </p>
              </div>
            </article>

            <div className="countCards">
              <button onClick={() => setFilter("high")}>
                <span className="countDot high" />
                <strong>{result.counts.high}</strong>
                <small>위반 소지</small>
              </button>
              <button onClick={() => setFilter("medium")}>
                <span className="countDot medium" />
                <strong>{result.counts.medium}</strong>
                <small>그레이존</small>
              </button>
              <button onClick={() => setFilter("low")}>
                <span className="countDot low" />
                <strong>{result.counts.low}</strong>
                <small>확인 필요</small>
              </button>
              <button onClick={() => setFilter("pass")}>
                <span className="countDot pass" />
                <strong>{result.counts.pass}</strong>
                <small>확인됨</small>
              </button>
            </div>
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
            <details>
              <summary>무료 분석의 한계</summary>
              <ul>
                {result.analysisEngine.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </details>
          </div>

          <div className="reportLayout">
            <div className="findingsPanel">
              <div className="sectionHeading">
                <div>
                  <span className="stepPill">02</span>
                  <div>
                    <h3>근거가 있는 위험 신호</h3>
                    <p>문제 가능성이 큰 순서로 정렬했습니다.</p>
                  </div>
                </div>
                <div className="filterRow" aria-label="결과 필터">
                  {(
                    [
                      ["all", "전체"],
                      ["high", "위반 소지"],
                      ["medium", "그레이존"],
                      ["pass", "확인됨"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      className={filter === value ? "active" : ""}
                      onClick={() => setFilter(value)}
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
                        </span>
                        <span className="chevron" aria-hidden="true">
                          {opened ? "−" : "+"}
                        </span>
                      </button>
                      {opened && (
                        <div className="findingDetail">
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
                            자동 판정 신뢰도 {finding.confidence}
                            {finding.requiresFactualVerification &&
                              " · 현장 검증 필요"}
                          </div>
                        </div>
                      )}
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
                    <h3>필수항목 커버리지</h3>
                    <p>법 제30조·시행령 제31조 기준</p>
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
              <h3>오늘 적용한 법령과 지침</h3>
              <p>
                기준일 이후 개정·시행되는 규정은 자동으로 소급 반영하지
                않았습니다.
              </p>
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
                    <small>{statute.version}</small>
                  </span>
                  <b aria-hidden="true">↗</b>
                </a>
              ))}
            </div>
          </div>

          <details className="excerpt">
            <summary>분석에 사용한 추출 원문 일부 보기</summary>
            <pre>{result.policyExcerpt}</pre>
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
      </footer>
    </main>
  );
}
