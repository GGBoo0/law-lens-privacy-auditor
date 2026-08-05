export const LEGAL_BASELINE = {
  verifiedAt: "2026-08-05",
  rulesetVersion: "KR-PRIVACY-2026.08.05-r2",
  statutes: [
    {
      name: "개인정보 보호법",
      version: "시행 2025.10.02 · 법률 제20897호",
      scope: "기본 규칙",
      url: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=270351",
    },
    {
      name: "개인정보 보호법 시행령",
      version: "시행 2026.05.19 · 대통령령 제36340호",
      scope: "기본 규칙",
      url: "https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900079801",
    },
    {
      name: "개인정보 처리방침 작성지침",
      version: "개인정보보호위원회 · 2026.04 개정",
      scope: "공식 지침",
      url: "https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030020&nttId=12018",
    },
    {
      name: "개인정보 처리방침 평가에 관한 고시",
      version: "시행 2024.02.20 · 개인정보보호위원회고시 제2024-3호",
      scope: "적정성·가독성·접근성 평가체계",
      url: "https://www.law.go.kr/admRulLsInfoP.do?admRulSeq=2100000236594",
    },
    {
      name: "개인정보 보호법 시행령 제44조의4",
      version: "시행 2026.05.19 · 자동화된 결정 공개사항",
      scope: "완전히 자동화된 결정이 있을 때",
      url: "https://law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1033216053",
    },
    {
      name: "개인정보의 안전성 확보조치 기준",
      version: "시행 2026.07.01 · 고시 제2026-9호",
      scope: "기본 규칙",
      url: "https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulNm=%EA%B0%9C%EC%9D%B8%EC%A0%95%EB%B3%B4%EC%9D%98+%EC%95%88%EC%A0%84%EC%84%B1+%ED%99%95%EB%B3%B4%EC%A1%B0%EC%B9%98+%EA%B8%B0%EC%A4%80&docType=JO&joNo=001300000&languageType=KO&paras=1",
    },
    {
      name: "전자상거래법·시행령",
      version: "시행령 2026.07.21 · 대통령령 제36507호",
      scope: "전자상거래 신호가 있을 때",
      url: "https://law.go.kr/LSW/lumLsLinkPop.do?lspttninfSeq=63460",
    },
    {
      name: "인공지능기본법",
      version: "시행 2026.07.21 · 법률 제21311호",
      scope: "AI 서비스 신호가 있을 때",
      url: "https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031809547",
    },
    {
      name: "위치정보법",
      version: "시행 2025.10.01 · 제18조·제19조",
      scope: "위치정보 신호가 있을 때",
      url: "https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=9001000163",
    },
    {
      name: "신용정보법",
      version: "현행 제31조·제32조",
      scope: "개인신용정보 신호가 있을 때",
      url: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1025128075",
    },
  ],
  upcomingChanges: [
    {
      name: "개인정보 보호법 시행령",
      version: "시행 예정 2026.08.20 · 대통령령 제36121호",
      effectiveFrom: "2026-08-20",
      status: "시행 전 · 적용 대상은 본인전송요구 방법 반영 필요",
      url: "https://www.law.go.kr/lsRvsDocListP.do?lsId=011468",
    },
    {
      name: "개인정보 보호법",
      version: "시행 예정 2026.09.11 · 법률 제21445호",
      effectiveFrom: "2026-09-11",
      status: "시행 전 · 분석 규칙 미적용",
      url: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=283839&viewCls=lsRvsDocInfoR",
    },
  ],
} as const;
