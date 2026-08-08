import { LEGAL_BASELINE } from "./legal-baseline";

export type Severity = "high" | "medium" | "low" | "pass" | "na";

export type ContextKey =
  | "thirdParty"
  | "outsourcing"
  | "overseas"
  | "foreignController"
  | "children"
  | "cookies"
  | "ecommerce"
  | "ai"
  | "automatedDecision";
export type ContextChoice = "auto" | "yes" | "no";
export type ContextOverrides = Partial<Record<ContextKey, ContextChoice>>;

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
  state: "present" | "missing" | "conditional" | "unknown" | "na";
  detail: string;
};

type EvaluationAxis = {
  key: "appropriateness" | "readability" | "accessibility" | "consistency";
  label: string;
  state: "good" | "review" | "not_evaluated";
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
  automatedDecree: {
    law: "개인정보 보호법 시행령",
    article: "제44조의4",
    url: "https://law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1033216053",
  },
  pipcGuideline: {
    law: "개인정보보호위원회 작성지침",
    article: "2026 개인정보 처리방침 작성지침(권고)",
    url: "https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030020&nttId=12018",
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
  ecommerceDecree: {
    law: "전자상거래 등에서의 소비자보호에 관한 법률 시행령",
    article: "제6조",
    url: "https://law.go.kr/LSW/lumLsLinkPop.do?lspttninfSeq=63460",
  },
  ai: {
    law: "인공지능 발전과 신뢰 기반 조성 등에 관한 기본법",
    article: "제31조",
    url: "https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031809547",
  },
} satisfies Record<string, LegalBasis>;

const labels: Record<Severity, string> = {
  high: "누락 가능성 높음",
  medium: "불명확·보완",
  low: "사실 확인",
  pass: "문구 확인",
  na: "비해당 확인",
};

function matches(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function subjectParticle(value: string) {
  const last = value.charCodeAt(value.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "이";
  return (last - 0xac00) % 28 === 0 ? "가" : "이";
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

const headingPattern = /^(?:(?:제\s*)?\d+\s*(?:조|[.)])|[①-⑳]|[가-하]\s*[.)]|[■□●▶◆◇]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.)]?)/;

function sectionScope(text: string, patterns: RegExp[], maxChars = 2600) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 2) {
    const compact = text.replace(/\s+/g, " ");
    for (const pattern of patterns) {
      const flags = pattern.flags.replace("g", "");
      const found = new RegExp(pattern.source, flags).exec(compact);
      if (!found || found.index === undefined) continue;
      return compact.slice(
        Math.max(0, found.index - 180),
        Math.min(compact.length, found.index + maxChars),
      );
    }
    return "";
  }

  const scopes: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!matches(lines[index], patterns)) continue;
    const section = [lines[index]];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = lines[cursor];
      if (headingPattern.test(next)) break;
      section.push(next);
      if (section.join(" ").length >= maxChars) break;
    }
    scopes.push(section.join(" "));
  }
  return scopes.join(" ").slice(0, maxChars * 2);
}

function hasSubstantiveDisclosure(scope: string, patterns: RegExp[]) {
  if (!scope) return false;
  let remainder = scope;
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    remainder = remainder.replace(new RegExp(pattern.source, flags), " ");
  }
  return remainder.replace(/[\d①-⑳제조.)\s:：·ㆍ|\-_/]/g, "").length >= 8;
}

export function analyzePrivacyPolicy(
  rawText: string,
  meta: {
    sourceUrl?: string;
    policyUrl?: string;
    policyTitle?: string;
    retrievedAt?: string;
    discoveryPath?: string[];
    contextOverrides?: ContextOverrides;
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
  const contextChoice = (key: ContextKey) =>
    meta.contextOverrides?.[key] ?? "auto";
  // 본문에서 신호가 명확하면 사용자의 '비해당' 선택만으로 숨기지 않습니다.
  // '해당' 선택은 문서 누락을 찾기 위한 추가 사실관계로 사용합니다.
  const contextActive = (key: ContextKey, detected: boolean) =>
    detected || contextChoice(key) === "yes";
  const signalLabel = (label: string, detected: boolean) =>
    detected ? label : `${label} · 사용자 확인`;
  const addInactiveConditionalCoverage = (label: string, key: ContextKey) => {
    if (contextChoice(key) === "no") {
      addCoverage(label, "na", "사용자 입력에서 비해당으로 확인");
    } else {
      addCoverage(
        label,
        "unknown",
        "문서에서 적용 신호를 찾지 못함 · 실제 운영 여부 확인 필요",
      );
    }
  };

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
    const scope = sectionScope(text, check.patterns, 1600);
    const present =
      matches(compact, check.patterns) &&
      hasSubstantiveDisclosure(scope || compact, check.patterns);
    const isContactWeak =
      check.id === "contact" &&
      present &&
      !matches(scope || compact, contactDetailPatterns);
    const isDeletionWeak =
      check.id === "deletion" &&
      present &&
      !(
        matches(scope || compact, [
          /파기\s*절차|파기\s*승인|보유\s*기간[^.\n]{0,45}(?:종료|경과)[^.\n]{0,40}파기/i,
        ]) &&
        matches(scope || compact, [
          /복구\s*(?:또는|및)?\s*재생[^.\n]{0,25}(?:불가능|할\s*수\s*없)|영구\s*삭제|분쇄|소각/i,
        ])
      );
    const rightsScope = scope || compact;
    const rightKinds = [
      /열람/i,
      /정정|삭제/i,
      /처리\s*정지/i,
      /동의\s*철회/i,
    ].filter((pattern) => pattern.test(rightsScope)).length;
    const isRightsWeak =
      check.id === "rights" &&
      present &&
      (rightKinds < 2 ||
        !matches(rightsScope, [
          /요청|신청|접수|고객센터|온라인|이메일|전자우편|전화|방문/i,
        ]));
    const weakReason = isContactWeak
      ? {
          id: "weak-contact",
          title: "문의 주체는 있으나 직접 연락처가 불명확합니다",
          summary:
            "‘고객센터’ 또는 담당 부서는 언급되지만 전화번호·이메일 등 즉시 이용 가능한 연락처가 같은 섹션에서 확인되지 않았습니다.",
          detail: "연락 채널의 구체성 확인 필요",
        }
      : isDeletionWeak
        ? {
            id: "weak-deletion",
            title: "파기 절차와 방법 중 일부가 구체적이지 않습니다",
            summary:
              "파기 관련 문구는 있으나 파기 시점·절차와 복구 불가능한 전자파일 삭제 또는 종이문서 파기 방법을 모두 확인하지 못했습니다.",
            detail: "절차·방법을 모두 교차확인 필요",
          }
        : isRightsWeak
          ? {
              id: "weak-rights",
              title: "권리의 종류 또는 실제 행사 방법이 충분하지 않습니다",
              summary:
                "권리 관련 문구는 있으나 열람·정정삭제·처리정지·동의철회 중 필요한 권리와 실제 요청 채널이 함께 안내되는지 확인이 필요합니다.",
              detail: "권리 종류·접수 채널 확인 필요",
            }
          : null;

    if (!present) {
      add({
        id: `missing-${check.id}`,
        category: check.category,
        title: `${check.title}${subjectParticle(check.title)} 보이지 않습니다`,
        severity: check.id === "security" ? "medium" : "high",
        summary:
          "법정 필수 공개항목으로 볼 수 있는 명확한 문구를 추출 원문에서 찾지 못했습니다. 표·이미지 안에만 있거나 추출이 누락됐을 가능성도 확인해야 합니다.",
        recommendation: check.recommendation,
        legalBasis: check.basis,
        confidence: "높음",
      });
      addCoverage(check.title, "missing", "명확한 공개 문구를 찾지 못함");
    } else if (weakReason) {
      add({
        id: weakReason.id,
        category: check.category,
        title: weakReason.title,
        severity: "medium",
        summary: weakReason.summary,
        evidence: excerpt(scope || compact, check.patterns),
        recommendation: check.recommendation,
        legalBasis: check.basis,
        confidence: "보통",
      });
      addCoverage(check.title, "conditional", weakReason.detail);
    } else {
      add({
        id: `present-${check.id}`,
        category: check.category,
        title: `${check.title}이 확인됩니다`,
        severity: "pass",
        summary:
          "관련 제목 또는 설명을 찾았습니다. 실제 처리 현황과 일치하는지는 내부 데이터 흐름도와 별도로 대조해야 합니다.",
        evidence: excerpt(scope || compact, check.patterns),
        recommendation: "현재 문구와 실제 운영이 계속 일치하도록 정기 점검하세요.",
        legalBasis: check.basis,
        confidence: "높음",
      });
      addCoverage(check.title, "present", "관련 문구 확인");
    }
  }

  const vaguePurposePatterns = [
    /서비스\s*(?:품질\s*)?개선\s*(?:등|및\s*기타|기타)/i,
    /회사가\s*필요하다고\s*판단/i,
    /기타\s*필요한\s*목적/i,
    /제반\s*업무/i,
    /(?:목적|이용)[^.\n]{0,35}필요한\s*범위(?:에서|로)/i,
    /향후\s*개발되는\s*서비스/i,
    /and\s+other\s+purposes/i,
  ];
  const purposeScope = sectionScope(text, purposePatterns, 1800) || compact;
  if (matches(purposeScope, vaguePurposePatterns)) {
    add({
      id: "vague-purpose",
      category: "처리 적법성",
      title: "처리 목적이 넓게 열려 있습니다",
      severity: "medium",
      summary:
        "‘서비스 개선 등’이나 회사 판단에 따른 목적은 처리 범위를 예측하기 어렵게 만들어 목적 명확성·최소수집 원칙과 충돌할 여지가 있습니다.",
      evidence: excerpt(purposeScope, vaguePurposePatterns),
      recommendation:
        "분석, 추천, 장애 대응, 부정이용 방지처럼 실제 목적을 나누고 각 목적에 필요한 항목과 적법 근거를 연결하세요.",
      legalBasis: [SOURCES.pipa15, SOURCES.pipa30],
      confidence: "보통",
    });
  }

  const genericLawRetentionPatterns = [
    /관계\s*법령에\s*따라(?:\s*필요한\s*경우)?(?:\s*계속)?\s*보(?:유|관)/i,
  ];
  const openEndedRetentionPatterns = [
    /필요한\s*기간\s*동안/i,
    /합리적인\s*기간/i,
    /as\s+long\s+as\s+necessary/i,
  ];
  const retentionScope = sectionScope(text, retentionPatterns, 2200) || compact;
  const genericLawMatch = genericLawRetentionPatterns
    .map((pattern) => new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(retentionScope))
    .find(Boolean);
  const genericLawHasNumberedPeriod = genericLawMatch
    ? /\d+\s*(?:일|개월|년)/i.test(
        retentionScope.slice(
          genericLawMatch.index,
          genericLawMatch.index + genericLawMatch[0].length + 100,
        ),
      )
    : false;
  const vagueRetention =
    matches(retentionScope, openEndedRetentionPatterns) ||
    (Boolean(genericLawMatch) && !genericLawHasNumberedPeriod);
  const vagueRetentionPatterns = [
    ...genericLawRetentionPatterns,
    ...openEndedRetentionPatterns,
  ];
  if (vagueRetention) {
    add({
      id: "vague-retention",
      category: "보유·파기",
      title: "보유기간의 끝을 판단하기 어렵습니다",
      severity: "medium",
      summary:
        "법령명·기록 종류·기간 없이 ‘관계 법령’ 또는 ‘필요한 기간’만 기재하면 정보주체가 실제 삭제 시점을 알기 어렵습니다.",
      evidence: excerpt(retentionScope, vagueRetentionPatterns),
      recommendation:
        "처리 목적별 기본 기간을 특정하고, 예외 보존은 근거 법령과 기록명, 3년·5년 등 정확한 기간을 표로 구분하세요.",
      legalBasis: [SOURCES.pipa21, SOURCES.pipa30],
      confidence: "높음",
    });
  }

  const noThirdPartyPatterns = [
    /제3자에게\s*(?:제공하지|공유하지)\s*않/i,
    /제3자\s*제공\s*(?:없음|해당\s*없음)/i,
    /do\s+not\s+(?:share|provide)[^.\n]{0,45}personal/i,
  ];
  const affirmativeThirdPartyPatterns = [
    /제공받는\s*자/i,
    /개인정보를\s*(?:제3자|제휴사|협력사)[^.\n]{0,35}\s*제공(?!하지|하지\s*않)/i,
    /(?:제휴사|협력사|파트너사)(?:\s*등)?(?:에게|에)?[^.\n]{0,30}\s*제공(?!하지|하지\s*않)/i,
    /(?<!not\s)share\s+(?:your\s+)?personal/i,
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
  const thirdPartyScope =
    sectionScope(text, thirdPartySignals, 2800) ||
    sectionScope(text, affirmativeThirdPartyPatterns, 2800) ||
    (thirdParty ? compact : "");
  const hasExpressThirdPartyException = matches(thirdPartyScope, [
    /다만|예외|동의(?:를|가)?\s*(?:받|한)|법령(?:에|에서)|수사기관|재난|생명|급박/i,
  ]);

  if (
    noThirdParty &&
    affirmativeThirdParty &&
    !hasExpressThirdPartyException
  ) {
    add({
      id: "third-party-inconsistency",
      category: "문단 간 불일치",
      title: "제3자 제공 여부가 서로 다르게 읽힙니다",
      severity: "medium",
      summary:
        "제3자에게 제공하지 않는다는 문구와 제공받는 자·제휴사 제공 정황이 함께 발견됐습니다. 예외 제공인지, 위탁인지, 서로 다른 서비스에 관한 내용인지 문단만으로 구분하기 어렵습니다.",
      evidence: excerpt(thirdPartyScope, [
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
    /(?:제휴사|협력사|파트너사)\s*등(?:에게|에)?[^.\n]{0,30}\s*제공/i,
    /사업상\s*필요(?:한\s*경우)?[^.\n]{0,35}제공/i,
    /필요하다고\s*판단(?:하는)?\s*경우[^.\n]{0,50}(?:제휴사|협력사|제3자)[^.\n]{0,35}제공/i,
  ];
  if (matches(thirdPartyScope, vagueThirdPartyPatterns)) {
    add({
      id: "vague-third-party",
      category: "제3자 제공",
      title: "제공 대상과 범위가 포괄적으로 표현돼 있습니다",
      severity: "medium",
      summary:
        "‘필요한 범위’, ‘제휴사 등’만으로는 정보주체가 누구에게 어떤 정보가 넘어가는지 예측하기 어렵습니다.",
      evidence: excerpt(thirdPartyScope, vagueThirdPartyPatterns),
      recommendation:
        "원칙적으로 제공받는 자를 실제 법인명으로 특정하세요. 대상이 대규모이거나 자주 바뀌면 허용되는 유형화 방식과 이용자가 실제 대상을 확인할 수 있는 구체적 경로를 함께 제공하세요.",
      legalBasis: [SOURCES.pipa17, SOURCES.pipa30],
      confidence: "높음",
      findingType: "ambiguity_or_inconsistency",
    });
  }

  if (
    noThirdParty &&
    contextChoice("thirdParty") === "yes" &&
    !affirmativeThirdParty
  ) {
    add({
      id: "third-party-context-conflict",
      category: "실제 운영 일치",
      title: "사용자 입력과 제3자 제공 문구가 서로 다릅니다",
      severity: "medium",
      summary:
        "사용자는 실제 제3자 제공이 있다고 표시했지만 처리방침에는 제공하지 않는다고 적혀 있습니다. 어느 정보가 최신인지 운영 담당자 확인이 필요합니다.",
      evidence: excerpt(thirdPartyScope, noThirdPartyPatterns),
      recommendation:
        "실제 제공 내역과 동의 화면을 확인하고, 제공이 있다면 처리방침의 제공받는 자·목적·항목·보유기간을 최신화하세요.",
      legalBasis: [SOURCES.pipa17, SOURCES.pipa30],
      confidence: "낮음",
      findingType: "factual_verification",
      requiresFactualVerification: true,
    });
    addCoverage("제3자 제공", "conditional", "사용자 입력과 미제공 문구가 충돌");
  } else if (noThirdParty && !affirmativeThirdParty) {
    addCoverage("제3자 제공", "present", "제공하지 않는다는 문구 확인");
  } else if (thirdParty || contextChoice("thirdParty") === "yes") {
    signals.push(signalLabel("제3자 제공", thirdParty));
    const thirdFields = [
      /제공받는\s*자|수령인|recipient/i,
      /제공\s*목적|이용\s*목적/i,
      /제공(?:하는)?\s*개인정보\s*항목|제공\s*항목/i,
      /보유\s*및\s*이용\s*기간|보유\s*기간/i,
    ];
    const found = thirdFields.filter((pattern) => pattern.test(thirdPartyScope)).length;
    if (found < 4) {
      add({
        id:
          contextChoice("thirdParty") === "yes" && !thirdParty
            ? "third-party-missing"
            : "third-party-fields",
        category: "제3자 제공",
        title:
          contextChoice("thirdParty") === "yes" && !thirdParty
            ? "실제 제3자 제공이 있다면 관련 공개사항이 보이지 않습니다"
            : "제3자 제공 고지의 핵심 정보가 덜 보입니다",
        severity: found <= 1 ? "high" : "medium",
        summary: `제공받는 자·목적·항목·보유기간 중 ${found}개 범주만 명확히 감지했습니다. 동의 화면과 방침의 실제 표를 함께 확인해야 합니다.`,
        evidence: excerpt(thirdPartyScope, thirdPartySignals),
        recommendation:
          "제공받는 자, 제공 목적, 항목, 보유·이용기간, 동의 거부권과 불이익을 하나의 표에서 비교 가능하게 적으세요.",
        legalBasis: [SOURCES.pipa17, SOURCES.pipa30],
        confidence: thirdParty ? "보통" : "낮음",
        requiresFactualVerification: !thirdParty,
      });
      addCoverage("제3자 제공", "conditional", `${found}/4 핵심 범주 감지`);
    } else {
      addCoverage("제3자 제공", "present", "핵심 범주 4개 감지");
    }
  } else {
    addInactiveConditionalCoverage("제3자 제공", "thirdParty");
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
  const outsourceScope =
    sectionScope(text, outsourcePatterns, 2600) || (outsourced ? compact : "");
  const hasExpressOutsourceException = matches(outsourceScope, [
    /다만|예외|일부\s*업무|다음과\s*같이/i,
  ]);

  if (
    noOutsource &&
    matches(compact, affirmativeOutsourcePatterns) &&
    !hasExpressOutsourceException
  ) {
    add({
      id: "outsourcing-inconsistency",
      category: "문단 간 불일치",
      title: "처리위탁 여부가 서로 다르게 읽힙니다",
      severity: "medium",
      summary:
        "처리업무를 위탁하지 않는다는 문구와 수탁자·외부업체 위탁 정황이 함께 발견됐습니다. 문서 버전 또는 서비스별 범위를 확인해야 합니다.",
      evidence: excerpt(outsourceScope, [
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

  const affirmativeOutsource = matches(compact, affirmativeOutsourcePatterns);
  if (
    noOutsource &&
    contextChoice("outsourcing") === "yes" &&
    !affirmativeOutsource
  ) {
    add({
      id: "outsourcing-context-conflict",
      category: "실제 운영 일치",
      title: "사용자 입력과 처리위탁 문구가 서로 다릅니다",
      severity: "medium",
      summary:
        "사용자는 실제 처리위탁이 있다고 표시했지만 처리방침에는 위탁하지 않는다고 적혀 있습니다. 수탁 계약과 운영 현황 확인이 필요합니다.",
      evidence: excerpt(outsourceScope, noOutsourcePatterns),
      recommendation:
        "현재 수탁자·재수탁자와 위탁업무를 확인하고 실제 위탁이 있다면 처리방침과 확인 경로를 최신화하세요.",
      legalBasis: [SOURCES.pipa26, SOURCES.pipa30],
      confidence: "낮음",
      findingType: "factual_verification",
      requiresFactualVerification: true,
    });
    addCoverage("처리위탁", "conditional", "사용자 입력과 미위탁 문구가 충돌");
  } else if (noOutsource && !affirmativeOutsource) {
    addCoverage("처리위탁", "present", "위탁하지 않는다는 문구 확인");
  } else if (outsourced || contextChoice("outsourcing") === "yes") {
    signals.push(signalLabel("처리위탁", outsourced));
    const hasNamedVendor = matches(outsourceScope, [
      /수탁자(?:의)?\s*(?:명|업체|회사)/i,
      /위탁받는\s*자/i,
      /수탁업체/i,
      /service\s+providers?\s*[:：]/i,
    ]);
    const hasTypedVendorWithLookup =
      matches(outsourceScope, [
        /(?:기사|배달원|판매자|가맹점|협력업체|수탁자)\s*(?:유형|목록|현황)/i,
      ]) &&
      matches(outsourceScope, [
        /(?:직접|상세|목록을?)\s*확인|확인\s*(?:경로|방법)|내\s*정보|이용\s*내역|https?:\/\//i,
      ]);
    const hasVendor = hasNamedVendor || hasTypedVendorWithLookup;
    const hasTask = matches(outsourceScope, [
      /위탁\s*업무(?:의)?\s*(?:내용|목적)/i,
      /위탁하는\s*업무/i,
      /업무\s*내용/i,
    ]);
    if (!hasVendor || !hasTask) {
      add({
        id:
          contextChoice("outsourcing") === "yes" && !outsourced
            ? "outsourcing-missing"
            : "outsourcing-detail",
        category: "처리위탁",
        title:
          contextChoice("outsourcing") === "yes" && !outsourced
            ? "실제 처리위탁이 있다면 관련 공개사항이 보이지 않습니다"
            : "수탁자 또는 위탁업무가 구체적이지 않습니다",
        severity: !outsourced ? "high" : "medium",
        summary:
          "위탁 정황은 있지만 정보주체가 수탁자와 위탁업무의 내용을 언제든지 쉽게 확인하기에 충분한지는 의문입니다.",
        evidence: excerpt(outsourceScope, outsourcePatterns),
        recommendation:
          "수탁자(재수탁자 포함)의 명칭과 위탁업무를 공개하세요. 대규모·빈번 변경 대상은 공식 지침의 유형화 요건과 실제 목록 확인 경로를 함께 충족하는지 확인하세요.",
        legalBasis: [SOURCES.pipa26, SOURCES.pipa30],
        confidence: outsourced ? "보통" : "낮음",
        requiresFactualVerification: !outsourced,
      });
      addCoverage("처리위탁", "conditional", "수탁자·업무 구체성 확인 필요");
    } else {
      addCoverage("처리위탁", "present", "수탁자와 위탁업무 문구 감지");
    }
  } else {
    addInactiveConditionalCoverage("처리위탁", "outsourcing");
  }

  const overseasPatterns = [
    /국외\s*이전/i,
    /해외\s*(?:이전|보관|서버|클라우드)/i,
    /개인정보를\s*국외/i,
    /(?:미국|일본|싱가포르|아일랜드|독일|호주)\s*(?:리전|서버|데이터센터|센터)/i,
    /international\s+(?:data\s+)?transfer/i,
    /transfer.*(?:outside|overseas)/i,
  ];
  const overseasDetected = matches(compact, overseasPatterns);
  const noOverseas = matches(compact, [
    /개인정보를?\s*(?:국외|해외)(?:로)?\s*(?:이전|보관)하지\s*않/i,
    /해외\s*(?:서버|클라우드)[^.\n]{0,35}(?:사용|이용|보관)하지\s*않/i,
    /국외\s*이전\s*(?:없음|해당\s*없음)/i,
  ]);
  const overseas = contextActive("overseas", overseasDetected) && !noOverseas;
  if (noOverseas && contextChoice("overseas") === "yes") {
    add({
      id: "overseas-context-conflict",
      category: "실제 운영 일치",
      title: "사용자 입력과 국외 이전 문구가 서로 다릅니다",
      severity: "medium",
      summary:
        "사용자는 실제 국외 이전이 있다고 표시했지만 처리방침에는 국외 이전하지 않는다고 적혀 있습니다. 해외 서버·수탁사와 데이터 흐름을 확인해야 합니다.",
      evidence: excerpt(compact, overseasPatterns),
      recommendation:
        "클라우드 리전과 해외 수탁사를 포함한 실제 이전 구조를 확인하고 처리방침을 최신화하세요.",
      legalBasis: [SOURCES.pipa28, SOURCES.decree31],
      confidence: "낮음",
      findingType: "factual_verification",
      requiresFactualVerification: true,
    });
    addCoverage("국외 이전", "conditional", "사용자 입력과 미이전 문구가 충돌");
  } else if (overseas) {
    signals.push(signalLabel("국외 이전", overseasDetected));
    const overseasScope = overseasDetected
      ? sectionScope(text, overseasPatterns, 3600) || compact
      : "";
    const overseasFields = [
      {
        label: "이전 근거",
        present: matches(overseasScope, [
          /국외\s*이전\s*(?:근거|동의)|제28조의8|별도\s*동의|계약(?:의)?\s*(?:체결|이행)|개인정보\s*보호\s*인증|동등한\s*수준/i,
        ]),
      },
      {
        label: "이전 항목",
        present: matches(overseasScope, [
          /이전(?:되는|하는)?\s*개인정보(?:의)?\s*항목|이전\s*항목/i,
        ]),
      },
      {
        label: "국가",
        present: matches(overseasScope, [
          /이전(?:되는)?\s*국가|국가명|(?:미국|일본|싱가포르|아일랜드|독일|호주|캐나다|영국|프랑스|네덜란드)/i,
        ]),
      },
      {
        label: "시기·방법",
        present:
          matches(overseasScope, [/이전\s*(?:일시|시기)/i]) &&
          matches(overseasScope, [/이전\s*방법|네트워크|온라인\s*전송/i]),
      },
      {
        label: "이전받는 자·연락처",
        present:
          matches(overseasScope, [/이전받는\s*자|수신자|recipient/i]) &&
          matches(overseasScope, [
            /연락처|문의처|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|https?:\/\//i,
          ]),
      },
      {
        label: "목적·보유기간",
        present:
          matches(overseasScope, [/이전(?:받는\s*자의)?\s*(?:이용\s*)?목적|이용\s*목적/i]) &&
          matches(overseasScope, [
            /보유[·ㆍ\s]*(?:및\s*)?이용\s*기간|보유\s*기간/i,
          ]),
      },
      {
        label: "거부 방법·효과",
        present:
          matches(overseasScope, [/이전(?:을)?\s*거부|거부\s*(?:방법|절차)/i]) &&
          matches(overseasScope, [/거부(?:에\s*따른|의)?\s*(?:효과|불이익)|서비스\s*이용\s*제한/i]),
      },
    ];
    const found = overseasFields.filter((field) => field.present).length;
    const missing = overseasFields
      .filter((field) => !field.present)
      .map((field) => field.label);
    if (missing.length > 0) {
      add({
        id: "overseas-transfer",
        category: "국외 이전",
        title: "국외 이전 법정 고지사항이 충분하지 않을 수 있습니다",
        severity: found <= 2 ? "high" : "medium",
        summary: `7개 핵심 범주 중 ${found}개를 감지했습니다. 추가 확인할 범주: ${missing.join("·")}. 해외 클라우드 보관도 국외 이전에 포함될 수 있습니다.`,
        evidence: excerpt(overseasScope || compact, overseasPatterns),
        recommendation:
          "국외 이전의 법적 근거, 이전받는 자와 국가, 항목, 목적, 일시·방법, 보유·이용기간, 거부 방법과 효과를 구체적으로 공개하세요.",
        legalBasis: [SOURCES.pipa28, SOURCES.decree31],
        confidence: overseasDetected ? "높음" : "보통",
        requiresFactualVerification: !overseasDetected,
      });
      addCoverage("국외 이전", "conditional", `${found}/7 핵심 범주 감지`);
    } else {
      addCoverage("국외 이전", "present", "핵심 고지 범주 감지");
    }
  } else if (noOverseas) {
    addCoverage("국외 이전", "na", "국외 이전하지 않는다는 문구 확인");
  } else {
    addInactiveConditionalCoverage("국외 이전", "overseas");
  }

  const foreignControllerPatterns = [
    /국외에서\s*국내\s*정보주체/i,
    /해외\s*사업자[^.\n]{0,60}(?:직접\s*수집|직접\s*처리)/i,
    /foreign\s+(?:controller|business)[^.\n]{0,80}(?:korean|korea)/i,
  ];
  const foreignControllerDetected = matches(compact, foreignControllerPatterns);
  if (contextActive("foreignController", foreignControllerDetected)) {
    signals.push(signalLabel("국외 사업자의 국내정보 직접 처리", foreignControllerDetected));
    const foreignScope = foreignControllerDetected
      ? sectionScope(text, foreignControllerPatterns, 1800) || compact
      : "";
    const processingCountry = matches(foreignScope, [
      /개인정보를?\s*처리하는\s*국가|처리\s*국가|사업자\s*소재\s*국가|국가명/i,
    ]);
    if (!processingCountry) {
      add({
        id: "foreign-controller-country",
        category: "국외 직접 처리",
        title: "국외 사업자의 개인정보 처리 국가명이 보이지 않습니다",
        severity: foreignControllerDetected ? "medium" : "high",
        summary:
          "국외에서 국내 정보주체의 개인정보를 직접 수집·처리하는 경우 처리 국가명을 공개해야 합니다. 실제 사업자·처리 구조를 먼저 확인해야 합니다.",
        evidence: excerpt(foreignScope || compact, foreignControllerPatterns),
        recommendation:
          "국외 사업자의 법적 주체와 개인정보를 처리하는 국가명을 구체적으로 공개하고, 국외 이전과 직접 처리 구조를 구분하세요.",
        legalBasis: [SOURCES.decree31],
        confidence: foreignControllerDetected ? "보통" : "낮음",
        requiresFactualVerification: !foreignControllerDetected,
      });
      addCoverage("국외 직접 처리 국가", "missing", "처리 국가명 미감지");
    } else {
      addCoverage("국외 직접 처리 국가", "present", "처리 국가명 문구 감지");
    }
  } else {
    addInactiveConditionalCoverage("국외 직접 처리 국가", "foreignController");
  }

  const cookiePatterns = [
    /쿠키/i,
    /행태정보/i,
    /광고\s*식별자/i,
    /자동\s*수집\s*(?:장치|도구|정보)/i,
    /웹\s*비콘/i,
    /cookie|tracking\s+technolog|advertising\s+id/i,
  ];
  const cookie = matches(compact, cookiePatterns);
  const noCookie = matches(compact, [
    /쿠키(?:를|와\s*같은\s*장치를)?\s*(?:사용|설치|운영)하지\s*않/i,
    /자동\s*수집\s*장치\s*(?:없음|해당\s*없음)/i,
  ]);
  if (noCookie && contextChoice("cookies") === "yes") {
    add({
      id: "cookies-context-conflict",
      category: "실제 운영 일치",
      title: "사용자 입력과 자동수집 미사용 문구가 서로 다릅니다",
      severity: "medium",
      summary:
        "사용자는 쿠키·행태정보를 사용한다고 표시했지만 처리방침에는 자동수집 장치를 사용하지 않는다고 적혀 있습니다. 브라우저 저장소와 네트워크 요청 확인이 필요합니다.",
      evidence: excerpt(compact, cookiePatterns),
      recommendation:
        "동의 전후 쿠키 설치와 광고·분석 스크립트 전송을 확인하고 실제 운영에 맞게 처리방침을 정정하세요.",
      legalBasis: [SOURCES.pipa30],
      confidence: "낮음",
      findingType: "factual_verification",
      requiresFactualVerification: true,
    });
    addCoverage("자동수집 장치", "conditional", "사용자 입력과 미사용 문구가 충돌");
  } else if ((cookie || contextChoice("cookies") === "yes") && !noCookie) {
    signals.push(signalLabel("자동수집·행태정보", cookie));
    const cookieScope = cookie
      ? sectionScope(text, cookiePatterns, 2200) || compact
      : "";
    const refusal = matches(cookieScope, [
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
        severity: cookie ? "medium" : "high",
        summary:
          "자동수집 장치는 언급되지만 정보주체가 브라우저·앱에서 수집을 거부하거나 삭제하는 구체적인 방법을 찾지 못했습니다.",
        evidence: excerpt(cookieScope, cookiePatterns),
        recommendation:
          "수집 항목·방법·목적·보유기간과 함께 주요 브라우저/앱의 쿠키·맞춤형 광고 차단 경로를 실제 메뉴 기준으로 안내하세요.",
        legalBasis: [SOURCES.pipa30],
        confidence: cookie ? "높음" : "낮음",
        requiresFactualVerification: !cookie,
      });
      addCoverage("자동수집 장치", "conditional", "거부 방법 확인 필요");
    } else {
      addCoverage("자동수집 장치", "present", "거부·차단 문구 감지");
    }
  } else if (noCookie) {
    addCoverage("자동수집 장치", "na", "자동수집 장치를 사용하지 않는다는 문구 확인");
  } else {
    addInactiveConditionalCoverage("자동수집 장치", "cookies");
  }

  const sensitivePatterns = [
    /민감정보/i,
    /건강정보|진료정보|질병|장애정보|유전정보|범죄경력|생체정보/i,
    /정치적\s*견해|노동조합|성생활/i,
    /sensitive\s+(?:personal\s+)?(?:data|information)|health\s+data/i,
  ];
  const sensitiveDetected = matches(compact, sensitivePatterns);
  const noSensitive = matches(compact, [
    /민감정보[^.\n]{0,35}(?:수집|처리|공개)하지\s*않/i,
    /민감정보\s*(?:없음|해당\s*없음)/i,
  ]);
  if (sensitiveDetected && !noSensitive) {
    signals.push("민감정보");
    const sensitiveScope = sectionScope(text, sensitivePatterns, 2400) || compact;
    const separateBasis = matches(sensitiveScope, [
      /별도(?:로)?\s*동의/i,
      /민감정보.*법령/i,
      /법령에서.*민감정보/i,
      /explicit\s+consent/i,
    ]);
    const publicDisclosurePossible = matches(sensitiveScope, [
      /(?:프로필|게시물|커뮤니티|후기|공개\s*설정)[^.\n]{0,70}(?:민감정보|건강정보|생체정보)[^.\n]{0,35}(?:공개|노출)/i,
      /(?:민감정보|건강정보|생체정보)[^.\n]{0,70}(?:공개될|공개할|노출될)\s*수\s*있/i,
    ]);
    const nonPublicChoice = matches(sensitiveScope, [
      /비공개(?:를)?\s*(?:선택|설정)|공개\s*범위\s*(?:선택|설정)|공개하지\s*않도록/i,
    ]);

    if (publicDisclosurePossible && !nonPublicChoice) {
      add({
        id: "sensitive-public-choice",
        category: "민감정보",
        title: "민감정보의 비공개 선택 방법이 보이지 않습니다",
        severity: "high",
        summary:
          "정보주체의 선택에 따라 민감정보가 공개될 가능성이 있는 정황을 찾았지만, 공개 가능성 안내와 비공개 선택 방법을 함께 확인하지 못했습니다.",
        evidence: excerpt(sensitiveScope, sensitivePatterns),
        recommendation:
          "공개될 수 있는 민감정보 항목과 공개 범위를 사전에 알리고, 정보주체가 비공개를 선택할 수 있는 실제 설정 경로를 안내하세요.",
        legalBasis: [SOURCES.pipa23, SOURCES.pipa30],
        confidence: "보통",
      });
      addCoverage("민감정보 공개 가능성", "missing", "비공개 선택 방법 미감지");
    } else if (publicDisclosurePossible) {
      addCoverage("민감정보 공개 가능성", "present", "비공개 선택 방법 문구 감지");
    }

    if (!separateBasis) {
      add({
        id: "sensitive-basis-verification",
        category: "민감정보",
        title: "민감정보 처리 근거는 동의 화면·법령에서 별도 확인해야 합니다",
        severity: "low",
        summary:
          "처리방침에서 민감정보 정황을 찾았지만, 처리방침만으로 별도 동의 또는 구체적인 법령 근거의 실제 확보 여부를 확정할 수 없습니다.",
        evidence: excerpt(sensitiveScope, sensitivePatterns),
        recommendation:
          "민감정보 항목을 특정하고, 실제 수집 화면의 별도 동의 또는 적용 법령의 근거를 담당자가 교차검증하세요.",
        legalBasis: [SOURCES.pipa23],
        confidence: "보통",
        findingType: "factual_verification",
        requiresFactualVerification: true,
      });
    }
  }

  const uniquePatterns = [
    /주민등록번호|여권번호|운전면허번호|외국인등록번호/i,
    /고유식별정보/i,
  ];
  const uniqueDetected = matches(compact, uniquePatterns);
  const noUnique = matches(compact, [
    /(?:고유식별정보|주민등록번호|여권번호|운전면허번호|외국인등록번호)[^.\n]{0,35}(?:수집|처리)하지\s*않/i,
    /고유식별정보\s*(?:없음|해당\s*없음)/i,
  ]);
  if (uniqueDetected && !noUnique) {
    signals.push("고유식별정보");
    const uniqueScope = sectionScope(text, uniquePatterns, 2200) || compact;
    const residentNumber = /주민등록번호/i.test(uniqueScope);
    const legalBasis = matches(uniqueScope, [
      /별도(?:로)?\s*동의/i,
      /법령(?:에서|에\s*따라|상)/i,
      /법률\s*제\d+조/i,
    ]);
    const residentStatutoryBasis = matches(uniqueScope, [
      /주민등록번호[^.\n]{0,80}(?:법률|법령|시행령|제\d+조)|제24조의2/i,
    ]);
    if ((residentNumber && !residentStatutoryBasis) || (!residentNumber && !legalBasis)) {
      add({
        id: residentNumber ? "resident-number-basis" : "unique-id-basis",
        category: "고유식별정보",
        title: residentNumber
          ? "주민등록번호의 법정 처리 근거를 별도로 확인해야 합니다"
          : "고유식별정보 처리 근거를 별도로 확인해야 합니다",
        severity: "low",
        summary:
          residentNumber
            ? "주민등록번호는 정보주체의 동의만으로 처리할 수 없으므로, 구체적인 법령상 허용 근거를 동의 화면과 내부 처리 근거에서 확인해야 합니다."
            : "고유식별정보는 별도 동의 또는 구체적인 법령상 허용 근거가 필요하지만 처리방침만으로 실제 근거 확보 여부를 확정할 수 없습니다.",
        evidence: excerpt(uniqueScope, uniquePatterns),
        recommendation:
          "처리하는 식별번호를 특정하고, 별도 동의 또는 허용 법령의 정확한 조문을 내부 증빙과 함께 교차검증하세요.",
        legalBasis: [SOURCES.pipa24],
        confidence: "보통",
        findingType: "factual_verification",
        requiresFactualVerification: true,
      });
    }
  }

  const childPatterns = [
    /만\s*14세\s*미만[^.\n]{0,40}(?:개인정보|회원|이용자|수집|처리)/i,
    /아동(?:의)?\s*개인정보|아동\s*회원|어린이\s*회원|아동\s*대상\s*서비스/i,
    /children['’]?s?\s+(?:personal\s+)?(?:data|privacy)|parental\s+consent/i,
  ];
  const childrenDetected = matches(compact, childPatterns);
  const noChildren = matches(compact, [
    /만\s*14세\s*미만[^.\n]{0,50}(?:회원가입|가입|서비스\s*이용)[^.\n]{0,25}(?:불가|제한|받지\s*않)/i,
    /만\s*14세\s*미만[^.\n]{0,50}개인정보[^.\n]{0,25}(?:수집|처리)하지\s*않/i,
    /아동(?:의)?\s*개인정보[^.\n]{0,30}(?:수집|처리)하지\s*않/i,
  ]);
  if (noChildren && contextChoice("children") === "yes") {
    add({
      id: "children-context-conflict",
      category: "실제 운영 일치",
      title: "사용자 입력과 아동 미처리 문구가 서로 다릅니다",
      severity: "medium",
      summary:
        "사용자는 만 14세 미만 이용자가 있다고 표시했지만 처리방침에는 가입·수집하지 않는다고 적혀 있습니다. 실제 연령 제한과 가입 흐름을 확인해야 합니다.",
      evidence: excerpt(compact, childPatterns),
      recommendation:
        "가입 화면의 연령 확인, 법정대리인 동의·확인 절차와 실제 아동정보 처리 여부를 교차검증하세요.",
      legalBasis: [SOURCES.pipa22, SOURCES.pipa30],
      confidence: "낮음",
      findingType: "factual_verification",
      requiresFactualVerification: true,
    });
    addCoverage("아동·법정대리인", "conditional", "사용자 입력과 미처리 문구가 충돌");
  } else if (contextActive("children", childrenDetected) && !noChildren) {
    signals.push(signalLabel("아동 개인정보", childrenDetected));
    const childScope = childrenDetected
      ? sectionScope(text, childPatterns, 2400) || compact
      : "";
    const guardian = matches(childScope, [
      /법정대리인(?:의)?\s*동의/i,
      /보호자(?:의)?\s*동의/i,
      /parental\s+consent/i,
    ]);
    const verify = matches(childScope, [
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
        evidence: excerpt(childScope || compact, childPatterns),
        recommendation:
          "법정대리인 동의·확인 방법, 최소 수집정보, 아동이 이해하기 쉬운 안내 방식을 별도 절로 구체화하세요.",
        legalBasis: [SOURCES.pipa22],
        confidence: childrenDetected ? "높음" : "보통",
        requiresFactualVerification: !childrenDetected,
      });
      addCoverage("아동·법정대리인", "conditional", "동의·확인 절차 교차검증 필요");
    } else {
      addCoverage("아동·법정대리인", "present", "동의·확인 절차 문구 감지");
    }
  } else if (noChildren) {
    addCoverage("아동·법정대리인", "na", "만 14세 미만을 처리하지 않는다는 문구 확인");
  } else {
    addInactiveConditionalCoverage("아동·법정대리인", "children");
  }

  const pseudonymPatterns = [/가명정보|가명처리|pseudonymi[sz]ed/i];
  const pseudonymDetected = matches(compact, pseudonymPatterns);
  const noPseudonym = matches(compact, [
    /가명정보[^.\n]{0,35}(?:처리|이용|결합)하지\s*않/i,
    /가명정보\s*(?:없음|해당\s*없음)/i,
  ]);
  if (pseudonymDetected && !noPseudonym) {
    signals.push("가명정보");
    const pseudonymScope = sectionScope(text, pseudonymPatterns, 2600) || compact;
    const pseudonymFields = [
      { label: "처리 목적", present: matches(pseudonymScope, [/처리\s*목적|이용\s*목적/i]) },
      { label: "처리 항목", present: matches(pseudonymScope, [/개인정보\s*항목|처리\s*항목/i]) },
      { label: "보유기간", present: matches(pseudonymScope, [/보유\s*(?:및\s*이용\s*)?기간/i]) },
      { label: "안전성 확보조치", present: matches(pseudonymScope, [/안전성\s*확보|재식별\s*방지|분리\s*보관/i]) },
    ];
    const missingPseudonym = pseudonymFields
      .filter((field) => !field.present)
      .map((field) => field.label);
    if (missingPseudonym.length > 0) {
      add({
        id: "pseudonym",
        category: "가명정보",
        title: "가명정보 처리 내용이 충분히 구체적이지 않습니다",
        severity: "medium",
        summary: `가명정보의 목적·항목·보유기간·안전성 확보조치 중 추가 확인할 사항: ${missingPseudonym.join("·")}.`,
        evidence: excerpt(pseudonymScope, pseudonymPatterns),
        recommendation:
          "가명정보의 처리 목적, 항목, 보유기간, 제3자 제공 여부와 안전성 확보조치를 별도 표로 공개하세요.",
        legalBasis: [SOURCES.pipa30],
        confidence: "보통",
      });
      addCoverage("가명정보", "conditional", `${4 - missingPseudonym.length}/4 핵심 범주 감지`);
    } else {
      addCoverage("가명정보", "present", "목적·항목·기간·안전조치 문구 감지");
    }
  } else if (noPseudonym) {
    addCoverage("가명정보", "na", "가명정보를 처리하지 않는다는 문구 확인");
  } else {
    addCoverage("가명정보", "unknown", "문서에서 적용 신호를 찾지 못함 · 실제 운영 여부 확인 필요");
  }

  const aiPatterns = [
    /생성형\s*(?:인공지능|AI)|인공지능\s*(?:모델|서비스)|AI\s*(?:모델|서비스)/i,
    /프롬프트|모델\s*학습|학습\s*데이터|온디바이스/i,
    /generative\s+AI|artificial\s+intelligence|model\s+training/i,
  ];
  const aiDetected = matches(compact, aiPatterns);
  const noAiProcessing = matches(compact, [
    /(?:생성형\s*)?(?:AI|인공지능)[^.\n]{0,35}(?:사용|이용|처리)하지\s*않/i,
    /AI\s*(?:처리|서비스)\s*(?:없음|해당\s*없음)/i,
  ]);
  if (contextActive("ai", aiDetected) && !noAiProcessing) {
    signals.push(signalLabel("생성형 AI", aiDetected));
    const aiScope = aiDetected ? sectionScope(text, aiPatterns, 3400) || compact : "";
    const aiGuidanceFields = [
      {
        label: "의도된 용례·대상",
        present: matches(aiScope, [
          /(?:의도된|제공하는|사용하는)\s*(?:용례|목적|기능)|이용\s*대상|누구를\s*대상/i,
        ]),
      },
      {
        label: "입력·결과물 처리항목",
        present: matches(aiScope, [
          /(?:프롬프트|입력\s*정보|텍스트|음성|첨부파일)[^.\n]{0,90}(?:수집|저장|처리)/i,
          /(?:생성\s*결과물|출력\s*정보)[^.\n]{0,70}(?:수집|저장|처리)/i,
        ]),
      },
      {
        label: "학습 활용 여부",
        present: matches(aiScope, [
          /(?:모델|AI)\s*학습[^.\n]{0,60}(?:활용|사용|이용|하지\s*않)/i,
        ]),
      },
      {
        label: "학습 거부 절차",
        present: matches(aiScope, [
          /(?:학습|모델\s*개선)[^.\n]{0,70}(?:거부|철회|옵트[\s-]?아웃|opt[\s-]?out)/i,
        ]),
      },
      {
        label: "민감·고유식별정보 주의",
        present: matches(aiScope, [
          /(?:민감정보|고유식별정보|주민등록번호)[^.\n]{0,60}(?:입력하지|주의|제한|금지)/i,
        ]),
      },
      {
        label: "신고·이의제기",
        present: matches(aiScope, [
          /(?:부적절한|유해한|잘못된)\s*(?:답변|결과)[^.\n]{0,60}(?:신고|이의)|이의\s*제기/i,
        ]),
      },
    ];
    const missingAiGuidance = aiGuidanceFields
      .filter((field) => !field.present)
      .map((field) => field.label);
    if (missingAiGuidance.length > 0) {
      add({
        id: "ai-transparency-guidance",
        category: "생성형 AI 투명성",
        title: "2026 작성지침의 생성형 AI 권고사항을 추가로 확인하세요",
        severity: "low",
        summary: `공식 작성지침의 6개 투명성 범주 중 ${6 - missingAiGuidance.length}개를 감지했습니다. 추가 확인: ${missingAiGuidance.join("·")}. 이 결과는 법정 필수항목 누락 판정이 아니라 공식 지침상 보완 후보입니다.`,
        evidence: excerpt(aiScope || compact, aiPatterns),
        recommendation:
          "입력·결과물의 수집·저장 여부, 모델 학습 활용과 거부 절차, 민감정보 입력 주의, 신고·이의제기 경로를 실제 서비스 흐름과 맞춰 안내하세요.",
        legalBasis: [SOURCES.pipcGuideline],
        confidence: aiDetected ? "보통" : "낮음",
        findingType: "factual_verification",
        requiresFactualVerification: true,
      });
    }
  }

  const automatedPatterns = [
    /자동화된\s*결정|완전히\s*자동화된\s*시스템/i,
    /사람(?:의)?\s*개입\s*없이[^.\n]{0,80}(?:결정|승인|거절|평가|선정)/i,
    /(?:AI|인공지능)[^.\n]{0,80}(?:채용|대출|신용|보험|가격|자격)[^.\n]{0,50}(?:결정|승인|거절|평가)/i,
    /automated\s+decision(?:-making)?/i,
  ];
  const automatedDetected = matches(compact, automatedPatterns);
  const noAutomatedDecision = matches(compact, [
    /자동화된\s*결정[^.\n]{0,35}(?:하지\s*않|없음|해당\s*없음)/i,
  ]);
  if (
    contextActive("automatedDecision", automatedDetected) &&
    !noAutomatedDecision
  ) {
    signals.push(signalLabel("자동화된 결정", automatedDetected));
    const automatedScope = automatedDetected
      ? sectionScope(text, automatedPatterns, 3400) || compact
      : "";
    const automatedFields = [
      {
        label: "결정 사실·목적·대상",
        present:
          matches(automatedScope, [/자동화된\s*결정|automated\s+decision/i]) &&
          matches(automatedScope, [/목적/i]) &&
          matches(automatedScope, [/대상|정보주체\s*범위/i]),
      },
      {
        label: "주요 개인정보·결정과의 관계",
        present:
          matches(automatedScope, [/주요\s*개인정보|개인정보\s*(?:유형|항목)/i]) &&
          matches(automatedScope, [/관계|영향|반영/i]),
      },
      {
        label: "고려사항·처리절차",
        present:
          matches(automatedScope, [/고려\s*사항|주요\s*기준/i]) &&
          matches(automatedScope, [/절차|처리\s*과정/i]),
      },
      {
        label: "거부·설명 요구 방법",
        present:
          matches(automatedScope, [/거부|설명|검토\s*요구|인적\s*개입/i]) &&
          matches(automatedScope, [/방법|절차|신청|요청/i]),
      },
    ];
    if (matches(automatedScope, [...sensitivePatterns, ...childPatterns])) {
      automatedFields.push({
        label: "민감정보·아동정보 목적과 항목",
        present:
          matches(automatedScope, [/민감정보|만\s*14세\s*미만|아동/i]) &&
          matches(automatedScope, [/목적/i]) &&
          matches(automatedScope, [/구체적인\s*항목|개인정보\s*항목/i]),
      });
    }
    const missingAutomated = automatedFields
      .filter((field) => !field.present)
      .map((field) => field.label);
    if (missingAutomated.length > 0) {
      add({
        id: "automated-decision",
        category: "자동화된 결정",
        title: "자동화된 결정의 공개사항이 충분하지 않을 수 있습니다",
        severity: "medium",
        summary: `공개 대상 범주 중 추가 확인할 사항: ${missingAutomated.join("·")}. 단순한 AI 추천이나 보조 기능은 법 제37조의2의 자동화된 결정과 동일하지 않습니다.`,
        evidence: excerpt(automatedScope || compact, automatedPatterns),
        recommendation:
          "완전히 자동화된 결정인지 먼저 확인한 뒤, 결정 사실·목적·대상, 주요 개인정보와 영향, 기준·절차, 거부·설명·검토 요구 방법을 공개하세요.",
        legalBasis: [SOURCES.automated, SOURCES.automatedDecree],
        confidence: automatedDetected ? "보통" : "낮음",
        requiresFactualVerification: !automatedDetected,
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
  const ecommerceDetected = matches(compact, ecommercePatterns);
  if (contextActive("ecommerce", ecommerceDetected)) {
    signals.push(signalLabel("전자상거래", ecommerceDetected));
    const statutoryPeriods =
      /표시.*광고.*6개월|광고.*기록.*6개월/i.test(compact) &&
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
        legalBasis: [SOURCES.ecommerce, SOURCES.ecommerceDecree],
        confidence: ecommerceDetected ? "보통" : "낮음",
        requiresFactualVerification: !ecommerceDetected,
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

  const assessedCoverage = coverage.filter(
    (item) => item.state !== "na" && item.state !== "unknown",
  );
  const coveragePoints = assessedCoverage.reduce(
    (sum, item) =>
      sum + (item.state === "present" ? 1 : item.state === "conditional" ? 0.5 : 0),
    0,
  );
  const score = assessedCoverage.length
    ? Math.round((coveragePoints / assessedCoverage.length) * 100)
    : 0;
  const missingCoverage = coverage.filter((item) => item.state === "missing");
  const conditionalCoverage = coverage.filter(
    (item) => item.state === "conditional",
  );
  const grade =
    missingCoverage.length === 0 && counts.high === 0
      ? "대체로양호"
      : missingCoverage.length <= 1 && counts.high <= 1
        ? "보완필요"
        : "우선검토";
  const headline =
    grade === "대체로양호"
      ? "자동 탐지상 큰 누락은 적지만 실제 운영은 별도 확인해야 합니다"
      : grade === "보완필요"
        ? "일부 기재요소와 적용 조건을 검토해야 합니다"
        : "법정 기재요소의 누락 가능성부터 우선 검토하세요";

  const clarityFindingIds = new Set([
    "vague-purpose",
    "vague-retention",
    "vague-third-party",
    "weak-deletion",
    "weak-rights",
    "weak-contact",
    "version-history",
  ]);
  const clarityFindings = findings.filter((finding) =>
    clarityFindingIds.has(finding.id),
  );
  const consistencyFindings = findings.filter(
    (finding) =>
      finding.category === "실제 운영 일치" ||
      finding.id.endsWith("-inconsistency"),
  );
  const evaluationAxes: EvaluationAxis[] = [
    {
      key: "appropriateness",
      label: "기재 적정성",
      state:
        missingCoverage.length === 0 && conditionalCoverage.length === 0
          ? "good"
          : "review",
      detail:
        missingCoverage.length > 0
          ? `명확한 누락 가능성 ${missingCoverage.length}개, 조건부 확인 ${conditionalCoverage.length}개`
          : conditionalCoverage.length > 0
            ? `조건부 확인 ${conditionalCoverage.length}개`
            : "평가대상 기재요소에서 큰 누락을 자동 탐지하지 못함",
    },
    {
      key: "readability",
      label: "가독성·명확성",
      state: clarityFindings.length > 0 ? "review" : "good",
      detail:
        clarityFindings.length > 0
          ? `포괄적 표현·절차 불명확 후보 ${clarityFindings.length}개`
          : "현재 규칙에서 주요 모호 표현을 찾지 못함 · 문장 난이도는 별도 검토",
    },
    {
      key: "accessibility",
      label: "접근성",
      state:
        meta.discoveryPath && meta.discoveryPath.length > 1
          ? "good"
          : "not_evaluated",
      detail:
        meta.discoveryPath && meta.discoveryPath.length > 1
          ? `입력 홈페이지에서 ${meta.discoveryPath.length - 1}단계로 처리방침 자동 발견`
          : meta.policyUrl
            ? "처리방침 URL은 확인했지만 홈페이지에서의 발견 용이성은 별도 평가 필요"
            : "원문 직접 입력 · 공개 위치와 발견 용이성은 평가하지 않음",
    },
    {
      key: "consistency",
      label: "실제 운영 일치",
      state: consistencyFindings.length > 0 ? "review" : "not_evaluated",
      detail:
        consistencyFindings.length > 0
          ? `사용자 입력 또는 문단 간 충돌 후보 ${consistencyFindings.length}개`
          : "회원가입·동의·SDK·쿠키·삭제 실행을 관찰하지 않아 판단 유보",
    },
  ];

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
    scoreMethod: {
      label: "자동탐지 기재 충족도",
      formula: "(문구 확인 1점 + 조건부 확인 0.5점) ÷ 자동 평가대상 기재요소",
      meaning:
        "법률 준수율·위반 확률·개인정보위 공식 평가점수가 아니라 자동 탐지된 문서 기재상태의 참고값입니다.",
    },
    findings,
    coverage,
    evaluationAxes,
    detectedSignals: [...new Set(signals)],
    policyExcerpt: text.slice(0, 18000),
    analysisEngine: {
      mode: "local_rules",
      name: "무료 규칙·휴리스틱 엔진",
      version: LEGAL_BASELINE.rulesetVersion,
      aiUsed: false,
      externalApiCalls: 0,
      estimatedApiCostKrw: 0,
      confidenceMeaning:
        "신뢰도는 통계적 정확도가 아니라 문구와 규칙 패턴이 얼마나 명시적으로 일치했는지를 뜻합니다.",
      evaluationStatus: "법령요소 회귀검증 적용 · 전문가 정확도 미측정",
      limitations: [
        "이미지·PDF 안의 표와 로그인 뒤 화면은 원문 붙여넣기 없이 확인할 수 없음",
        "실제 수집 항목, 쿠키 전송, 동의 화면, 파기 실행 여부는 현장 검증 필요",
        "문장의 의미를 통계적 AI가 해석하지 않으므로 새로운 표현은 탐지하지 못할 수 있음",
        "전문가 라벨 코퍼스의 정밀도·재현율 검증 전이므로 최종 법률 판단에 단독 사용 불가",
      ],
    },
    legalBaseline: {
      date: LEGAL_BASELINE.verifiedAt,
      verifiedAt: LEGAL_BASELINE.verifiedAt,
      rulesetVersion: LEGAL_BASELINE.rulesetVersion,
      monitoring: LEGAL_BASELINE.monitoring,
      statutes: LEGAL_BASELINE.statutes,
      upcomingChanges: LEGAL_BASELINE.upcomingChanges,
    },
  };
}
