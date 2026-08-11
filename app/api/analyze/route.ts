import {
  analyzePrivacyPolicy,
  type ContextChoice,
  type ContextKey,
  type ContextOverrides,
} from "../../../lib/privacy-analyzer";
import {
  normalizeAndAssertPublicUrl,
  readTextStream,
  readUtf8Stream,
} from "../../../lib/network-security";
import {
  hostnameMatchesDomain,
  isRegisteredPolicyHost,
  registeredPolicyHints,
} from "../../../lib/policy-source-registry";
import * as psl from "psl";
import fallbackRuntimeLegalManifest from "../../../data/legal-runtime-manifest.json";
import { extractStructuredTables } from "../../../lib/html-table-extractor";

export const runtime = "edge";

const MAX_HTML_CHARS = 1_450_000;
const MAX_POLICY_CHARS = 180_000;
const MAX_REDIRECTS = 3;
const MAX_REQUEST_BYTES = 350_000;
const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_METADATA_BYTES = 1_200_000;
const MAX_DISCOVERY_DEPTH = 3;
const MAX_DISCOVERY_PAGES = 12;
const MAX_CANDIDATES_PER_PAGE = 10;
const MAX_DISCOVERY_MS = 25_000;
const LEGAL_RUNTIME_MANIFEST_URL =
  "https://raw.githubusercontent.com/GGBoo0/law-lens-privacy-auditor/automation/legal-monitor-status/data/legal-runtime-manifest.json";
const LEGAL_RUNTIME_MANIFEST_CACHE_MS = 5 * 60 * 1000;

let runtimeLegalManifestCache: {
  expiresAt: number;
  value: unknown;
} | null = null;
const contextKeys: ContextKey[] = [
  "thirdParty",
  "outsourcing",
  "overseas",
  "foreignController",
  "dataPortability",
  "children",
  "cookies",
  "ecommerce",
  "ai",
  "automatedDecision",
];
const contextChoices: ContextChoice[] = ["auto", "yes", "no"];

type AnalysisErrorCode =
  | "site_blocked"
  | "policy_not_found"
  | "unsupported_format"
  | "source_timeout";

class AnalysisError extends Error {
  constructor(
    readonly code: AnalysisErrorCode,
    message: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}

function hostnameMatches(url: URL, domain: string) {
  return hostnameMatchesDomain(url.hostname, domain);
}

function json(data: unknown, status = 200, extraHeaders?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...extraHeaders,
    },
  });
}

function sameOriginRequest(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return false;
  }
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function normalizeContextOverrides(value: unknown): ContextOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return Object.fromEntries(
    contextKeys.flatMap((key) => {
      const choice = input[key];
      return contextChoices.includes(choice as ContextChoice)
        ? [[key, choice as ContextChoice]]
        : [];
    }),
  ) as ContextOverrides;
}

async function documentHash(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadRuntimeLegalManifest() {
  const now = Date.now();
  if (runtimeLegalManifestCache && runtimeLegalManifestCache.expiresAt > now) {
    return runtimeLegalManifestCache.value;
  }

  // Test and offline QA runs must be deterministic and must not inherit the
  // currently deployed status branch while a new ruleset is being validated.
  if (process.env.LAW_LENS_TEST_RUNTIME_MANIFEST === "bundled") {
    runtimeLegalManifestCache = {
      expiresAt: now + LEGAL_RUNTIME_MANIFEST_CACHE_MS,
      value: fallbackRuntimeLegalManifest,
    };
    return fallbackRuntimeLegalManifest;
  }

  let value: unknown;
  let cacheMilliseconds = LEGAL_RUNTIME_MANIFEST_CACHE_MS;
  try {
    const response = await fetch(LEGAL_RUNTIME_MANIFEST_URL, {
      headers: {
        accept: "application/json",
        "user-agent": "LawLensPrivacyKR/1.0",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    value = await response.json();
  } catch {
    // Reuse the last live value only while its own 36-hour freshness gate
    // permits it. A cold start with no live manifest passes invalid data so the
    // analyzer conservatively defers every legal conclusion.
    value =
      runtimeLegalManifestCache?.value ??
      {
        unavailable: true,
        reason: "live legal runtime manifest could not be loaded",
      };
    cacheMilliseconds = 30_000;
  }

  runtimeLegalManifestCache = {
    expiresAt: now + cacheMilliseconds,
    value,
  };
  return value;
}

async function buildAnalysis(
  text: string,
  meta: Parameters<typeof analyzePrivacyPolicy>[1],
) {
  const runtimeLegalManifest =
    meta.runtimeLegalManifest ?? (await loadRuntimeLegalManifest());
  return {
    ...analyzePrivacyPolicy(text, { ...meta, runtimeLegalManifest }),
    documentHash: await documentHash(text),
  };
}

async function fetchHtml(initialUrl: URL) {
  let current = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    current = normalizeAndAssertPublicUrl(current);
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.6",
        "User-Agent":
          "LawLens-PrivacyPolicy-Checker/1.0 (+public privacy policy review)",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("사이트의 이동 주소가 비어 있습니다.");
      current = normalizeAndAssertPublicUrl(new URL(location, current));
      continue;
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AnalysisError(
          "site_blocked",
          "사이트가 자동 수집을 차단했습니다. 개인정보처리방침 원문을 직접 붙여 넣어 주세요.",
        );
      }
      throw new Error(
        `웹페이지를 불러오지 못했습니다(HTTP ${response.status}). 원문 직접 입력을 이용해 주세요.`,
      );
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/plain")
    ) {
      if (contentType.includes("pdf")) {
        throw new AnalysisError(
          "unsupported_format",
          "PDF 방침은 현재 자동 추출할 수 없습니다. PDF의 텍스트를 복사해 원문 입력 탭에 붙여 넣어 주세요.",
        );
      }
      throw new Error("HTML 또는 텍스트로 공개된 방침만 자동 추출할 수 있습니다.");
    }

    const charset = /charset\s*=\s*([^;\s]+)/i.exec(contentType)?.[1];
    const html = (
      await readTextStream(
        response.body,
        MAX_RESPONSE_BYTES,
        "페이지가 너무 커서 안전하게 분석할 수 없습니다.",
        { encoding: charset, truncate: true },
      )
    ).slice(0, MAX_HTML_CHARS);
    return { html, finalUrl: current };
  }
  throw new Error("페이지 이동 횟수가 너무 많습니다.");
}

async function fetchMetadataText(initialUrl: URL) {
  let current = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    current = normalizeAndAssertPublicUrl(current);
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "application/json,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.2",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.6",
        "User-Agent":
          "LawLens-PrivacyPolicy-Checker/1.0 (+public privacy policy review)",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("사이트의 이동 주소가 비어 있습니다.");
      current = normalizeAndAssertPublicUrl(new URL(location, current));
      continue;
    }
    if (!response.ok) {
      throw new Error(`공개 메타데이터를 불러오지 못했습니다(HTTP ${response.status}).`);
    }

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_METADATA_BYTES) {
      throw new Error("공개 메타데이터가 너무 큽니다.");
    }
    return {
      text: await readUtf8Stream(
        response.body,
        MAX_METADATA_BYTES,
        "공개 메타데이터가 너무 큽니다.",
      ),
      finalUrl: current,
    };
  }
  throw new Error("공개 메타데이터의 이동 횟수가 너무 많습니다.");
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    middot: "·",
    bull: "•",
  };
  return value
    .replace(/&([a-z]+);/gi, (entity, name: string) => named[name.toLowerCase()] ?? entity)
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function stripHtml(html: string) {
  return decodeEntities(
    extractStructuredTables(html, { maxOutputChars: MAX_POLICY_CHARS })
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(
        /<(script|style|noscript|svg|canvas|template|iframe)\b[\s\S]*?<\/\1>/gi,
        " ",
      )
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<\/(?:th|td)>/gi, " | ")
      .replace(
        /<\/(p|div|section|article|main|header|footer|li|tr|h[1-6]|table|ul|ol|dl|dt|dd)>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_POLICY_CHARS);
}

function extractTitle(html: string) {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return stripHtml(h1 || title || "").slice(0, 140);
}

type PolicyCandidate = { url: URL; text: string; score: number };

function decodeEmbeddedUrl(value: string) {
  return decodeEntities(value)
    .replace(/\\u002f/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u003a/gi, ":")
    .replace(/\\\//g, "/");
}

function scorePolicyCandidate(
  url: URL,
  text: string,
  baseUrl: URL,
  source: "anchor" | "frame" | "embedded",
) {
  const haystack = `${text} ${url.pathname} ${url.search}`.toLowerCase();
  let score = source === "frame" ? 4 : source === "embedded" ? 1 : 0;
  if (/개인정보\s*처리\s*방침/.test(haystack)) score += 18;
  if (/개인정보\s*보호\s*정책/.test(haystack)) score += 15;
  if (/privacy[\s_-]*policy/.test(haystack)) score += 15;
  if (/policywrapper|policytype|privacy(?:detail|content)/.test(haystack)) {
    score += 12;
  }
  if (/privacy/.test(haystack)) score += 8;
  if (/개인정보/.test(haystack)) score += 8;
  if (/policy|정책|방침/.test(haystack)) score += 4;
  if (url.hostname === baseUrl.hostname) score += 3;
  if (/terms|이용약관|location|위치정보|marketing|광고/.test(haystack)) {
    score -= 5;
  }
  return score;
}

function extractLinks(html: string, baseUrl: URL) {
  const links = new Map<string, PolicyCandidate>();

  const addCandidate = (
    rawUrl: string,
    text: string,
    source: "anchor" | "frame" | "embedded",
  ) => {
    if (!rawUrl || /^(?:#|javascript:|mailto:|tel:|data:)/i.test(rawUrl)) return;
    try {
      const url = new URL(decodeEmbeddedUrl(rawUrl), baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) return;
      url.hash = "";
      const score = scorePolicyCandidate(url, text, baseUrl, source);
      if (score < 6) return;
      const key = url.toString();
      const existing = links.get(key);
      if (!existing || existing.score < score) {
        links.set(key, { url, text, score });
      }
    } catch {
      // Ignore malformed page-authored links.
    }
  };

  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let inspected = 0;

  while ((match = anchorPattern.exec(html)) && inspected < 4_000) {
    inspected++;
    const attributes = match[1];
    const href =
      /\bhref\s*=\s*"([^"]+)"/i.exec(attributes)?.[1] ||
      /\bhref\s*=\s*'([^']+)'/i.exec(attributes)?.[1] ||
      /\bhref\s*=\s*([^\s>]+)/i.exec(attributes)?.[1];
    const accessibleLabel =
      /\baria-label\s*=\s*"([^"]+)"/i.exec(attributes)?.[1] ||
      /\baria-label\s*=\s*'([^']+)'/i.exec(attributes)?.[1] ||
      /\btitle\s*=\s*"([^"]+)"/i.exec(attributes)?.[1] ||
      /\btitle\s*=\s*'([^']+)'/i.exec(attributes)?.[1] ||
      "";
    if (href) {
      addCandidate(
        href,
        `${stripHtml(match[2]).slice(0, 180)} ${decodeEntities(accessibleLabel)}`,
        "anchor",
      );
    }
  }

  const framePattern = /<(?:iframe|frame)\b([^>]*)>/gi;
  inspected = 0;
  while ((match = framePattern.exec(html)) && inspected < 120) {
    inspected++;
    const attributes = match[1];
    const src =
      /\bsrc\s*=\s*"([^"]+)"/i.exec(attributes)?.[1] ||
      /\bsrc\s*=\s*'([^']+)'/i.exec(attributes)?.[1] ||
      /\bsrc\s*=\s*([^\s>]+)/i.exec(attributes)?.[1];
    if (src) addCandidate(src, "embedded policy document", "frame");
  }

  const dataLinkPattern = /\bdata-(?:href|url|link)\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  inspected = 0;
  while ((match = dataLinkPattern.exec(html)) && inspected < 300) {
    inspected++;
    const rawUrl = match[1] || match[2];
    if (rawUrl) addCandidate(rawUrl, "embedded page link", "embedded");
  }

  const quotedPathPattern = /["']((?:https?:)?\\?\/\\?\/[^"'<>\s]+|\\?\/[^"'<>\s]+)["']/gi;
  inspected = 0;
  while ((match = quotedPathPattern.exec(html)) && inspected < 1_200) {
    inspected++;
    const rawUrl = decodeEmbeddedUrl(match[1]);
    const nearby = html.slice(Math.max(0, match.index - 100), match.index + match[0].length + 100);
    if (/privacy|policy|개인정보|처리방침/i.test(`${rawUrl} ${nearby}`)) {
      addCandidate(rawUrl, stripHtml(nearby).slice(0, 180), "embedded");
    }
  }

  return [...links.values()].sort((a, b) => b.score - a.score);
}

function looksLikePolicy(text: string, url: URL) {
  const policyHeading =
    /개인정보\s*처리\s*방침|개인정보\s*보호\s*정책|privacy\s*policy/i.exec(
      text.slice(0, 4000),
    );
  const urlSignal =
    /privacy|개인정보|policy/i.test(
      `${url.pathname}${url.search}`,
    );
  const contentSignals = [
    /개인정보(?:의)?\s*(?:처리|수집[·ㆍ\s]*이용)\s*목적|purposes?\s+of\s+(?:the\s+)?processing|how\s+we\s+use/i,
    /개인정보(?:의)?\s*(?:처리\s*및\s*)?보유\s*기간|retention\s+period|how\s+long\s+we\s+(?:keep|retain)/i,
    /처리하는\s*개인정보(?:의)?\s*항목|수집(?:하는)?\s*개인정보\s*항목|information\s+we\s+collect|categories\s+of\s+personal\s+(?:data|information)/i,
    /개인정보(?:의)?\s*제3자\s*제공|third[-\s]party\s+(?:sharing|disclosure)|share\s+.*personal\s+(?:data|information)/i,
    /개인정보\s*처리\s*위탁|service\s+providers?|data\s+processors?/i,
    /개인정보(?:의)?\s*파기|delet(?:e|ion)|destruction\s+of\s+personal/i,
    /정보주체(?:와\s*법정대리인)?의?\s*권리|your\s+(?:privacy\s+)?rights|data\s+subject\s+rights/i,
    /개인정보\s*보호\s*책임자|data\s+protection\s+officer|privacy\s+contact/i,
  ].filter((pattern) => pattern.test(text)).length;

  const strongDocumentSignal =
    text.length >= 1_500 &&
    Boolean(policyHeading && policyHeading.index < 4_000) &&
    urlSignal &&
    (text.match(/privacy|개인정보/gi)?.length ?? 0) >= 5;

  return strongDocumentSignal || (
    text.length >= 500 &&
    contentSignals >= 2 &&
    (urlSignal || Boolean(policyHeading && policyHeading.index < 3200))
  );
}

function knownPolicyHints(inputUrl: URL) {
  return registeredPolicyHints(inputUrl).filter(
    (hint) => hint.toString() !== inputUrl.toString(),
  );
}

function commonPolicyHints(inputUrl: URL) {
  const origin = new URL("/", inputUrl);
  return [
    "/privacy",
    "/privacy-policy",
    "/policy/privacy",
    "/policy/privacy-policy",
    "/info/privacy",
    "/terms/privacy",
    "/privacy/policy",
    "/legal/privacy",
    "/support/privacy",
    "/customer/privacy",
    "/privacy.do",
  ].map((pathname) => new URL(pathname, origin));
}

function registrableDomain(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return psl.get(normalized) || normalized;
}

function isPolicyContextMatch(
  inputUrl: URL,
  candidateUrl: URL,
  directInput: boolean,
) {
  const candidateContext = `${candidateUrl.hostname}${candidateUrl.pathname}`;
  if (
    /(?:^|[./_-])(career|careers|recruit|recruitment|jobs?|hiring)(?:[./_-]|$)/i.test(
      candidateContext,
    ) &&
    !/(career|recruit|jobs?)/i.test(`${inputUrl.hostname}${inputUrl.pathname}`)
  ) {
    return false;
  }

  if (
    directInput &&
    /privacy|policy|개인정보|처리방침/i.test(`${inputUrl.pathname}${inputUrl.search}`)
  ) {
    return true;
  }
  if (registrableDomain(inputUrl.hostname) === registrableDomain(candidateUrl.hostname)) {
    return true;
  }
  return isRegisteredPolicyHost(inputUrl, candidateUrl);
}

function uniquePath(path: string[]) {
  return [...new Set(path)];
}

async function discoverTossPolicy(inputUrl: URL) {
  if (!hostnameMatches(inputUrl, "toss.im")) return null;

  const policyUrl = new URL("https://toss.im/privacy-policy");
  const apiUrl = new URL(
    "https://api-public.toss.im/api-public/v3/ipd-thor/api/v1/workspaces/12/posts?category_ids=325&size=1",
  );
  const response = await fetchMetadataText(apiUrl);
  const payload = JSON.parse(response.text) as {
    success?: {
      results?: Array<{
        title?: unknown;
        fullDescription?: unknown;
      }>;
    };
  };
  const current = payload.success?.results?.[0];
  if (!current || typeof current.fullDescription !== "string") return null;

  const html = current.fullDescription;
  const text = stripHtml(html);
  if (!looksLikePolicy(text, policyUrl)) return null;
  return {
    html,
    text,
    url: policyUrl,
    title:
      typeof current.title === "string"
        ? stripHtml(current.title).trim()
        : "토스 개인정보처리방침",
    path: uniquePath([inputUrl.toString(), policyUrl.toString()]),
  };
}

async function discoverBaeminPolicy(inputUrl: URL) {
  if (!hostnameMatches(inputUrl, "baemin.com")) return null;

  const termsCode =
    /^\/content\/(BAEMIN_\d+)/i.exec(inputUrl.pathname)?.[1]?.toUpperCase() ||
    "BAEMIN_102";
  const landingUrl = new URL(
    `https://terms.baemin.com/content/${termsCode}?shotList=true`,
  );
  const apiUrl = new URL("https://terms-api.baemin.com/v1/terms/current");
  apiUrl.searchParams.set("termsCode", termsCode);
  const response = await fetchMetadataText(apiUrl);
  const payload = JSON.parse(response.text) as {
    data?: { title?: unknown; contentTitle?: unknown; url?: unknown };
  };
  const sourceUrl =
    typeof payload.data?.url === "string"
      ? normalizeAndAssertPublicUrl(payload.data.url)
      : null;
  if (!sourceUrl || sourceUrl.hostname !== "terms.baemin.com") return null;

  const fetched = await fetchHtml(sourceUrl);
  const text = stripHtml(fetched.html);
  if (!looksLikePolicy(text, landingUrl)) return null;
  const titleParts = [payload.data?.title, payload.data?.contentTitle].filter(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
  return {
    html: fetched.html,
    text,
    url: fetched.finalUrl,
    title: titleParts.join(" · ") || "배달의민족 개인정보처리방침",
    path: uniquePath([
      inputUrl.toString(),
      landingUrl.toString(),
      fetched.finalUrl.toString(),
    ]),
  };
}

async function discoverAutomakerPolicy(
  inputUrl: URL,
  brand: "hyundai" | "kia",
) {
  if (!hostnameMatches(inputUrl, `${brand}.com`)) return null;

  const apiOrigin = `https://privacy-web-api-kr.${brand}.com`;
  const landingUrl = new URL(
    brand === "kia"
      ? "https://privacy.kia.com/overview/full-policy/"
      : "https://privacy.hyundai.com/overview/full-policy",
  );
  const listUrl = new URL("/api/web/privacy?type=PI", apiOrigin);
  const listResponse = await fetchMetadataText(listUrl);
  const listPayload = JSON.parse(listResponse.text) as {
    retValue?: { privacyList?: Array<{ sequence?: unknown; seq?: unknown }> };
  };
  const current = listPayload.retValue?.privacyList?.[0];
  const sequence = current?.sequence ?? current?.seq;
  if (typeof sequence !== "number" && typeof sequence !== "string") return null;

  const detailUrl = new URL(`/api/web/privacy/${sequence}`, apiOrigin);
  const detailResponse = await fetchMetadataText(detailUrl);
  const detailPayload = JSON.parse(detailResponse.text) as {
    retValue?: { content?: unknown; title?: unknown };
  };
  if (typeof detailPayload.retValue?.content !== "string") return null;
  const html = detailPayload.retValue.content;
  const text = stripHtml(html);
  if (!looksLikePolicy(text, landingUrl)) return null;
  return {
    html,
    text,
    url: landingUrl,
    title:
      typeof detailPayload.retValue.title === "string"
        ? stripHtml(detailPayload.retValue.title)
        : `${brand === "kia" ? "기아" : "현대자동차"} 개인정보처리방침`,
    path: uniquePath([
      inputUrl.toString(),
      landingUrl.toString(),
      listUrl.toString(),
      detailUrl.toString(),
    ]),
  };
}

async function discoverKakaoBankPolicy(inputUrl: URL) {
  if (!hostnameMatches(inputUrl, "kakaobank.com")) return null;
  const landingUrl = new URL(
    "https://m.kakaobank.com/PrivacyPolicy;ctg=privacyManagementPolicy",
  );
  const apiUrl = new URL(
    "https://m.kakaobank.com/api/v1/template/corp?g=policy&s=privacyManagementPolicy",
  );
  const response = await fetchMetadataText(apiUrl);
  const html = response.text;
  const text = stripHtml(html);
  if (!looksLikePolicy(text, landingUrl)) return null;
  return {
    html,
    text,
    url: landingUrl,
    title: "카카오뱅크 개인정보처리방침",
    path: uniquePath([inputUrl.toString(), landingUrl.toString(), apiUrl.toString()]),
  };
}

async function discoverTmapPolicy(inputUrl: URL) {
  if (
    !hostnameMatches(inputUrl, "tmapmobility.com") &&
    !hostnameMatches(inputUrl, "tmap.co.kr")
  ) {
    return null;
  }

  const homepage = await fetchHtml(inputUrl);
  const matches = [...homepage.html.matchAll(/externalCode=([a-f\d]{64})/gi)];
  const preferred = matches.find((match) =>
    /개인|privacy/i.test(
      homepage.html.slice(Math.max(0, match.index - 240), match.index + 120),
    ),
  );
  const externalCode = preferred?.[1] || matches.at(-1)?.[1];
  if (!externalCode) return null;

  const landingUrl = new URL("https://web.tmapmobility.com/policy/detail");
  landingUrl.searchParams.set("externalCode", externalCode);
  landingUrl.searchParams.set("headerYn", "n");
  landingUrl.searchParams.set("prevShowYn", "Y");
  const apiUrl = new URL(
    `https://frontman.tmobiapi.com/proxy/heimdall-terms/v1/external/code/${externalCode}`,
  );
  const response = await fetchMetadataText(apiUrl);
  const payload = JSON.parse(response.text) as {
    data?: { termsCodeTitle?: unknown; termsCodeDetail?: unknown };
  };
  if (typeof payload.data?.termsCodeDetail !== "string") return null;
  const html = payload.data.termsCodeDetail;
  const title =
    typeof payload.data.termsCodeTitle === "string"
      ? stripHtml(payload.data.termsCodeTitle)
      : "TMAP 개인정보처리방침";
  const text = `${title}\n${stripHtml(html)}`.slice(0, MAX_POLICY_CHARS);
  if (!looksLikePolicy(text, landingUrl)) return null;
  return {
    html,
    text,
    url: landingUrl,
    title,
    path: uniquePath([
      inputUrl.toString(),
      homepage.finalUrl.toString(),
      landingUrl.toString(),
      apiUrl.toString(),
    ]),
  };
}

async function discoverWavvePolicy(inputUrl: URL) {
  if (!hostnameMatches(inputUrl, "wavve.com")) return null;
  const landingUrl = new URL("https://www.wavve.com/customer/agreement");
  const apiUrl = new URL("https://apis.wavve.com/terms?type=privacy&version=last");
  const response = await fetchMetadataText(apiUrl);
  const payload = JSON.parse(response.text) as { content?: unknown; title?: unknown };
  if (typeof payload.content !== "string") return null;
  const html = payload.content;
  const text = stripHtml(html);
  if (!looksLikePolicy(text, landingUrl)) return null;
  return {
    html,
    text,
    url: landingUrl,
    title: typeof payload.title === "string" ? stripHtml(payload.title) : "Wavve 개인정보처리방침",
    path: uniquePath([inputUrl.toString(), landingUrl.toString(), apiUrl.toString()]),
  };
}

async function discoverTvingPolicy(inputUrl: URL) {
  if (!hostnameMatches(inputUrl, "tving.com")) return null;
  const landingUrl = new URL("https://www.tving.com/policy/privacy");
  const apiUrl = new URL("https://api.tving.com/v2/user/policy/agreement/20/");
  const response = await fetchMetadataText(apiUrl);
  const payload = JSON.parse(response.text) as {
    body?: { contents?: unknown; title?: unknown };
  };
  if (typeof payload.body?.contents !== "string") return null;
  const html = payload.body.contents;
  const text = stripHtml(html);
  if (!looksLikePolicy(text, landingUrl)) return null;
  return {
    html,
    text,
    url: landingUrl,
    title:
      typeof payload.body.title === "string"
        ? stripHtml(payload.body.title)
        : "TVING 개인정보처리방침",
    path: uniquePath([inputUrl.toString(), landingUrl.toString(), apiUrl.toString()]),
  };
}

async function discoverSoopPolicy(inputUrl: URL) {
  if (
    !hostnameMatches(inputUrl, "sooplive.co.kr") &&
    !hostnameMatches(inputUrl, "sooplive.com")
  ) {
    return null;
  }
  const landingUrl = new URL("https://res.sooplive.com/policy/policy2.html");
  const wrapper = await fetchHtml(landingUrl);
  const version = /historyOptions\s*=\s*\[\s*['"](\d{8})/i.exec(wrapper.html)?.[1];
  if (!version) return null;
  const contentUrl = new URL(
    `/policy/contents/privacy/ko/${version}.html`,
    landingUrl,
  );
  const fetched = await fetchHtml(contentUrl);
  const text = stripHtml(fetched.html);
  if (!looksLikePolicy(text, landingUrl)) return null;
  return {
    html: fetched.html,
    text,
    url: landingUrl,
    title: extractTitle(fetched.html) || "SOOP 개인정보처리방침",
    path: uniquePath([
      inputUrl.toString(),
      landingUrl.toString(),
      contentUrl.toString(),
    ]),
  };
}

async function discoverKnownDynamicPolicy(inputUrl: URL) {
  const adapter = hostnameMatches(inputUrl, "toss.im")
    ? discoverTossPolicy
    : hostnameMatches(inputUrl, "baemin.com")
      ? discoverBaeminPolicy
      : hostnameMatches(inputUrl, "hyundai.com")
        ? (url: URL) => discoverAutomakerPolicy(url, "hyundai")
        : hostnameMatches(inputUrl, "kia.com")
          ? (url: URL) => discoverAutomakerPolicy(url, "kia")
          : hostnameMatches(inputUrl, "kakaobank.com")
            ? discoverKakaoBankPolicy
            : hostnameMatches(inputUrl, "tmapmobility.com") ||
                hostnameMatches(inputUrl, "tmap.co.kr")
              ? discoverTmapPolicy
              : hostnameMatches(inputUrl, "wavve.com")
                ? discoverWavvePolicy
                : hostnameMatches(inputUrl, "tving.com")
                  ? discoverTvingPolicy
                  : hostnameMatches(inputUrl, "sooplive.co.kr") ||
                      hostnameMatches(inputUrl, "sooplive.com")
                    ? discoverSoopPolicy
                    : null;
  if (!adapter) return null;
  try {
    return await adapter(inputUrl);
  } catch {
    // A public vendor endpoint can change. Continue with generic discovery.
    return null;
  }
}

function parseSitemapLocations(xml: string, baseUrl: URL) {
  const locations: URL[] = [];
  const pattern = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) && locations.length < 2_000) {
    try {
      const value = decodeEntities(match[1].replace(/<[^>]+>/g, "").trim());
      const url = normalizeAndAssertPublicUrl(new URL(value, baseUrl));
      locations.push(url);
    } catch {
      // Ignore malformed or non-public sitemap entries.
    }
  }
  return locations;
}

async function discoverSitemapPolicyLinks(baseUrl: URL) {
  const root = new URL("/", baseUrl);
  const robotsUrl = new URL("/robots.txt", root);
  const defaultSitemap = new URL("/sitemap.xml", root);
  const sitemapUrls: URL[] = [defaultSitemap];

  try {
    const robots = await fetchMetadataText(robotsUrl);
    for (const match of robots.text.matchAll(/^\s*sitemap\s*:\s*(\S+)\s*$/gim)) {
      try {
        sitemapUrls.push(normalizeAndAssertPublicUrl(new URL(match[1], robots.finalUrl)));
      } catch {
        // Ignore malformed or non-public robots entries.
      }
    }
  } catch {
    // robots.txt is optional.
  }

  const candidates: PolicyCandidate[] = [];
  const visited = new Set<string>();
  for (const sitemapUrl of sitemapUrls.slice(0, 3)) {
    if (visited.has(sitemapUrl.toString())) continue;
    visited.add(sitemapUrl.toString());
    try {
      const sitemap = await fetchMetadataText(sitemapUrl);
      const locations = parseSitemapLocations(sitemap.text, sitemap.finalUrl);
      for (const url of locations) {
        const signal = `${url.pathname}${url.search}`;
        if (!/privacy|policy|개인정보|처리방침/i.test(signal)) continue;
        candidates.push({
          url,
          text: "sitemap privacy policy",
          score: scorePolicyCandidate(url, "privacy policy", baseUrl, "embedded") + 8,
        });
      }
    } catch {
      // Sitemaps are opportunistic hints, not a hard dependency.
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 8);
}

type DiscoveryQueueItem = {
  url: URL;
  depth: number;
  score: number;
  path: string[];
};

async function discoverPolicy(inputUrl: URL) {
  const discoveryStartedAt = Date.now();
  const dynamicPolicy = await discoverKnownDynamicPolicy(inputUrl);
  if (dynamicPolicy) return dynamicPolicy;

  const knownHints = knownPolicyHints(inputUrl);
  const queue: DiscoveryQueueItem[] = [
    { url: inputUrl, depth: 0, score: Number.MAX_SAFE_INTEGER, path: [] },
    ...knownHints.map((url) => ({
      url,
      depth: 1,
      score: 100,
      path: [inputUrl.toString()],
    })),
  ];
  const visited = new Set<string>();
  let attempts = 0;
  let firstError: unknown;
  let blockedError: AnalysisError | null = null;

  while (
    queue.length &&
    attempts < MAX_DISCOVERY_PAGES &&
    Date.now() - discoveryStartedAt < MAX_DISCOVERY_MS
  ) {
    queue.sort((a, b) => b.score - a.score);
    const item = queue.shift();
    if (!item) break;

    const normalized = normalizeAndAssertPublicUrl(item.url);
    const key = normalized.toString();
    if (visited.has(key)) continue;
    visited.add(key);
    attempts++;

    try {
      const fetched = await fetchHtml(normalized);
      const finalKey = fetched.finalUrl.toString();
      visited.add(finalKey);
      const text = stripHtml(fetched.html);
      const path = [...item.path, finalKey];

      if (
        looksLikePolicy(text, fetched.finalUrl) &&
        isPolicyContextMatch(inputUrl, fetched.finalUrl, item.depth === 0)
      ) {
        return {
          html: fetched.html,
          text,
          url: fetched.finalUrl,
          path: [...new Set(path)],
        };
      }

      if (item.depth >= MAX_DISCOVERY_DEPTH) continue;
      const candidates = extractLinks(fetched.html, fetched.finalUrl).slice(
        0,
        MAX_CANDIDATES_PER_PAGE,
      );

      if (item.depth === 0 && candidates.length < 4) {
        for (const url of commonPolicyHints(fetched.finalUrl)) {
          candidates.push({
            url,
            text: "common privacy policy path",
            score: scorePolicyCandidate(
              url,
              "privacy policy",
              fetched.finalUrl,
              "embedded",
            ),
          });
        }
      }
      if (item.depth === 0 && candidates.length <= 6 && knownHints.length === 0) {
        candidates.push(...(await discoverSitemapPolicyLinks(fetched.finalUrl)));
      }

      for (const candidate of candidates) {
        if (visited.has(candidate.url.toString())) continue;
        if (!isPolicyContextMatch(inputUrl, candidate.url, false)) continue;
        queue.push({
          url: candidate.url,
          depth: item.depth + 1,
          score: candidate.score,
          path,
        });
      }
    } catch (error) {
      if (attempts === 1) firstError = error;
      if (error instanceof AnalysisError && error.code === "site_blocked") {
        blockedError = error;
      }
    }
  }

  if (attempts === 1 && firstError) throw firstError;
  if (blockedError) throw blockedError;
  throw new AnalysisError(
    "policy_not_found",
    "홈페이지에서 개인정보처리방침 본문을 찾지 못했습니다. 방침의 직접 주소를 넣거나 원문을 붙여 넣어 주세요.",
  );
}

export async function POST(request: Request) {
  try {
    if (!sameOriginRequest(request)) {
      return json({ error: "교차 사이트 요청은 허용되지 않습니다." }, 403);
    }
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) {
      return json({ error: "JSON 요청만 허용됩니다." }, 415);
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return json({ error: "입력 내용이 너무 큽니다." }, 413);
    }

    let body: { url?: unknown; text?: unknown; contexts?: unknown };
    try {
      const rawBody = await readUtf8Stream(
        request.body,
        MAX_REQUEST_BYTES,
        "입력 내용이 너무 큽니다.",
      );
      body = JSON.parse(rawBody) as {
        url?: unknown;
        text?: unknown;
        contexts?: unknown;
      };
    } catch (error) {
      if (error instanceof Error && error.message === "입력 내용이 너무 큽니다.") {
        return json({ error: error.message }, 413);
      }
      return json({ error: "올바른 JSON 요청을 보내 주세요." }, 400);
    }

    if (typeof body.text === "string") {
      const text = body.text.trim().slice(0, MAX_POLICY_CHARS);
      if (text.length < 120) {
        return json({ error: "방침 원문을 120자 이상 입력해 주세요." }, 400);
      }
      return json(
        await buildAnalysis(text, {
          policyTitle: "직접 입력한 개인정보처리방침",
          retrievedAt: new Date().toISOString(),
          contextOverrides: normalizeContextOverrides(body.contexts),
        }),
      );
    }

    if (typeof body.url !== "string" || !body.url.trim()) {
      return json({ error: "분석할 웹사이트 주소를 입력해 주세요." }, 400);
    }

    let inputUrl: URL;
    try {
      inputUrl = normalizeAndAssertPublicUrl(body.url);
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "올바른 웹사이트 주소를 입력해 주세요.",
        },
        400,
      );
    }

    const discovered = await discoverPolicy(inputUrl);
    const policyHtml = discovered.html;
    const policyText = discovered.text;
    const policyUrl = discovered.url;

    if (policyText.length < 500) {
      return json(
        {
          error:
            "추출된 방침 내용이 너무 짧습니다. 자바스크립트로만 표시되는 페이지라면 원문을 직접 붙여 넣어 주세요.",
          code: "policy_not_found",
          canPaste: true,
        },
        422,
      );
    }

    const analysis = await buildAnalysis(policyText, {
      sourceUrl: inputUrl.toString(),
      policyUrl: policyUrl.toString(),
      policyTitle:
        ("title" in discovered && discovered.title) ||
        extractTitle(policyHtml) ||
        `${policyUrl.hostname} 개인정보처리방침`,
      retrievedAt: new Date().toISOString(),
      discoveryPath: discovered.path,
      contextOverrides: normalizeContextOverrides(body.contexts),
    });
    return json({ ...analysis, discoveryPath: discovered.path });
  } catch (error) {
    if (error instanceof AnalysisError) {
      return json(
        { error: error.message, code: error.code, canPaste: true },
        error.status,
      );
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return json(
        {
          error: "사이트 응답 시간이 초과됐습니다. 방침 원문을 직접 붙여 넣어 주세요.",
          code: "source_timeout",
          canPaste: true,
        },
        504,
      );
    }
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "분석 중 알 수 없는 오류가 발생했습니다.",
      },
      502,
    );
  }
}
