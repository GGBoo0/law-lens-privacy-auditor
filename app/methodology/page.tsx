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
          <Link href="/calibration">사전 교정</Link>
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
              가 확정한 기준 데이터로 계산한 지표는 아직 없으며 숫자 정확도를
              표시하지 않습니다. 여기서 정확도는 전문가의 문서 검토 결과와 시스템
              결과가 얼마나 일치하는지를 뜻하며, 실제 위법 여부를 확정하는 수치가
              아닙니다.
            </dd>
          </dl>
        </section>

        <section aria-labelledby="current-validation">
          <h2 id="current-validation">2. 현재 검증 단계</h2>
          <p>{accuracyStatus.summary}</p>
          <ul className="methodologyFacts">
            <li>
              전문가 평가: 아직 시작 전(검토자 {expertReview.reviewerCount}명, 문서{" "}
              {expertReview.corpusDocumentCount}개)
            </li>
            <li>
              향후 공개 조건: 최소 {expertReview.requiredReviewerCount}명의 독립 검토와
              의견 차이 조정
            </li>
            <li>법률 판단 통계 지표와 전문가 평가일: 없음</li>
          </ul>
          <p>
            현재 회귀 코퍼스는 규칙의 긍정·부정 예시가 같은 결과를 재현하는지
            확인하는 개발용 안전장치입니다. 전문가가 실제 처리방침을 독립적으로
            판정한 통계적 정확도 데이터셋과 같지 않습니다.
          </p>
          <p>
            <strong>지금 이 기준의 역할:</strong> 아직 전문가 평가를 받지 못하더라도
            임의의 정확도 숫자를 만들지 못하게 막고, 나중에 평가를 받을 때 같은
            문서와 같은 법령 기준으로 공정하게 비교할 수 있도록 준비합니다. 현재
            분석 결과는 공식 기준에 따른 사전 점검 자료로만 사용해야 합니다.
          </p>
          <p>
            <Link href="/calibration">개발자 사전 교정</Link>은 실제 분석 결과 24건을
            직접 살펴 오탐과 놓친 항목을 찾는 준비 단계입니다. 이 기록은 전문가가
            만든 정답 데이터와 섞지 않으며 법률 판단 정확도 수치에도 사용하지 않습니다.
          </p>
        </section>

        <section aria-labelledby="future-metrics">
          <h2 id="future-metrics">3. 향후 전문가 평가에서 확인할 항목</h2>
          <p>
            아래 내용은 전문가가 확정한 인증 기준이 아니라, 나중에 같은 방식으로
            공정하게 평가하기 위한 이 프로젝트의 잠정 계획입니다. 단순히 테스트 몇
            개를 통과했다고 정확하다고 표시하지 않습니다.
          </p>
          <ul>
            <li>
              <strong>전문가 판단이 일치하는가:</strong> 전문가 2명이 서로의 답과
              시스템 결과를 보지 않고 같은 문서를 검토합니다.
            </li>
            <li>
              <strong>사례가 충분한가:</strong> 회사와 업종이 한쪽에 치우치지 않은
              실제 처리방침을 충분히 모아 평가합니다.
            </li>
            <li>
              <strong>근거가 정확한가:</strong> 지적한 원문 문구와 법적 근거가 실제
              판단 이유를 뒷받침하는지 확인합니다.
            </li>
            <li>
              <strong>중요한 문제를 놓치지 않는가:</strong> 위험도가 높은 문제를
              제대로 찾는지 별도로 확인합니다.
            </li>
            <li>
              <strong>과하게 경고하지 않는가:</strong> 문제가 아닌 내용을
              &apos;누락 가능성 높음&apos;으로 잘못 표시하는 비율을 따로 봅니다.
            </li>
            <li>
              <strong>우연히 좋아 보이는 결과가 아닌가:</strong> 표본 오차를 감안한
              보수적인 값으로도 기준을 넘어야 통과시킵니다.
            </li>
          </ul>
          <p>
            통과 후에는 평가한 문서 수, 전문가 수, 평가일, 잘 찾은 정도와 잘못
            경고한 정도를 함께 공개합니다. 그전에는 ‘정확도’, ‘준수율’ 또는 ‘위반
            확률’처럼 오해할 수 있는 숫자를 표시하지 않습니다.
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
            <Link href="/calibration">개발자 사전 교정</Link>
            <Link href="/privacy">개인정보 처리 안내</Link>
            <Link href="/terms">이용조건·문의</Link>
          </div>
        </section>
      </article>
    </main>
  );
}
