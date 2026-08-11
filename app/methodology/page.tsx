import type { Metadata } from "next";
import Link from "next/link";
import accuracyStatus from "../../data/legal-accuracy-status.json";

export const metadata: Metadata = {
  title: "평가 방법과 정확도 상태 | 법령렌즈",
  description:
    "법령렌즈의 법령 최신성, URL 자동 발견 QA와 법률 판단 정확도 검증 상태를 구분해 안내합니다.",
};

export default function MethodologyPage() {
  const discovery = accuracyStatus.urlDiscoveryQa;
  const expertReview = accuracyStatus.expertReview;

  return (
    <main className="legalPage">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="법령렌즈 홈으로">
          <span className="brandMark" aria-hidden="true">
            ㄹ
          </span>
          <span>법령렌즈</span>
        </Link>
        <nav className="legalPageNav" aria-label="서비스 안내 문서">
          <Link href="/methodology" aria-current="page">
            평가 방법
          </Link>
          <Link href="/privacy">개인정보</Link>
          <Link href="/terms">이용조건·문의</Link>
        </nav>
      </header>

      <article className="legalDocument">
        <header className="legalDocumentHeader">
          <span className="documentTag">METHOD · PUBLIC BETA</span>
          <h1>평가 방법과 정확도 상태</h1>
          <p>
            법령이 최신인지, 공식 처리방침을 찾았는지, 법률 판단이 정확한지는
            서로 다른 문제입니다. 법령렌즈는 세 상태를 섞지 않고 공개합니다.
          </p>
          <div className="documentMeta">
            <span>상태 기준일 {accuracyStatus.asOfDate}</span>
            <span>법률 판단 정확도: {accuracyStatus.label}</span>
          </div>
          <div className="documentNotice" role="note">
            법률 판단 정확도는 아직 숫자로 제공하지 않습니다. 화면의 {" "}
            {discovery.verifiedSourceRatePercent}%는 URL 자동 발견 QA 결과이며 법률
            준수율·위반 확률·법률 판단 정확도가 아닙니다.
          </div>
        </header>

        <section aria-labelledby="three-statuses">
          <h2 id="three-statuses">1. 서로 다른 세 가지 상태</h2>
          <dl className="dataGrid methodologyGrid">
            <dt>법령 최신성</dt>
            <dd>
              공식 법령·지침의 변경과 시행일을 감시하고, 현재 규칙셋이 검토된
              기준일을 표시합니다. 이는 법률 자료가 최신인지에 관한 상태이지 분석
              결과의 정확도 지표가 아닙니다.
            </dd>
            <dt>URL 자동 발견 QA</dt>
            <dd>
              {discovery.asOfDate} 기준 주요 서비스 {discovery.sampleSize}개 중 예상한
              공식 출처 {discovery.verifiedSourceCount}개를 확인했습니다(
              {discovery.verifiedSourceRatePercent}%). 예상 공식 도메인 밖 출처 선택은{" "}
              {discovery.wrongSourceCount}개였습니다. 측정 범위는 {discovery.scope}입니다.
            </dd>
            <dt>법률 판단 정확도</dt>
            <dd>
              현재 상태는 <strong>{accuracyStatus.label}</strong>입니다. 전문가
              골든셋 평가 지표는 미산출이며 숫자 정확도를 표시하지 않습니다.
            </dd>
          </dl>
        </section>

        <section aria-labelledby="current-validation">
          <h2 id="current-validation">2. 현재 검증 단계</h2>
          <p>{accuracyStatus.summary}</p>
          <ul className="methodologyFacts">
            <li>
              개인정보 전문가 검토자: {expertReview.reviewerCount}명 · 공개 기준은
              최소 {expertReview.requiredReviewerCount}명의 독립 검토
            </li>
            <li>
              전문가 검토 문서: {expertReview.corpusDocumentCount}개 · 확정 라벨: {" "}
              {expertReview.adjudicatedUnitCount}개
            </li>
            <li>법률 판단 통계 지표: 미산출</li>
            <li>전문가 평가일: 없음</li>
          </ul>
          <p>
            현재 회귀 코퍼스는 규칙의 긍정·부정 예시가 같은 결과를 재현하는지
            확인하는 개발용 안전장치입니다. 전문가가 실제 처리방침을 독립적으로
            판정한 통계적 정확도 데이터셋과 같지 않습니다.
          </p>
        </section>

        <section aria-labelledby="future-metrics">
          <h2 id="future-metrics">3. 전문가 평가 후 공개할 항목</h2>
          <ul>
            <li>골든셋 버전, 문서 수, 확정 라벨 수와 평가일</li>
            <li>검토자 수, 독립 검토 방식과 불일치 조정 절차</li>
            <li>전체 및 규칙별 정밀도·재현율·F1</li>
            <li>‘누락 가능성 높음’과 같은 고위험 결과의 오탐률</li>
            <li>판정 유보를 포함한 라벨 정의와 제외 기준</li>
          </ul>
          <p>
            이 요건이 충족되기 전에는 ‘정확도’, ‘준수율’ 또는 ‘위반 확률’처럼
            오해할 수 있는 숫자를 법률 판단 성능으로 표시하지 않습니다.
          </p>
        </section>

        <section aria-labelledby="reading-results">
          <h2 id="reading-results">4. 결과를 해석하는 방법</h2>
          <ol>
            <li>점수는 문구가 확인된 기재요소의 비율이며 법률 준수율이 아닙니다.</li>
            <li>누락·모호성 결과는 원문 근거와 적용 조문을 함께 확인해야 합니다.</li>
            <li>실제 수집 화면·동의 절차·계약과 서버 동작은 별도 현장 검증 대상입니다.</li>
            <li>신고·제재·계약 변경 전에는 개인정보 전문가나 변호사의 검토가 필요합니다.</li>
          </ol>
          <div className="documentActions">
            <Link href="/">분석 화면으로</Link>
            <Link href="/privacy">개인정보 처리 안내</Link>
            <Link href="/terms">이용조건·문의</Link>
          </div>
        </section>
      </article>
    </main>
  );
}
