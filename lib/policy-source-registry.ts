export type PolicySourceProfile = {
  inputDomains: string[];
  hints: string[];
  trustedPolicyDomains?: string[];
};

const profiles: PolicySourceProfile[] = [
  {
    inputDomains: ["daum.net"],
    hints: ["https://www.kakao.com/policy/privacy?lang=ko"],
    trustedPolicyDomains: ["kakao.com"],
  },
  {
    inputDomains: ["microsoft.com"],
    hints: ["https://privacy.microsoft.com/ko-kr/privacystatement"],
    trustedPolicyDomains: ["microsoft.com"],
  },
  {
    inputDomains: ["apple.com"],
    hints: ["https://www.apple.com/legal/privacy/kr/"],
    trustedPolicyDomains: ["apple.com"],
  },
  {
    inputDomains: ["watcha.com"],
    hints: ["https://watcha.com/ko-KR/legals/privacy"],
    trustedPolicyDomains: ["watcha.com"],
  },
  {
    inputDomains: ["jobkorea.co.kr"],
    hints: ["https://www.jobkorea.co.kr/service_jk/privacy.asp"],
    trustedPolicyDomains: ["jobkorea.co.kr"],
  },
  {
    inputDomains: ["saramin.co.kr"],
    hints: ["https://m.saramin.co.kr/index/privacy-policy"],
    trustedPolicyDomains: ["saramin.co.kr"],
  },
  {
    inputDomains: ["naver.com"],
    hints: ["https://policy.naver.com/rules/privacy.html"],
    trustedPolicyDomains: ["policy.naver.com"],
  },
  {
    inputDomains: ["11st.co.kr"],
    hints: ["https://privacy.11st.co.kr/"],
    trustedPolicyDomains: ["privacy.11st.co.kr"],
  },
  {
    inputDomains: ["google.com", "google.co.kr", "youtube.com"],
    hints: ["https://policies.google.com/privacy?hl=ko"],
    trustedPolicyDomains: ["policies.google.com"],
  },
  {
    inputDomains: ["sktelecom.com"],
    hints: ["https://privacy.sktelecom.com/view.do?ctg=policy&name=policy"],
    trustedPolicyDomains: ["privacy.sktelecom.com"],
  },
  {
    inputDomains: ["kt.com"],
    hints: ["https://inside.kt.com/html/privacy/privacy12.html"],
    trustedPolicyDomains: ["inside.kt.com"],
  },
  {
    inputDomains: ["ncsoft.com", "nc.com", "plaync.com"],
    hints: ["https://m.kr.ncsoft.com/kr/privacy.do"],
    trustedPolicyDomains: ["ncsoft.com", "plaync.com"],
  },
  {
    inputDomains: ["netmarble.net", "netmarble.com"],
    hints: [
      "https://help.netmarble.com/ko/terms/privacy_policy_ko?lcLocale=ko&locale=ko",
    ],
    trustedPolicyDomains: ["help.netmarble.com"],
  },
  {
    inputDomains: ["coupang.com"],
    hints: ["https://www.coupang.com/np/policies/privacy"],
    trustedPolicyDomains: ["privacy.coupang.com", "coupang.com"],
  },
  {
    inputDomains: ["hyundai.com"],
    hints: ["https://privacy.hyundai.com/overview/full-policy"],
    trustedPolicyDomains: ["privacy.hyundai.com"],
  },
  {
    inputDomains: ["kia.com"],
    hints: ["https://privacy.kia.com/overview/full-policy/"],
    trustedPolicyDomains: ["privacy.kia.com"],
  },
  {
    inputDomains: ["kakaobank.com"],
    hints: ["https://m.kakaobank.com/PrivacyPolicy;ctg=privacyManagementPolicy"],
    trustedPolicyDomains: ["m.kakaobank.com"],
  },
  {
    inputDomains: ["tmapmobility.com", "tmap.co.kr"],
    hints: ["https://web.tmapmobility.com/policy"],
    trustedPolicyDomains: ["web.tmapmobility.com", "frontman.tmobiapi.com"],
  },
  {
    inputDomains: ["wavve.com"],
    hints: ["https://www.wavve.com/customer/agreement"],
    trustedPolicyDomains: ["wavve.com", "apis.wavve.com"],
  },
  {
    inputDomains: ["tving.com"],
    hints: ["https://www.tving.com/policy/privacy"],
    trustedPolicyDomains: ["tving.com", "api.tving.com"],
  },
  {
    inputDomains: ["sooplive.co.kr", "sooplive.com"],
    hints: ["https://res.sooplive.com/policy/policy2.html"],
    trustedPolicyDomains: ["res.sooplive.com"],
  },
  {
    inputDomains: ["socar.kr"],
    hints: [],
    trustedPolicyDomains: ["socar-docs.zendesk.com"],
  },
  {
    inputDomains: ["yanolja.com", "nol-universe.com"],
    hints: ["https://m.policy.yanolja.com?t=privacy&d=m"],
    trustedPolicyDomains: ["m.policy.yanolja.com"],
  },
  {
    inputDomains: ["lguplus.com"],
    hints: ["https://privacy.lguplus.com/privacy/info/v1/1"],
    trustedPolicyDomains: ["privacy.lguplus.com"],
  },
];

export function hostnameMatchesDomain(hostname: string, domain: string) {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  const normalizedDomain = domain.toLowerCase().replace(/^\./, "").replace(/\.$/, "");
  return (
    normalizedHostname === normalizedDomain ||
    normalizedHostname.endsWith(`.${normalizedDomain}`)
  );
}

export function findPolicySourceProfile(url: URL) {
  return profiles.find((profile) =>
    profile.inputDomains.some((domain) =>
      hostnameMatchesDomain(url.hostname, domain),
    ),
  );
}

export function registeredPolicyHints(url: URL) {
  const profile = findPolicySourceProfile(url);
  if (!profile) return [];
  return profile.hints.map((hint) => new URL(hint));
}

export function isRegisteredPolicyHost(inputUrl: URL, candidateUrl: URL) {
  const profile = findPolicySourceProfile(inputUrl);
  return Boolean(
    profile?.trustedPolicyDomains?.some((domain) =>
      hostnameMatchesDomain(candidateUrl.hostname, domain),
    ),
  );
}
