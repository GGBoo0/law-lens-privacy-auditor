export const LEGAL_SOURCE_IDS = Object.freeze({
  PIPA: "pipa",
  PIPA_DECREE: "pipa-decree",
  PIPC_PRIVACY_POLICY_GUIDELINE: "pipc-privacy-policy-guideline",
  PRIVACY_POLICY_EVALUATION_NOTICE: "privacy-policy-evaluation-notice",
  PRIVACY_SECURITY_STANDARD: "privacy-security-standard",
  ECOMMERCE_ACT: "ecommerce-act",
  ECOMMERCE_DECREE: "ecommerce-decree",
  AI_FRAMEWORK_ACT: "ai-framework-act",
  LOCATION_INFORMATION_ACT: "location-information-act",
  CREDIT_INFORMATION_ACT: "credit-information-act",
});

export const REQUIRED_MONITORED_LEGAL_SOURCE_IDS = Object.freeze(
  Object.values(LEGAL_SOURCE_IDS),
);
