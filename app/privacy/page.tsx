import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "개인정보 처리 안내 | 법령렌즈",
  description: "법령렌즈 공개 베타가 분석 요청과 남용 방지 정보를 처리하는 방식을 안내합니다.",
};

export default function PrivacyPage() {
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
          <Link href="/privacy" aria-current="page">
            개인정보
          </Link>
          <Link href="/terms">이용조건·문의</Link>
        </nav>
      </header>

      <article className="legalDocument">
        <header className="legalDocumentHeader">
          <span className="documentTag">PUBLIC BETA</span>
          <h1>개인정보 처리 안내</h1>
          <p>
            법령렌즈 공개 베타가 분석 요청을 처리하는 과정과 저장하지 않는
            정보, 남용 방지를 위해 제한적으로 사용하는 정보를 설명합니다.
          </p>
          <div className="documentMeta">
            <span>시행일 2026년 8월 12일</span>
            <span>운영 주체: GitHub GGBoo0 · 법령렌즈 공개 베타</span>
          </div>
          <div className="documentNotice" role="note">
            현재 서비스에는 회원가입·결제·마케팅 기능이 없습니다. 비공개
            개인정보나 내부 전용 문서를 입력하지 마세요.
          </div>
        </header>

        <section>
          <h2>1. 처리하는 정보와 목적</h2>
          <dl className="dataGrid">
            <dt>입력 URL·방침 원문</dt>
            <dd>
              요청한 공개 처리방침을 발견·추출하고 규칙 기반 분석 결과를 만들기
              위해 해당 요청이 진행되는 동안 처리합니다.
            </dd>
            <dt>네트워크 주소 기반 키</dt>
            <dd>
              과도한 분석 요청을 제한하기 위해 요청의 IPv4 주소 또는 IPv6 /64를
              비밀키 기반 HMAC-SHA-256으로 매일 달라지는 가명키로 바꾸고, 키의
              일부와 요청 횟수, 만료 시각을 사용합니다. 원본 주소를 앱
              데이터베이스에 저장하지 않으며 가명키를 익명정보라고 단정하지
              않습니다.
            </dd>
            <dt>기본 접속 정보</dt>
            <dd>
              서비스 전송과 보안을 위해 호스팅 인프라가 접속 시각, 네트워크 주소,
              사용자 에이전트와 오류 정보를 일시적으로 처리할 수 있습니다.
            </dd>
          </dl>
        </section>

        <section>
          <h2>2. 저장과 보유</h2>
          <ul>
            <li>
              입력한 URL, 처리방침 원문과 분석 결과는 법령렌즈 앱 데이터베이스에
              저장하지 않습니다.
            </li>
            <li>
              남용 방지 키의 요청 창은 1분입니다. 만료 레코드는 다음 분석 요청 때
              정리되므로 서비스에 후속 요청이 없으면 실제 삭제 시점이 늦어질 수
              있습니다.
            </li>
            <li>
              사용자가 직접 내려받은 JSON·PDF 결과는 사용자의 기기에만 남으며
              사용자가 관리합니다.
            </li>
            <li>
              개발자 사전 교정 기록은 서버나 D1에 보내지 않고 현재 브라우저의
              IndexedDB에만 저장합니다. 교정용 백업에는 처리방침 원문·발견 문구·URL을
              넣지 않습니다. 같은 회사를 반복하지 않기 위한 조직 별칭도 이 브라우저에만
              저장하고 백업에서는 제외합니다. 다만 문서 지문과 검토 판정이 포함되므로
              백업 파일은 비공개로 관리해야 합니다.
            </li>
            <li>
              분석 화면에서 ‘사전 교정으로 보내기’를 선택하면 검토에 필요한 분석
              요약과 짧은 발견 문구를 브라우저 세션 저장소에 임시로 두며, 교정 화면이
              이를 읽는 즉시 삭제합니다. 이 문구는 IndexedDB나 교정용 백업에 남기지
              않습니다.
            </li>
            <li>
              브라우저 데이터 삭제, 시크릿 모드 종료 또는 기기 변경 시 사전 교정
              기록이 사라질 수 있습니다. 필요한 기록은 사용자가 직접 JSON으로
              백업하고 삭제합니다.
            </li>
          </ul>
        </section>

        <section>
          <h2>3. 외부 통신과 제공</h2>
          <p>
            URL 분석을 요청하면 법령렌즈 서버가 해당 웹사이트의 공개 페이지에
            접속합니다. 대상 사이트는 서비스 서버의 요청 정보를 받을 수 있습니다.
            붙여 넣은 원문을 분석하기 위해 외부 AI API나 유료 브라우저 API로
            전송하지 않습니다.
          </p>
          <p>
            법령 감시 실행 기록, 법령 원문이나 피드백 링크를 선택하면 GitHub,
            국가법령정보센터 또는 개인정보보호위원회 등 해당 외부 사이트의 정책이
            적용됩니다.
          </p>
          <p>
            공개 베타는 OpenAI Sites를 통해 배포되며 애플리케이션 런타임과 요청
            제한 저장소로 Cloudflare Workers·D1 구성을 사용합니다. 글로벌 엣지
            특성상 기본 접속 정보가 대한민국 밖에서 처리될 가능성이 있고,
            인프라 로그의 구체적인 처리 위치와 보유기간은 제공자의 정책·운영
            설정에 따릅니다. 운영자는 해당 인프라 로그 전체를 별도로 복제하거나
            앱 분석 이력과 결합하지 않습니다.
          </p>
        </section>

        <section>
          <h2>4. 이용자의 선택과 요청</h2>
          <p>
            URL 대신 원문 붙여넣기를 선택할 수 있고, 분석 전에는 언제든 입력을
            중단할 수 있습니다. 서버 계정이나 서버에 저장된 분석 이력이 없으므로
            운영자가 이를 조회하는 기능은 제공하지 않습니다. 사전 교정 기록은
            작업대의 초기화 기능이나 브라우저 설정에서 직접 삭제할 수 있습니다.
            개인정보 처리 관련 문의는 아래 공개 베타 문의 채널로 남길 수 있습니다.
          </p>
          <p>
            GitHub 문의는 공개될 수 있으므로 이름, 연락처, 비공개 URL이나 방침
            원문 등 개인정보를 작성하지 마세요.
          </p>
        </section>

        <section>
          <h2>5. 안전조치와 안내 변경</h2>
          <p>
            법령렌즈는 내부·사설 네트워크 접근 차단, 리다이렉트 재검사, 요청 크기와
            시간 제한, 동일 출처 검사, 콘텐츠 보안 정책과 요청 속도 제한을
            적용합니다. 저장 기능이나 외부 분석 서비스가 추가되어 처리 방식이
            달라지면 이 안내의 시행일과 변경 내용을 갱신합니다.
          </p>
        </section>

        <section id="contact">
          <h2>6. 운영 문의</h2>
          <p>
            GitHub 계정 GGBoo0가 이 공개 베타를 운영합니다. 일반 문의는 저장소의
            이슈 양식을 이용할 수 있습니다. 현재 별도 전화·이메일 상담 창구는
            운영하지 않습니다. 보안 취약점이나 개인정보가 포함된 내용은 공개
            이슈가 아닌 비공개 보안 신고 경로를 이용하고, 가능한 경우 개인정보를
            제거해 주세요.
          </p>
          <div className="documentActions">
            <Link href="/">분석 화면으로</Link>
            <Link href="/methodology">평가 방법·정확도</Link>
            <a
              href="https://github.com/GGBoo0/law-lens-privacy-auditor/issues/new/choose"
              target="_blank"
              rel="noreferrer"
            >
              공개 베타 문의 ↗
            </a>
            <a
              href="https://github.com/GGBoo0/law-lens-privacy-auditor/security/advisories/new"
              target="_blank"
              rel="noreferrer"
            >
              취약점 비공개 신고 ↗
            </a>
            <Link href="/terms">이용조건 보기</Link>
          </div>
        </section>
      </article>
    </main>
  );
}
