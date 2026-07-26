export type Severity = "high" | "medium" | "low" | "pass" | "na";

type FindingType =
  | "possible_missing_disclosure"
  | "ambiguity_or_inconsistency"
  | "factual_verification"
  | "confirmed_disclosure";

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
  findingType: FindingType;
  requiresFactualVerification: boolean;
};

type CoverageItem = {
  label: string;
  state: "present" | "missing" | "conditional" | "na";
  detail: string;
};

const SOURCES = {
  pipa15: {
    law: "개인정보 보호법",
    article: "제15조",
    url: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029335387",
  },
  pipa17: {
    law: "개인정보 보호법",
    article: "제17조",
    url: "https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1020399013",
  },
  pipa21: {
    law: "개인정보 보호법",
    article: "제21조",
    url: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=270351",
  },
  pipa22: {
    law: "개인정보 보호법",
    article: "제22조의2",
    url: "https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1020398521",
  },
  pipa23: {
    law: "개인정보 보호법",
    article: "제23조",
    url: "https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1027416043",
  },
  pipa24: {
    law: "개인정보 보호법",
    article: "제24조·제24조의2",
    url: "https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1020398189",
  },
  pipa26: {
    law: "개인정보 보호법",
    article: "제26조",
    url: "https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1025127467",
  },
  pipa28: {
    law: "개인정보 보호법",
    article: "제28조의8",
    url: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029334737",
  },
  pipa29: {
    law: "개인정보 보호법",
    article: "제29조",
    url: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=270351",
  },
  pipa30: {
    law: "개인정보 보호법",
    article: "제30조",
    url: "https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1020398435",
  },
  decree31: {
    law: "개인정보 보호법 시행령",
    article: "제31조",
    url: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lspttninfSeq=67000",
  },
  rights: {
    law: "개인정보 보호법",
    article: "제35조~제37조",
    url: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=270351",
  },
  automated: {
    law: "개인정보 보호법",
    article: "제37조의2",
    url: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029334889",
  },
  location: {
    law: "위치정보의 보호 및 이용 등에 관한 법률",
    article: "제18조·제19조",
    url: "https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=9001000163",
  },
  credit: {
    law: "신용정보의 이용 및 보호에 관한 법률",
    article: "제31조·제32조",
    url: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1025128075",
  },
  ecommerce: {
    law: "전자상거래 등에서의 소비자보호에 관한 법률",
    article: "제6조",
    url: "https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031806291",
  },
  ai: {
    law: "인공지능 발전과 신뢰 기반 조성 등에 관한 기본법",
    article: "제31조",
    url: "https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031809547",
  },
} satisfies Record<string, LegalBasis>;

const labels: Record<Severity, string> = {
  high: "위반 소지",
  medium: "그레이존",
  low: "확인 필요",
  pass: "확인됨",
  na: "비해당 추정",
};

function matches(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function excerpt(text: string, patterns: RegExp[], radius = 78) {
  for (const pattern of patterns) {
    const flags = pattern.flags.replace("g", "");
    const found = new RegExp(pattern.source, flags).exec(text);
    if (!found || found.index === undefined) continue;
    const start = Math.max(0, found.index - radius);
    const end = Math.min(text.length, found.index + found[0].length + radius);
    return text
      .slice(start, end)
      .replace(/\s+/g, " ")
      .replace(/^[,.;:\s]+|[,.;:\s]+$/g, "");
  }
  return undefined;
}

export function analyzePrivacyPolicy(
  rawText: string,
  meta: {
    sourceUrl?: string;
    policyUrl?: string;
    policyTitle?: string;
    retrievedAt?: string;
  } = {},
) {
  const text = rawText
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const compact = text.replace(/\s+/g, " ");
  const findings: Finding[] = [];
  const coverage: CoverageItem[] = [];
  const signals: string[] = [];

  const add = (
    finding: Omit<
      Finding,
      "label" | "findingType" | "requiresFactualVerification"
    > & {
      label?: string;
      findingType?: FindingType;
      requiresFactualVerification?: boolean;
    },
  ) => {
    const findingType =
      finding.findingType ??
      (finding.severity === "pass"
        ? "confirmed_disclosure"
        : finding.severity === "medium"
          ? "ambiguity_or_inconsistency"
          : finding.severity === "low"
            ? "factual_verification"
            : "possible_missing_disclosure");

    findings.push({
      ...finding,
      label: finding.label ?? labels[finding.severity],
      findingType,
      requiresFactualVerification:
        finding.requiresFactualVerification ??
        (findingType === "factual_verification" ||
          finding.confidence === "낮음"),
    });
  };

  const addCoverage = (
    label: string,
    state: CoverageItem["state"],
    detail: string,
  ) => coverage.push({ label, state, detail });

  const purposePatterns = [
    /처리\s*목적/i,
    /수집[·ㆍ\s]*이용\s*목적/i,
    /이용\s*목적/i,
    /purposes?\s+(?:of|for)\s+(?:processing|collection)/i,
  ];
  const itemPatterns = [
    /수집(?:하는|하려는)?\s*개인정보(?:의)?\s*(?:항목|종류)/i,
    /처리(?:하는)?\s*개인정보(?:의)?\s*(?:항목|종류)/i,
    /개인정보\s*항목/i,
    /personal\s+(?:data|information)\s+(?:we\s+)?collect/i,
  ];
  const retentionPatterns = [
    /보유[·ㆍ\s]*(?:및\s*)?(?:이용\s*)?기간/i,
    /처리\s*및\s*보유\s*기간/i,
    /보관\s*기간/i,
    /retention\s+period/i,
    /how\s+long\s+we\s+(?:keep|retain)/i,
  ];
  const deletionPatterns = [
    /파기\s*(?:절차|방법)/i,
    /복구\s*또는\s*재생/i,
    /분쇄|소각|영구\s*삭제/i,
    /destruction|securely\s+delete/i,
  ];
  const rightsPatterns = [
    /정보주체(?:와\s*법정대리인)?의?\s*권리/i,
    /열람.*정정.*삭제/i,
    /처리\s*정지|동의\s*철회/i,
    /access.*correct.*delet/i,
  ];
  const contactPatterns = [
    /개인정보\s*보호\s*책임자/i,
    /개인정보\s*보호\s*담당/i,
    /고충\s*처리\s*부서/i,
    /data\s+protection\s+officer/i,
    /privacy\s+(?:team|officer|contact)/i,
  ];
  const contactDetailPatterns = [
    /(?:02|031|032|033|041|042|043|044|051|052|053|054|055|061|062|063|064|070|080|010)[-\s)]*\d{3,4}[-\s]*\d{4}/,
    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/,
    /전화(?:번호)?\s*[:：]/i,
    /이메일\s*[:：]/i,
  ];
  const securityPatterns = [
    /안전성\s*확보\s*조치/i,
    /기술적[·ㆍ\s]*관리적[·ㆍ\s]*(?:및\s*)?물리적\s*조치/i,
    /접근\s*권한|접속\s*기록|암호화/i,
    /security\s+measures?/i,
  ];

  const coreChecks = [
    {
      id: "purpose",
      category: "필수 공개항목",
      title: "개인정보 처리 목적",
      patterns: purposePatterns,
      recommendation:
        "업무·서비스 단위로 처리 목적을 구체화하고, 포괄적인 ‘서비스 개선 등’만으로 끝내지 마세요.",
      basis: [SOURCES.pipa30],
    },
    {
      id: "items",
      category: "필수 공개항목",
      title: "처리하는 개인정보 항목",
      patterns: itemPatterns,
      recommendation:
        "회원·비회원·자동수집 등 처리 맥락별로 실제 항목을 적고, 특별한 사정이 없다면 ‘등’으로 뭉뚱그리지 마세요.",
      basis: [SOURCES.decree31],
    },
    {
      id: "retention",
      category: "필수 공개항목",
      title: "처리 및 보유 기간",
      patterns: retentionPatterns,
      recommendation:
        "각 목적·항목별 기간을 숫자나 종료 사건으로 특정하고, 법정 보존은 법령명·기록 항목·기간을 함께 적으세요.",
      basis: [SOURCES.pipa30],
    },
    {
      id: "deletion",
      category: "필수 공개항목",
      title: "파기 절차와 방법",
      patterns: deletionPatterns,
      recommendation:
        "보유기간 종료 후 파기 시점, 승인 절차, 전자파일의 복구 불가능한 삭제와 종이문서의 분쇄·소각 방법을 적으세요.",
      basis: [SOURCES.pipa21, SOURCES.pipa30],
    },
    {
      id: "rights",
      category: "정보주체 권리",
      title: "권리·의무 및 행사 방법",
      patterns: rightsPatterns,
      recommendation:
        "열람, 정정·삭제, 처리정지, 동의철회 방법과 접수 채널, 대리 행사 방법을 실제 이용 가능한 절차로 안내하세요.",
      basis: [SOURCES.pipa30, SOURCES.rights],
    },
    {
      id: "contact",
      category: "책임과 문의",
      title: "보호책임자 또는 고충처리 연락처",
      patterns: contactPatterns,
      recommendation:
        "개인정보 보호책임자 성명 또는 고충처리 부서명과 전화번호·이메일 등 실제 연락처를 함께 적으세요.",
      basis: [SOURCES.pipa30],
    },
    {
      id: "security",
      category: "안전조치",
      title: "개인정보 안전성 확보조치",
      patterns: securityPatterns,
      recommendation:
        "접근권한 관리, 접근통제, 암호화, 접속기록, 악성프로그램 방지, 물리적 보호조치 중 실제 시행하는 조치를 설명하세요.",
      basis: [SOURCES.pipa29, SOURCES.decree31],
    },
  ];

  for (const check of coreChecks) {
    const present = matches(compact, check.patterns);
    const isContactWeak =
      check.id === "contact" &&
      present &&
      !matches(compact, contactDetailPatterns);

    if (!present) {
      add({
        id: `missing-${check.id}`,
        category: check.category,
        title: `${check.title}이 보이지 않습니다`,
        severity: check.id === "security" ? "medium" : "high",
        summary:
          "법정 필수 공개항목으로 볼 수 있는 명확한 문구를 추출 원문에서 찾지 못했습니다. 표·이미지 안에만 있거나 추출이 누락됐을 가능성도 확인해야 합니다.",
        recommendation: check.recommendation,
        legalBasis: check.basis,
        confidence: "높음",
      });
      addCoverage(check.title, "missing", "명확한 공개 문구를 찾지 못함");
    } else if (isContactWeak) {
      add({
        id: "weak-contact",
        category: check.category,
        title: "문의 주체는 있으나 직접 연락처가 불명확합니다",
        severity: "medium",
        summary:
          "‘고객센터’ 또는 담당 부서는 언급되지만 전화번호·이메일 등 즉시 이용 가능한 연락처가 함께 확인되지 않았습니다.",
        evidence: excerpt(compact, check.patterns),
        recommendation: check.recommendation,
        legalBasis: check.basis,
        confidence: "보통",
      });
      addCoverage(check.title, "conditional", "연락 채널의 구체성 확인 필요");
    } else {
      add({
        id: `present-${check.id}`,
        category: check.category,
        title: `${check.title}이 확인됩니다`,
        severity: "pass",
        summary:
          "관련 제목 또는 설명을 찾았습니다. 실제 처리 현황과 일치하는지는 내부 데이터 흐름도와 별도로 대조해야 합니다.",
        evidence: excerpt(compact, check.patterns),
        recommendation: "현재 문구와 실제 운영이 계속 일치하도록 정기 점검하세요.",
        legalBasis: check.basis,
        confidence: "높음",
      });
      addCoverage(check.title, "present", "관련 문구 확인");
    }
  }

  const vaguePurposePatterns = [
    /서비스\s*(?:품질\s*)?개선(?:\s*등)?/i,
    /회사가\s*필요하다고\s*판단/i,
    /기타\s*필요한\s*목적/i,
    /제반\s*업무/i,
    /필요한\s*범위(?:에서|로)/i,
    /향후\s*개발되는\s*서비스/i,
    /and\s+other\s+purposes/i,
  ];
  if (matches(compact, vaguePurposePatterns)) {
    add({
      id: "vague-purpose",
      category: "처리 적법성",
      title: "처리 목적이 넓게 열려 있습니다",
      severity: "medium",
      summary:
        "‘서비스 개선 등’이나 회사 판단에 따른 목적은 처리 범위를 예측하기 어렵게 만들어 목적 명확성·최소수집 원칙과 충돌할 여지가 있습니다.",
      evidence: excerpt(compact, vaguePurposePatterns),
      recommendation:
        "분석, 추천, 장애 대응, 부정이용 방지처럼 실제 목적을 나누고 각 목적에 필요한 항목과 적법 근거를 연결하세요.",
      legalBasis: [SOURCES.pipa15, SOURCES.pipa30],
      confidence: "보통",
    });
  }

  const vagueRetentionPatterns = [
    /관계\s*법령에\s*따라(?:\s*필요한\s*경우)?(?:\s*계속)?\s*보(?:유|관)/i,
    /필요한\s*기간\s*동안/i,
    /목적\s*달성\s*시까지/i,
    /합리적인\s*기간/i,
    /as\s+long\s+as\s+necessary/i,
  ];
  if (matches(compact, vagueRetentionPatterns)) {
    add({
      id: "vague-retention",
      category: "보유·파기",
      title: "보유기간의 끝을 판단하기 어렵습니다",
      severity: "medium",
      summary:
        "법령명·기록 종류·기간 없이 ‘관계 법령’ 또는 ‘필요한 기간’만 기재하면 정보주체가 실제 삭제 시점을 알기 어렵습니다.",
      evidence: excerpt(compact, vagueRetentionPatterns),
      recommendation:
        "처리 목적별 기본 기간을 특정하고, 예외 보존은 근거 법령과 기록명, 3년·5년 등 정확한 기간을 표로 구분하세요.",
      legalBasis: [SOURCES.pipa21, SOURCES.pipa30],
      confidence: "높음",
    });
  }

  const noThirdPartyPatterns = [
    /제3자에게\s*(?:제공하지|공유하지)\s*않/i,
    /제3자\s*제공\s*(?:없음|해당\s*없음)/i,
  ];
  const affirmativeThirdPartyPatterns = [
    /제공받는\s*자/i,
    /개인정보를\s*(?:제3자|제휴사|협력사)[^.\n]{0,35}\s*제공/i,
    /(?:제휴사|협력사|파트너사)(?:\s*등)?(?:에게|에)\s*제공/i,
    /share\s+(?:your\s+)?personal/i,
  ];
  const thirdPartySignals = [
    /제3자\s*제공/i,
    ...affirmativeThirdPartyPatterns,
  ];
  const thirdParty = matches(compact, thirdPartySignals);
  const noThirdParty = matches(compact, noThirdPartyPatterns);
  const affirmativeThirdParty = matches(
    compact,
    affirmativeThirdPartyPatterns,
  );

  if (noThirdParty && affirmativeThirdParty) {
    add({
      id: "third-party-inconsistency",
      category: "문단 간 불일치",
      title: "제3자 제공 여부가 서로 다르게 읽힙니다",
      severity: "medium",
      summary:
        "제3자에게 제공하지 않는다는 문구와 제공받는 자·제휴사 제공 정황이 함께 발견됐습니다. 예외 제공인지, 위탁인지, 서로 다른 서비스에 관한 내용인지 문단만으로 구분하기 어렵습니다.",
      evidence: excerpt(compact, [
        ...noThirdPartyPatterns,
        ...affirmativeThirdPartyPatterns,
      ]),
      recommendation:
        "‘원칙적 미제공’의 예외를 제공받는 자·목적·항목·기간별로 분리하고, 처리위탁과 제3자 제공을 명확히 구분하세요.",
      legalBasis: [SOURCES.pipa17, SOURCES.pipa26, SOURCES.pipa30],
      confidence: "보통",
      findingType: "ambiguity_or_inconsistency",
      requiresFactualVerification: true,
    });
  }

  const vagueThirdPartyPatterns = [
    /필요한\s*범위(?:에서|로)[^.\n]{0,45}(?:제3자|제휴사|협력사)[^.\n]{0,20}제공/i,
    /(?:제휴사|협력사|파트너사)\s*등(?:에게|에)?\s*제공/i,
    /사업상\s*필요(?:한\s*경우)?[^.\n]{0,35}제공/i,
    /필요하다고\s*판단(?:하는)?\s*경우[^.\n]{0,50}(?:제휴사|협력사|제3자)[^.\n]{0,35}제공/i,
  ];
  if (matches(compact, vagueThirdPartyPatterns)) {
    add({
      id: "vague-third-party",
      category: "제3자 제공",
      title: "제공 대상과 범위가 포괄적으로 표현돼 있습니다",
      severity: "medium",
      summary:
        "‘필요한 범위’, ‘제휴사 등’만으로는 정보주체가 누구에게 어떤 정보가 넘어가는지 예측하기 어렵습니다.",
      evidence: excerpt(compact, vagueThirdPartyPatterns),
      recommendation:
        "제공받는 자를 실제 법인명으로 특정하고, 각 제공 목적·항목·보유기간을 행 단위로 대응시키세요.",
      legalBasis: [SOURCES.pipa17, SOURCES.pipa30],
      confidence: "높음",
      findingType: "ambiguity_or_inconsistency",
    });
  }

  if (noThirdParty) {
    addCoverage("제3자 제공", "present", "제공하지 않는다는 문구 확인");
  } else if (thirdParty) {
    signals.push("제3자 제공");
    const thirdFields = [
      /제공받는\s*자|수령인|recipient/i,
      /제공\s*목적|이용\s*목적/i,
      /제공(?:하는)?\s*개인정보\s*항목|제공\s*항목/i,
      /보유\s*및\s*이용\s*기간|보유\s*기간/i,
    ];
    const found = thirdFields.filter((pattern) => pattern.test(compact)).length;
    if (found < 4) {
      add({
        id: "third-party-fields",
        category: "제3자 제공",
        title: "제3자 제공 고지의 핵심 정보가 덜 보입니다",
        severity: found <= 1 ? "high" : "medium",
        summary: `제공받는 자·목적·항목·보유기간 중 ${found}개 범주만 명확히 감지했습니다. 동의 화면과 방침의 실제 표를 함께 확인해야 합니다.`,
        evidence: excerpt(compact, thirdPartySignals),
        recommendation:
          "제공받는 자, 제공 목적, 항목, 보유·이용기간, 동의 거부권과 불이익을 하나의 표에서 비교 가능하게 적으세요.",
        legalBasis: [SOURCES.pipa17, SOURCES.pipa30],
        confidence: "보통",
      });
      addCoverage("제3자 제공", "conditional", `${found}/4 핵심 범주 감지`);
    } else {
      addCoverage("제3자 제공", "present", "핵심 범주 4개 감지");
    }
  } else {
    addCoverage("제3자 제공", "na", "제공 정황을 찾지 못함");
  }

  const noOutsourcePatterns = [
    /개인정보\s*처리\s*업무를\s*위탁하지\s*않/i,
    /처리\s*업무를\s*위탁하지\s*않/i,
    /처리\s*위탁\s*(?:없음|해당\s*없음)/i,
  ];
  const outsourcePatterns = [
    /처리\s*위탁/i,
    /수탁자/i,
    /위탁\s*업무/i,
    /service\s+provider/i,
    /processor/i,
  ];
  const outsourced = matches(compact, outsourcePatterns);
  const affirmativeOutsourcePatterns = [
    /(?:외부|전문|협력)?\s*업체[^.\n]{0,30}위탁/i,
    /수탁자|수탁업체|위탁받는\s*자/i,
    /위탁\s*업무(?:의)?\s*(?:내용|목적)/i,
  ];
  const noOutsource = matches(compact, noOutsourcePatterns);

  if (noOutsource && matches(compact, affirmativeOutsourcePatterns)) {
    add({
      id: "outsourcing-inconsistency",
      category: "문단 간 불일치",
      title: "처리위탁 여부가 서로 다르게 읽힙니다",
      severity: "medium",
      summary:
        "처리업무를 위탁하지 않는다는 문구와 수탁자·외부업체 위탁 정황이 함께 발견됐습니다. 문서 버전 또는 서비스별 범위를 확인해야 합니다.",
      evidence: excerpt(compact, [
        ...noOutsourcePatterns,
        ...affirmativeOutsourcePatterns,
      ]),
      recommendation:
        "위탁이 없는 서비스와 위탁이 있는 서비스를 구분하고, 현재 수탁자와 위탁업무를 최신 상태로 공개하세요.",
      legalBasis: [SOURCES.pipa26, SOURCES.pipa30],
      confidence: "보통",
      findingType: "ambiguity_or_inconsistency",
      requiresFactualVerification: true,
    });
  }

  if (noOutsource) {
    addCoverage("처리위탁", "present", "위탁하지 않는다는 문구 확인");
  } else if (outsourced) {
    signals.push("처리위탁");
    const hasVendor = matches(compact, [
      /수탁자(?:의)?\s*(?:명|업체|회사)/i,
      /위탁받는\s*자/i,
      /수탁업체/i,
      /service\s+providers?\s*[:：]/i,
    ]);
    const hasTask = matches(compact, [
      /위탁\s*업무(?:의)?\s*(?:내용|목적)/i,
      /위탁하는\s*업무/i,
      /업무\s*내용/i,
    ]);
    if (!hasVendor || !hasTask) {
      add({
        id: "outsourcing-detail",
        category: "처리위탁",
        title: "수탁자 또는 위탁업무가 구체적이지 않습니다",
        severity: "medium",
        summary:
          "위탁 정황은 있지만 정보주체가 수탁자와 위탁업무의 내용을 언제든지 쉽게 확인하기에 충분한지는 의문입니다.",
        evidence: excerpt(compact, outsourcePatterns),
        recommendation:
          "수탁자(재수탁자 포함)의 정확한 명칭과 위탁업무를 공개하고, 변경 시 공개 방식도 함께 운영하세요.",
        legalBasis: [SOURCES.pipa26, SOURCES.pipa30],
        confidence: "보통",
      });
      addCoverage("처리위탁", "conditional", "수탁자·업무 구체성 확인 필요");
    } else {
      addCoverage("처리위탁", "present", "수탁자와 위탁업무 문구 감지");
    }
  } else {
    addCoverage("처리위탁", "na", "위탁 정황을 찾지 못함");
  }

  const overseasPatterns = [
    /국외\s*이전/i,
    /해외\s*(?:이전|보관|서버|클라우드)/i,
    /개인정보를\s*국외/i,
    /(?:미국|일본|싱가포르|아일랜드|독일|호주)\s*(?:리전|서버|데이터센터|센터)?/i,
    /international\s+(?:data\s+)?transfer/i,
    /transfer.*(?:outside|overseas)/i,
  ];
  const overseas = matches(compact, overseasPatterns);
  if (overseas) {
    signals.push("국외 이전");
    const fields = [
      /이전받는\s*자|수신자|recipient/i,
      /이전되는\s*(?:국가|개인정보\s*항목)|국가명/i,
      /이전\s*(?:일시|방법)/i,
      /이전\s*목적/i,
      /보유[·ㆍ\s]*(?:및\s*)?이용\s*기간|보유\s*기간/i,
      /국외\s*이전\s*(?:근거|동의)|제28조의8/i,
    ];
    const found = fields.filter((pattern) => pattern.test(compact)).length;
    if (found < 6) {
      add({
        id: "overseas-transfer",
        category: "국외 이전",
        title: "국외 이전 법정 고지사항이 충분하지 않을 수 있습니다",
        severity: found <= 2 ? "high" : "medium",
        summary: `국외 이전 근거와 수령인·국가·항목·목적·시기/방법·기간 중 ${found}개 범주를 감지했습니다. 해외 클라우드 보관도 국외 이전에 포함될 수 있습니다.`,
        evidence: excerpt(compact, overseasPatterns),
        recommendation:
          "국외 이전의 법적 근거, 이전받는 자와 국가, 항목, 목적, 일시·방법, 보유·이용기간, 거부 방법과 효과를 구체적으로 공개하세요.",
        legalBasis: [SOURCES.pipa28, SOURCES.decree31],
        confidence: "높음",
      });
      addCoverage("국외 이전", "conditional", `${found}/6 핵심 범주 감지`);
    } else {
      addCoverage("국외 이전", "present", "핵심 고지 범주 감지");
    }
  } else {
    addCoverage("국외 이전", "na", "국외 이전 정황을 찾지 못함");
  }

  const cookiePatterns = [
    /쿠키/i,
    /행태정보/i,
    /광고\s*식별자/i,
    /접속\s*기록/i,
    /웹\s*비콘/i,
    /cookie|tracking\s+technolog|advertising\s+id/i,
  ];
  const cookie = matches(compact, cookiePatterns);
  if (cookie) {
    signals.push("자동수집·행태정보");
    const refusal = matches(compact, [
      /거부\s*(?:방법|권리|설정)/i,
      /차단\s*(?:방법|설정)/i,
      /쿠키\s*(?:삭제|허용|설정)/i,
      /opt[\s-]?out|disable\s+cookies/i,
    ]);
    if (!refusal) {
      add({
        id: "cookie-refusal",
        category: "자동수집·행태정보",
        title: "쿠키·행태정보 거부 방법이 불명확합니다",
        severity: "medium",
        summary:
          "자동수집 장치는 언급되지만 정보주체가 브라우저·앱에서 수집을 거부하거나 삭제하는 구체적인 방법을 찾지 못했습니다.",
        evidence: excerpt(compact, cookiePatterns),
        recommendation:
          "수집 항목·방법·목적·보유기간과 함께 주요 브라우저/앱의 쿠키·맞춤형 광고 차단 경로를 실제 메뉴 기준으로 안내하세요.",
        legalBasis: [SOURCES.pipa30],
        confidence: "높음",
      });
      addCoverage("자동수집 장치", "conditional", "거부 방법 확인 필요");
    } else {
      addCoverage("자동수집 장치", "present", "거부·차단 문구 감지");
    }
  } else {
    addCoverage("자동수집 장치", "na", "자동수집 정황을 찾지 못함");
  }

  const sensitivePatterns = [
    /민감정보/i,
    /건강정보|진료정보|질병|장애정보|유전정보|범죄경력|생체정보/i,
    /정치적\s*견해|노동조합|성생활/i,
    /sensitive\s+(?:personal\s+)?(?:data|information)|health\s+data/i,
  ];
  if (matches(compact, sensitivePatterns)) {
    signals.push("민감정보");
    const separateBasis = matches(compact, [
      /별도(?:로)?\s*동의/i,
      /민감정보.*법령/i,
      /법령에서.*민감정보/i,
      /explicit\s+consent/i,
    ]);
    if (!separateBasis) {
      add({
        id: "sensitive-basis",
        category: "민감정보",
        title: "민감정보 처리의 별도 근거가 불명확합니다",
        severity: "high",
        summary:
          "건강·생체·범죄경력 등 민감정보 정황은 있지만 다른 개인정보와 구분된 동의 또는 구체적인 법령 근거를 찾지 못했습니다.",
        evidence: excerpt(compact, sensitivePatterns),
        recommendation:
          "민감정보 항목을 특정하고 별도 동의 또는 구체적 법령 근거를 표시하세요. 서비스 중 공개될 수 있다면 비공개 선택 방법도 사전에 안내하세요.",
        legalBasis: [SOURCES.pipa23, SOURCES.pipa30],
        confidence: "보통",
      });
    }
  }

  const uniquePatterns = [
    /주민등록번호|여권번호|운전면허번호|외국인등록번호/i,
    /고유식별정보/i,
  ];
  if (matches(compact, uniquePatterns)) {
    signals.push("고유식별정보");
    const legalBasis = matches(compact, [
      /별도(?:로)?\s*동의/i,
      /법령(?:에서|에\s*따라|상)/i,
      /법률\s*제\d+조/i,
    ]);
    if (!legalBasis) {
      add({
        id: "unique-id",
        category: "고유식별정보",
        title: "고유식별정보 처리 근거를 더 구체화해야 합니다",
        severity: "high",
        summary:
          "고유식별정보는 별도 동의나 구체적인 법령상 허용 근거가 필요하고, 주민등록번호는 더 엄격한 법정 근거가 요구될 수 있습니다.",
        evidence: excerpt(compact, uniquePatterns),
        recommendation:
          "처리하는 식별번호와 별도 동의 여부를 밝히고, 주민등록번호라면 허용하는 법률·시행령의 정확한 조문을 적으세요.",
        legalBasis: [SOURCES.pipa24],
        confidence: "보통",
      });
    }
  }

  const childPatterns = [
    /만\s*14세\s*미만/i,
    /아동|어린이|법정대리인/i,
    /children|child|parental\s+consent/i,
  ];
  if (matches(compact, childPatterns)) {
    signals.push("아동 개인정보");
    const guardian = matches(compact, [
      /법정대리인(?:의)?\s*동의/i,
      /보호자(?:의)?\s*동의/i,
      /parental\s+consent/i,
    ]);
    const verify = matches(compact, [
      /동의(?:하였는지|여부를)\s*확인/i,
      /본인\s*확인/i,
      /verify.*consent/i,
    ]);
    if (!guardian || !verify) {
      add({
        id: "children",
        category: "아동 개인정보",
        title: "법정대리인 동의·확인 절차가 충분히 보이지 않습니다",
        severity: "high",
        summary:
          "만 14세 미만 아동 관련 정황은 있으나 법정대리인 동의와 그 동의 여부를 확인하는 절차를 모두 찾지 못했습니다.",
        evidence: excerpt(compact, childPatterns),
        recommendation:
          "법정대리인 동의·확인 방법, 최소 수집정보, 아동이 이해하기 쉬운 안내 방식을 별도 절로 구체화하세요.",
        legalBasis: [SOURCES.pipa22],
        confidence: "높음",
      });
    }
  }

  const pseudonymPatterns = [/가명정보|가명처리|pseudonymi[sz]ed/i];
  if (matches(compact, pseudonymPatterns)) {
    signals.push("가명정보");
    const detail = matches(compact, [
      /가명정보.*(?:목적|항목|보유\s*기간|안전성\s*확보)/i,
    ]);
    if (!detail) {
      add({
        id: "pseudonym",
        category: "가명정보",
        title: "가명정보 처리 내용이 충분히 구체적이지 않습니다",
        severity: "medium",
        summary:
          "가명처리 정황은 있으나 목적·항목·보유기간·안전성 확보조치가 서로 연결되어 설명되는지 확인이 필요합니다.",
        evidence: excerpt(compact, pseudonymPatterns),
        recommendation:
          "가명정보의 처리 목적, 항목, 보유기간, 제3자 제공 여부와 안전성 확보조치를 별도 표로 공개하세요.",
        legalBasis: [SOURCES.pipa30],
        confidence: "보통",
      });
    }
  }

  const automatedPatterns = [
    /자동화된\s*결정/i,
    /프로파일링/i,
    /인공지능|생성형\s*AI|AI\s*(?:모델|서비스|추천)/i,
    /automated\s+decision|profiling|artificial\s+intelligence/i,
  ];
  if (matches(compact, automatedPatterns)) {
    signals.push("AI·자동화 처리");
    const rights = matches(compact, [
      /자동화된\s*결정.*(?:거부|설명)/i,
      /인적\s*개입|재처리/i,
      /human\s+review|right\s+to\s+(?:object|explanation)/i,
    ]);
    if (!rights) {
      add({
        id: "automated-decision",
        category: "AI·자동화 결정",
        title: "자동화된 결정의 기준과 권리 안내를 확인하세요",
        severity: "medium",
        summary:
          "AI·프로파일링 정황이 감지됐습니다. 권리·의무에 중대한 영향을 미치는 완전 자동화 결정이라면 거부·설명 요구와 인적 개입 절차가 필요할 수 있습니다.",
        evidence: excerpt(compact, automatedPatterns),
        recommendation:
          "자동화 결정의 기준·절차, 사용 개인정보, 결과가 미치는 영향, 거부·설명 요구 방법과 인적 재검토 절차를 공개하세요. 생성형 AI 제공 사업자는 AI기본법상 사전고지도 별도 확인하세요.",
        legalBasis: [SOURCES.automated, SOURCES.ai],
        confidence: "낮음",
      });
    }
  }

  const locationPatterns = [
    /개인위치정보|정밀\s*위치|GPS|위치기반\s*서비스|실시간\s*위치/i,
    /geolocation|precise\s+location/i,
  ];
  if (matches(compact, locationPatterns)) {
    signals.push("개인위치정보");
    add({
      id: "location-sector",
      category: "분야별 추가법",
      title: "위치정보법상 별도 약관·동의도 함께 확인해야 합니다",
      severity: "low",
      summary:
        "개인위치정보 처리는 개인정보처리방침만으로 준수 여부를 확정하기 어렵습니다. 위치정보 이용약관, 동의 화면, 제공 통보가 별도로 필요할 수 있습니다.",
      evidence: excerpt(compact, locationPatterns),
      recommendation:
        "수집·이용 목적과 기간, 확인자료 보유기간, 권리 행사, 제3자 제공 및 매회 통보 절차를 위치정보 이용약관과 동의 화면에서 교차검증하세요.",
      legalBasis: [SOURCES.location],
      confidence: "높음",
    });
  }

  const creditPatterns = [
    /개인신용정보|신용평점|신용평가|대출정보|연체정보/i,
    /credit\s+(?:information|score|rating)/i,
  ];
  if (matches(compact, creditPatterns)) {
    signals.push("개인신용정보");
    add({
      id: "credit-sector",
      category: "분야별 추가법",
      title: "신용정보법상 공시·개별 동의 체계를 확인하세요",
      severity: "low",
      summary:
        "개인신용정보는 개인정보 보호법 외에 신용정보활용체제 공시와 제공 시 개별 동의 등 별도 규율이 적용될 수 있습니다.",
      evidence: excerpt(compact, creditPatterns),
      recommendation:
        "신용정보활용체제 공시, 필수·선택 동의 구분, 제공받는 자별 개별 동의와 조회 영향 고지를 별도 화면에서 점검하세요.",
      legalBasis: [SOURCES.credit],
      confidence: "보통",
    });
  }

  const ecommercePatterns = [
    /주문|배송|결제|청약철회|통신판매|전자상거래/i,
    /order|shipping|payment|e-?commerce/i,
  ];
  if (matches(compact, ecommercePatterns)) {
    signals.push("전자상거래");
    const statutoryPeriods =
      /계약.*5년|청약철회.*5년/i.test(compact) &&
      /대금결제.*5년|재화.*공급.*5년/i.test(compact) &&
      /불만.*3년|분쟁.*3년/i.test(compact);
    if (!statutoryPeriods) {
      add({
        id: "ecommerce-retention",
        category: "전자상거래",
        title: "거래기록의 법정 보존기간을 교차확인하세요",
        severity: "low",
        summary:
          "주문·결제·배송 정황이 있지만 전자상거래법상 기록별 6개월·3년·5년 기간을 충분히 특정했는지 자동 확인이 어려웠습니다.",
        evidence: excerpt(compact, ecommercePatterns),
        recommendation:
          "표시·광고 6개월, 계약·청약철회 5년, 대금결제·공급 5년, 소비자 불만·분쟁 3년을 실제 보유 항목과 연결하세요.",
        legalBasis: [SOURCES.ecommerce],
        confidence: "보통",
      });
    }
  }

  const versionPatterns = [
    /시행일/i,
    /적용일/i,
    /개정\s*일자/i,
    /변경\s*전.*변경\s*후/i,
    /effective\s+date|last\s+updated/i,
  ];
  if (!matches(compact, versionPatterns)) {
    add({
      id: "version-history",
      category: "공개·가독성",
      title: "시행일·변경 이력을 쉽게 확인하기 어렵습니다",
      severity: "low",
      summary:
        "정책 변경 시점을 알 수 있는 시행일, 이전 버전 또는 변경 전·후 비교 문구를 찾지 못했습니다. 이는 투명성 평가에서 불리할 수 있습니다.",
      recommendation:
        "문서 상단에 시행일과 최종 변경일을 표시하고, 이전 버전 링크와 주요 변경사항 비교표를 제공하세요.",
      legalBasis: [SOURCES.pipa30],
      confidence: "보통",
    });
  }

  const counts = findings.reduce(
    (acc, finding) => {
      if (finding.severity !== "na") acc[finding.severity] += 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0, pass: 0 },
  );

  const score = Math.max(
    0,
    Math.min(
      100,
      100 - counts.high * 12 - counts.medium * 6 - counts.low * 2,
    ),
  );
  const grade =
    score >= 88 && counts.high === 0
      ? "양호"
      : score >= 72 && counts.high <= 1
        ? "보완필요"
        : "긴급보완";
  const headline =
    grade === "양호"
      ? "큰 누락은 적지만 운영과의 일치 여부를 확인하세요"
      : grade === "보완필요"
        ? "몇 가지 핵심 문구를 더 구체화해야 합니다"
        : "법정 필수항목부터 우선 보완할 필요가 있습니다";

  return {
    sourceUrl: meta.sourceUrl,
    policyUrl: meta.policyUrl,
    policyTitle: meta.policyTitle || "개인정보처리방침 분석",
    retrievedAt: meta.retrievedAt || new Date().toISOString(),
    textLength: text.length,
    score,
    grade,
    counts,
    headline,
    findings,
    coverage,
    detectedSignals: [...new Set(signals)],
    policyExcerpt: text.slice(0, 12000),
    analysisEngine: {
      mode: "local_rules",
      name: "무료 규칙·휴리스틱 엔진",
      version: "KR-PRIVACY-2026.07",
      aiUsed: false,
      externalApiCalls: 0,
      estimatedApiCostKrw: 0,
      limitations: [
        "이미지·PDF 안의 표와 로그인 뒤 화면은 원문 붙여넣기 없이 확인할 수 없음",
        "실제 수집 항목, 쿠키 전송, 동의 화면, 파기 실행 여부는 현장 검증 필요",
        "문장의 의미를 통계적 AI가 해석하지 않으므로 새로운 표현은 탐지하지 못할 수 있음",
      ],
    },
    legalBaseline: {
      date: "2026-07-26",
      statutes: [
        {
          name: "개인정보 보호법",
          version: "시행 2025.10.02 · 법률 제20897호",
          url: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=270351",
        },
        {
          name: "개인정보 보호법 시행령",
          version: "시행 2026.05.19 · 대통령령 제36340호",
          url: "https://www.law.go.kr/LSW/lsSc.do?eventGubun=060101&menuId=1&query=%EA%B0%9C%EC%9D%B8%EC%A0%95%EB%B3%B4+%EB%B3%B4%ED%98%B8%EB%B2%95+%EC%8B%9C%ED%96%89%EB%A0%B9",
        },
        {
          name: "개인정보 처리방침 작성지침",
          version: "개인정보보호위원회 · 2026.04 개정",
          url: "https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=&nttId=12018",
        },
        {
          name: "개인정보의 안전성 확보조치 기준",
          version: "시행 2025.10.31 · 고시 제2025-9호",
          url: "https://www.law.go.kr/admRulStmdInfoP.do?admRulSeq=2100000265956",
        },
      ],
    },
  };
}
