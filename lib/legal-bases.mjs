import { LEGAL_SOURCE_IDS } from "./legal-source-ids.mjs";

export const SOURCES = Object.freeze({
  pipa15: {
    sourceId: LEGAL_SOURCE_IDS.PIPA,
    law: "개인정보 보호법",
    article: "제15조",
    url: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029335387",
  },
  pipa17: {
    sourceId: LEGAL_SOURCE_IDS.PIPA,
    law: "개인정보 보호법",
    article: "제17조",
    url: "https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1020399013",
  },
  pipa21: {
    sourceId: LEGAL_SOURCE_IDS.PIPA,
    law: "개인정보 보호법",
    article: "제21조",
    url: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=270351",
  },
  pipa22: {
    sourceId: LEGAL_SOURCE_IDS.PIPA,
    law: "개인정보 보호법",
    article: "제22조의2",
    url: "https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1020398521",
  },
  pipa23: {
    sourceId: LEGAL_SOURCE_IDS.PIPA,
    law: "개인정보 보호법",
    article: "제23조",
    url: "https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1027416043",
  },
  pipa24: {
    sourceId: LEGAL_SOURCE_IDS.PIPA,
    law: "개인정보 보호법",
    article: "제24조·제24조의2",
    url: "https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1020398189",
  },
  pipa26: {
    sourceId: LEGAL_SOURCE_IDS.PIPA,
    law: "개인정보 보호법",
    article: "제26조",
    url: "https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1025127467",
  },
  pipa28: {
    sourceId: LEGAL_SOURCE_IDS.PIPA,
    law: "개인정보 보호법",
    article: "제28조의8",
    url: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029334737",
  },
  pipa29: {
    sourceId: LEGAL_SOURCE_IDS.PIPA,
    law: "개인정보 보호법",
    article: "제29조",
    url: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=270351",
  },
  pipa30: {
    sourceId: LEGAL_SOURCE_IDS.PIPA,
    law: "개인정보 보호법",
    article: "제30조",
    url: "https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1020398435",
  },
  decree31: {
    sourceId: LEGAL_SOURCE_IDS.PIPA_DECREE,
    law: "개인정보 보호법 시행령",
    article: "제31조",
    url: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lspttninfSeq=67000",
  },
  rights: {
    sourceId: LEGAL_SOURCE_IDS.PIPA,
    law: "개인정보 보호법",
    article: "제35조~제37조",
    url: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=270351",
  },
  pipaTransfer: {
    sourceId: LEGAL_SOURCE_IDS.PIPA,
    law: "개인정보 보호법",
    article: "제35조의2",
    url: "https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=02&joNo=0035&lsiSeq=270351&urlMode=lsScJoRltInfoR",
  },
  pipaTransferDecree: {
    sourceId: LEGAL_SOURCE_IDS.PIPA_DECREE,
    law: "개인정보 보호법 시행령",
    article: "제42조의2·제42조의4·제42조의6 (2026.8.20 시행)",
    url: "https://www.law.go.kr/LSW/lsInfoP.do?ancYnChk=0&chrClsCd=010202&efYd=20260820&lsiSeq=283503&urlMode=lsEfInfoR&viewCls=lsRvsDocInfoR",
  },
  automated: {
    sourceId: LEGAL_SOURCE_IDS.PIPA,
    law: "개인정보 보호법",
    article: "제37조의2",
    url: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029334889",
  },
  automatedDecree: {
    sourceId: LEGAL_SOURCE_IDS.PIPA_DECREE,
    law: "개인정보 보호법 시행령",
    article: "제44조의4",
    url: "https://law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1033216053",
  },
  pipcGuideline: {
    sourceId: LEGAL_SOURCE_IDS.PIPC_PRIVACY_POLICY_GUIDELINE,
    law: "개인정보보호위원회 작성지침",
    article: "2026 개인정보 처리방침 작성지침(권고)",
    url: "https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030020&nttId=12018",
  },
  location: {
    sourceId: LEGAL_SOURCE_IDS.LOCATION_INFORMATION_ACT,
    law: "위치정보의 보호 및 이용 등에 관한 법률",
    article: "제18조·제19조",
    url: "https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=9001000163",
  },
  credit: {
    sourceId: LEGAL_SOURCE_IDS.CREDIT_INFORMATION_ACT,
    law: "신용정보의 이용 및 보호에 관한 법률",
    article: "제31조·제32조",
    url: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1025128075",
  },
  ecommerce: {
    sourceId: LEGAL_SOURCE_IDS.ECOMMERCE_ACT,
    law: "전자상거래 등에서의 소비자보호에 관한 법률",
    article: "제6조",
    url: "https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031806291",
  },
  ecommerceDecree: {
    sourceId: LEGAL_SOURCE_IDS.ECOMMERCE_DECREE,
    law: "전자상거래 등에서의 소비자보호에 관한 법률 시행령",
    article: "제6조",
    url: "https://law.go.kr/LSW/lumLsLinkPop.do?lspttninfSeq=63460",
  },
  ai: {
    sourceId: LEGAL_SOURCE_IDS.AI_FRAMEWORK_ACT,
    law: "인공지능 발전과 신뢰 기반 조성 등에 관한 기본법",
    article: "제31조",
    url: "https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031809547",
  },
});

export const ANALYZER_LEGAL_SOURCE_IDS = Object.freeze(
  [...new Set(Object.values(SOURCES).map((source) => source.sourceId))].sort(),
);
