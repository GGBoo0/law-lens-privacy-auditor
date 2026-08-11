import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "이용조건·문의 | 법령렌즈",
  description: "법령렌즈 공개 베타의 이용 범위, 책임과 문의 방법을 안내합니다.",
};

export default function TermsPage() {
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
          <Link href="/methodology">평가 방법</Link>
          <Link href="/calibration">사전 교정</Link>
          <Link href="/privacy">개인정보</Link>
          <Link href="/terms" aria-current="page">
            이용조건·문의
          </Link>
        </nav>
      </header>

      <article className="legalDocument">
        <header className="legalDocumentHeader">
          <span className="documentTag">PUBLIC BETA</span>
          <h1>이용조건·문의</h1>
          <p>
            법령렌즈는 개인정보처리방침의 누락·모호성·추가 확인 필요 신호를 찾는
            의사결정 지원 도구입니다.
          </p>
          <div className="documentMeta">
            <span>시행일 2026년 8월 12일</span>
            <span>버전: 공개 베타 1.1</span>
          </div>
          <div className="documentNotice" role="note">
            분석 결과는 위법 여부를 확정하지 않으며 변호사, 개인정보 보호책임자
            또는 감독기관의 판단을 대체하지 않습니다.
          </div>
        </header>

        <section>
          <h2>1. 서비스의 범위</h2>
          <ul>
            <li>공개 웹사이트에서 개인정보처리방침 후보를 발견하고 추출합니다.</li>
            <li>공식 검증일 기준 규칙과 문장 패턴으로 기재 여부를 점검합니다.</li>
            <li>원문 근거, 관련 법령, 수정 제안과 사실 확인 필요 항목을 제공합니다.</li>
            <li>
              개발자가 분석 결과의 맞음·오탐·판단 유보와 놓친 항목을 기기 안에서
              기록하는 사전 교정 작업대를 제공합니다.
            </li>
          </ul>
          <p>
            실제 수집 화면, 네트워크 전송, 동의 절차, 삭제 이행이나 내부 업무는
            처리방침만으로 확인할 수 없습니다. 결과에 표시된 법령 버전과 공식
            원문을 중요한 결정 전에 다시 확인해야 합니다.
          </p>
          <p>
            개발자 사전 교정은 규칙 개선을 위한 자가 점검이며 전문가 평가, 법률
            자문 또는 공개 가능한 정확도 측정값이 아닙니다.
          </p>
        </section>

        <section>
          <h2>2. 이용자의 책임</h2>
          <ul>
            <li>
              공개했거나 분석할 권한이 있는 URL과 문서만 입력해야 합니다.
            </li>
            <li>
              비공개 개인정보, 영업비밀, 인증정보 또는 내부 전용 문서를 입력해서는
              안 됩니다.
            </li>
            <li>
              법적 신고, 제재, 계약 해지나 대외 발표에 사용하기 전 전문가와 실제
              처리 현황을 함께 검토해야 합니다.
            </li>
          </ul>
        </section>

        <section>
          <h2>3. 금지되는 이용</h2>
          <ul>
            <li>접근 제한, 로봇 차단이나 인증 절차를 우회하려는 시도</li>
            <li>내부망·클라우드 메타데이터 등 공개 인터넷이 아닌 주소에 대한 요청</li>
            <li>과도한 자동 요청, 서비스 방해, 취약점 악용 또는 악성 코드 전달</li>
            <li>분석 결과를 확정적인 위법 판정으로 왜곡하거나 타인을 기만하는 행위</li>
          </ul>
        </section>

        <section>
          <h2>4. 공개 베타의 가용성과 변경</h2>
          <p>
            서비스는 예고 없이 일시 중단되거나 기능, 점검 규칙과 지원 사이트가
            변경될 수 있습니다. 자동 수집 차단, 자바스크립트 전용 페이지, PDF·HWP,
            외부 사이트 장애와 형식 변경으로 추출이 실패할 수 있습니다.
          </p>
          <p>
            법령 또는 공식 지침의 변경과 시행일은 자동 감시합니다. 미검토 변경이
            시행되면 영향받는 법률판단을 자동으로 유보하지만, 변경의 법적 의미를
            분석 규칙으로 확정하려면 사람 검토가 필요합니다. 화면의 공식 소스 확인
            시각, 판단 유보 상태와 규칙셋 검토일을 구분해서 확인하세요.
          </p>
        </section>

        <section>
          <h2>5. 결과와 책임의 한계</h2>
          <p>
            법령렌즈는 자동 분석 결과의 완전성, 특정 목적 적합성이나 법률적 결론을
            보증하지 않습니다. 다만 오류를 숨기지 않고 근거 문구, 불확실성, 엔진
            버전과 공식 출처를 표시하며 재현 가능한 개선을 위해 노력합니다.
            법령 최신성, URL 자동 발견 QA와 법률 판단 정확도의 구분은
            <Link href="/methodology"> 평가 방법과 정확도 상태</Link>에서 확인할 수
            있습니다.
          </p>
        </section>

        <section>
          <h2>6. 개인정보</h2>
          <p>
            입력 정보, 요청 속도 제한 키와 외부 통신에 관한 자세한 내용은
            <Link href="/privacy"> 개인정보 처리 안내</Link>에서 확인할 수 있습니다.
          </p>
        </section>

        <section id="contact">
          <h2>7. 문의와 피드백</h2>
          <p>
            GitHub 계정 GGBoo0가 이 공개 베타를 운영합니다. 오탐, 누락, 접근
            실패나 사용성 의견은 GitHub 이슈 양식으로 제출할 수 있습니다. 이
            채널은 공개될 수 있으므로 개인정보나 비공개 방침 원문을 포함하지
            마세요.
          </p>
          <div className="documentActions">
            <Link href="/">분석 화면으로</Link>
            <Link href="/methodology">평가 방법·정확도</Link>
            <a
              href="https://github.com/GGBoo0/law-lens-privacy-auditor/issues/new/choose"
              target="_blank"
              rel="noreferrer"
            >
              피드백 남기기 ↗
            </a>
            <Link href="/privacy">개인정보 처리 안내</Link>
          </div>
        </section>
      </article>
    </main>
  );
}
