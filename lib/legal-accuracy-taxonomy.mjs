/**
 * Stable evaluation taxonomy for the privacy-policy analyzer.
 *
 * Analyzer finding ids are implementation-level outcomes.  The evaluator uses
 * canonical rule ids so that pass/missing/weak variants are scored as one
 * legal question and a wording-only refactor does not silently create a new
 * benchmark label.
 */

export const LEGAL_ACCURACY_MODES = Object.freeze([
  "policy_only",
  "context_assisted",
]);

export const LEGAL_ACCURACY_DECISIONS = Object.freeze([
  "finding",
  "no_finding",
  "not_applicable",
  "uncertain",
]);

const coreRule = (id, title, extraFindingIds = []) => ({
  id: `core.${id}`,
  title,
  family: "core_disclosures",
  findingIds: [`missing-${id}`, ...extraFindingIds],
  noFindingIds: [`present-${id}`],
  applicability: "always",
});

export const LEGAL_ACCURACY_RULES = Object.freeze([
  coreRule("purpose", "개인정보 처리 목적"),
  coreRule("items", "처리하는 개인정보 항목"),
  coreRule("retention", "처리 및 보유 기간"),
  coreRule("deletion", "파기 절차와 방법", ["weak-deletion"]),
  coreRule("rights", "정보주체 권리와 행사 방법", ["weak-rights"]),
  coreRule("contact", "개인정보 보호책임자 또는 문의처", ["weak-contact"]),
  coreRule("security", "안전성 확보조치"),
  {
    id: "clarity.purpose",
    title: "처리 목적 명확성",
    family: "clarity",
    findingIds: ["vague-purpose"],
    noFindingIds: [],
    applicability: "always",
  },
  {
    id: "clarity.retention",
    title: "보유 기간 명확성",
    family: "clarity",
    findingIds: ["vague-retention"],
    noFindingIds: [],
    applicability: "always",
  },
  {
    id: "data_portability.disclosure",
    title: "본인전송요구 안내",
    family: "data_subject_rights",
    findingIds: ["data-portability-disclosure"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "dataPortability",
  },
  {
    id: "data_portability.context_conflict",
    title: "본인전송요구 적용 여부 충돌",
    family: "consistency",
    findingIds: ["data-portability-context-conflict"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "dataPortability",
  },
  {
    id: "third_party.disclosure",
    title: "제3자 제공 고지",
    family: "third_party_provision",
    findingIds: ["third-party-missing", "third-party-fields"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "thirdParty",
  },
  {
    id: "third_party.ambiguity",
    title: "제3자 제공 표현 명확성",
    family: "third_party_provision",
    findingIds: ["vague-third-party"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "thirdParty",
  },
  {
    id: "third_party.inconsistency",
    title: "제3자 제공 문단 간 일관성",
    family: "consistency",
    findingIds: ["third-party-inconsistency"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "thirdParty",
  },
  {
    id: "third_party.context_conflict",
    title: "제3자 제공 운영 맥락 충돌",
    family: "consistency",
    findingIds: ["third-party-context-conflict"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "thirdParty",
  },
  {
    id: "outsourcing.disclosure",
    title: "처리위탁 고지",
    family: "outsourcing",
    findingIds: ["outsourcing-missing", "outsourcing-detail"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "outsourcing",
  },
  {
    id: "outsourcing.inconsistency",
    title: "처리위탁 문단 간 일관성",
    family: "consistency",
    findingIds: ["outsourcing-inconsistency"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "outsourcing",
  },
  {
    id: "outsourcing.context_conflict",
    title: "처리위탁 운영 맥락 충돌",
    family: "consistency",
    findingIds: ["outsourcing-context-conflict"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "outsourcing",
  },
  {
    id: "overseas.disclosure",
    title: "개인정보 국외이전 고지",
    family: "cross_border_transfer",
    findingIds: ["overseas-transfer"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "overseas",
  },
  {
    id: "overseas.foreign_controller_country",
    title: "국외 직접 처리 국가명",
    family: "cross_border_transfer",
    findingIds: ["foreign-controller-country"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "foreignController",
  },
  {
    id: "overseas.context_conflict",
    title: "국외이전 운영 맥락 충돌",
    family: "consistency",
    findingIds: ["overseas-context-conflict"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "overseas",
  },
  {
    id: "cookies.refusal",
    title: "자동수집 장치와 거부 방법",
    family: "cookies_behavioral",
    findingIds: ["cookie-refusal"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "cookies",
  },
  {
    id: "cookies.context_conflict",
    title: "자동수집 장치 운영 맥락 충돌",
    family: "consistency",
    findingIds: ["cookies-context-conflict"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "cookies",
  },
  {
    id: "sensitive.public_choice",
    title: "민감정보 공개 가능성과 비공개 선택",
    family: "special_categories",
    findingIds: ["sensitive-public-choice"],
    noFindingIds: [],
    applicability: "detected",
  },
  {
    id: "sensitive.basis_verification",
    title: "민감정보 처리 근거",
    family: "special_categories",
    findingIds: ["sensitive-basis-verification"],
    noFindingIds: [],
    applicability: "detected",
  },
  {
    id: "identifier.resident_number_basis",
    title: "주민등록번호 처리 근거",
    family: "special_categories",
    findingIds: ["resident-number-basis"],
    noFindingIds: [],
    applicability: "detected",
  },
  {
    id: "identifier.unique_id_basis",
    title: "고유식별정보 처리 근거",
    family: "special_categories",
    findingIds: ["unique-id-basis"],
    noFindingIds: [],
    applicability: "detected",
  },
  {
    id: "children.disclosure",
    title: "만 14세 미만 아동 정보 처리",
    family: "special_categories",
    findingIds: ["children"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "children",
  },
  {
    id: "children.context_conflict",
    title: "아동 정보 처리 운영 맥락 충돌",
    family: "consistency",
    findingIds: ["children-context-conflict"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "children",
  },
  {
    id: "pseudonym.disclosure",
    title: "가명정보 처리 공개",
    family: "core_disclosures",
    findingIds: ["pseudonym"],
    noFindingIds: [],
    applicability: "detected",
  },
  {
    id: "ai.transparency_guidance",
    title: "생성형 AI 투명성 안내",
    family: "ai_transparency",
    findingIds: ["ai-transparency-guidance"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "ai",
  },
  {
    id: "automated_decision.disclosure",
    title: "완전 자동화된 결정 고지",
    family: "automated_decision",
    findingIds: ["automated-decision"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "automatedDecision",
  },
  {
    id: "sector.location",
    title: "개인위치정보 추가 검토",
    family: "location_information",
    findingIds: ["location-sector"],
    noFindingIds: [],
    applicability: "detected",
  },
  {
    id: "sector.credit",
    title: "개인신용정보 추가 검토",
    family: "credit_information",
    findingIds: ["credit-sector"],
    noFindingIds: [],
    applicability: "detected",
  },
  {
    id: "sector.ecommerce_retention",
    title: "전자상거래 기록 보유기간",
    family: "ecommerce_retention",
    findingIds: ["ecommerce-retention"],
    noFindingIds: [],
    applicability: "conditional",
    contextKey: "ecommerce",
  },
  {
    id: "transparency.version_history",
    title: "시행일과 변경 이력",
    family: "policy_transparency",
    findingIds: ["version-history"],
    noFindingIds: [],
    applicability: "always",
  },
].map((rule) => Object.freeze({ ...rule })));

export const LEGAL_ACCURACY_RULE_BY_ID = new Map(
  LEGAL_ACCURACY_RULES.map((rule) => [rule.id, rule]),
);

export const LEGAL_ACCURACY_RULE_ALIASES = new Map(
  LEGAL_ACCURACY_RULES.flatMap((rule) => [
    [rule.id, rule.id],
    [rule.id.replaceAll(".", "_"), rule.id],
  ]),
);

export const LEGAL_ACCURACY_OMISSION_RULE_IDS = new Set([
  "core.purpose",
  "core.items",
  "core.retention",
  "core.deletion",
  "core.rights",
  "core.contact",
  "core.security",
  "data_portability.disclosure",
  "third_party.disclosure",
  "outsourcing.disclosure",
  "overseas.disclosure",
  "overseas.foreign_controller_country",
  "cookies.refusal",
  "children.disclosure",
  "pseudonym.disclosure",
  "ai.transparency_guidance",
  "automated_decision.disclosure",
  "sector.ecommerce_retention",
  "transparency.version_history",
]);

export function canonicalizeLegalAccuracyRuleId(ruleId) {
  return LEGAL_ACCURACY_RULE_ALIASES.get(ruleId) ?? null;
}

export const LEGAL_ACCURACY_FINDING_MAP = new Map();
for (const rule of LEGAL_ACCURACY_RULES) {
  for (const findingId of rule.findingIds) {
    if (LEGAL_ACCURACY_FINDING_MAP.has(findingId)) {
      throw new Error(`Duplicate accuracy finding mapping: ${findingId}`);
    }
    LEGAL_ACCURACY_FINDING_MAP.set(findingId, {
      ruleId: rule.id,
      isFinding: true,
    });
  }
  for (const findingId of rule.noFindingIds) {
    if (LEGAL_ACCURACY_FINDING_MAP.has(findingId)) {
      throw new Error(`Duplicate accuracy finding mapping: ${findingId}`);
    }
    LEGAL_ACCURACY_FINDING_MAP.set(findingId, {
      ruleId: rule.id,
      isFinding: false,
    });
  }
}

export function canonicalRuleForFinding(findingId) {
  return LEGAL_ACCURACY_FINDING_MAP.get(findingId) ?? null;
}

export function validateCanonicalRuleIds(ruleIds) {
  const errors = [];
  const seen = new Set();
  for (const ruleId of ruleIds ?? []) {
    if (typeof ruleId !== "string" || !LEGAL_ACCURACY_RULE_BY_ID.has(ruleId)) {
      errors.push(`Unknown canonical rule id: ${String(ruleId)}`);
      continue;
    }
    if (seen.has(ruleId)) errors.push(`Duplicate canonical rule id: ${ruleId}`);
    seen.add(ruleId);
  }
  return errors;
}
