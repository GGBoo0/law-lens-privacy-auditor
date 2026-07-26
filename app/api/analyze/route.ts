import { analyzePrivacyPolicy } from "../../../lib/privacy-analyzer";
import {
  assertPublicDns,
  normalizeAndAssertPublicUrl,
  readUtf8Stream,
} from "../../../lib/network-security";

export const runtime = "edge";

const MAX_HTML_CHARS = 700_000;
const MAX_POLICY_CHARS = 180_000;
const MAX_REDIRECTS = 3;
const MAX_REQUEST_BYTES = 350_000;
const MAX_RESPONSE_BYTES = 1_500_000;
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;

const rateWindows = new Map<string, { count: number; resetAt: number }>();

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

function takeRateLimit(request: Request) {
  const key =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "anonymous";
  const now = Date.now();
  const existing = rateWindows.get(key);
  if (!existing || existing.resetAt <= now) {
    rateWindows.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }
  existing.count += 1;
  if (existing.count <= RATE_LIMIT) return null;
  return Math.max(1, Math.ceil((existing.resetAt - now) / 1_000));
}

function pruneRateWindows() {
  if (rateWindows.size < 2_000) return;
  const now = Date.now();
  for (const [key, value] of rateWindows) {
    if (value.resetAt <= now) rateWindows.delete(key);
  }
}

async function fetchHtml(initialUrl: URL) {
  let current = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    current = normalizeAndAssertPublicUrl(current);
    await assertPublicDns(current);
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.6",
        "User-Agent":
          "LawLens-PrivacyPolicy-Checker/1.0 (+public privacy policy review)",
      },
      signal: AbortSignal.timeout(14_000),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("사이트의 이동 주소가 비어 있습니다.");
      current = normalizeAndAssertPublicUrl(new URL(location, current));
      continue;
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
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
        throw new Error(
          "PDF 방침은 현재 자동 추출할 수 없습니다. PDF의 텍스트를 복사해 원문 입력 탭에 붙여 넣어 주세요.",
        );
      }
      throw new Error("HTML 또는 텍스트로 공개된 방침만 자동 추출할 수 있습니다.");
    }

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error("페이지가 너무 커서 안전하게 분석할 수 없습니다.");
    }

    const html = (
      await readUtf8Stream(
        response.body,
        MAX_RESPONSE_BYTES,
        "페이지가 너무 커서 안전하게 분석할 수 없습니다.",
      )
    ).slice(0, MAX_HTML_CHARS);
    return { html, finalUrl: current };
  }
  throw new Error("페이지 이동 횟수가 너무 많습니다.");
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
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(
        /<(script|style|noscript|svg|canvas|template|iframe)\b[\s\S]*?<\/\1>/gi,
        " ",
      )
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
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

function extractLinks(html: string, baseUrl: URL) {
  const links: Array<{ url: URL; text: string; score: number }> = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let inspected = 0;

  while ((match = anchorPattern.exec(html)) && inspected < 900) {
    inspected++;
    const attributes = match[1];
    const href =
      /\bhref\s*=\s*"([^"]+)"/i.exec(attributes)?.[1] ||
      /\bhref\s*=\s*'([^']+)'/i.exec(attributes)?.[1] ||
      /\bhref\s*=\s*([^\s>]+)/i.exec(attributes)?.[1];
    if (!href || /^(?:#|javascript:|mailto:|tel:)/i.test(href)) continue;

    try {
      const url = new URL(decodeEntities(href), baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      const text = stripHtml(match[2]).slice(0, 180);
      const haystack = `${text} ${url.pathname} ${url.search}`.toLowerCase();
      let score = 0;
      if (/개인정보\s*처리\s*방침/.test(haystack)) score += 18;
      if (/개인정보\s*보호\s*정책/.test(haystack)) score += 15;
      if (/privacy[\s_-]*policy/.test(haystack)) score += 15;
      if (/privacy/.test(haystack)) score += 8;
      if (/개인정보/.test(haystack)) score += 8;
      if (/policy|정책|방침/.test(haystack)) score += 4;
      if (url.hostname === baseUrl.hostname) score += 3;
      if (/terms|이용약관|location|위치정보|marketing|광고/.test(haystack)) {
        score -= 5;
      }
      if (score >= 6) links.push({ url, text, score });
    } catch {
      // Ignore malformed page-authored links.
    }
  }

  return links.sort((a, b) => b.score - a.score);
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
    /개인정보\s*(?:처리|수집[·ㆍ\s]*이용)\s*목적/i,
    /개인정보\s*(?:처리\s*및\s*)?보유\s*기간/i,
    /정보주체(?:와\s*법정대리인)?의?\s*권리/i,
    /개인정보\s*보호\s*책임자/i,
  ].filter((pattern) => pattern.test(text)).length;

  return (
    text.length >= 500 &&
    (urlSignal ||
      Boolean(
        policyHeading &&
          policyHeading.index < 3200 &&
          contentSignals >= 2,
      ))
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

    pruneRateWindows();
    const retryAfter = takeRateLimit(request);
    if (retryAfter !== null) {
      return json(
        { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return json({ error: "입력 내용이 너무 큽니다." }, 413);
    }

    let body: { url?: unknown; text?: unknown };
    try {
      const rawBody = await readUtf8Stream(
        request.body,
        MAX_REQUEST_BYTES,
        "입력 내용이 너무 큽니다.",
      );
      body = JSON.parse(rawBody) as { url?: unknown; text?: unknown };
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
        analyzePrivacyPolicy(text, {
          policyTitle: "직접 입력한 개인정보처리방침",
          retrievedAt: new Date().toISOString(),
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

    const first = await fetchHtml(inputUrl);
    const firstText = stripHtml(first.html);
    let policyHtml = first.html;
    let policyText = firstText;
    let policyUrl = first.finalUrl;

    if (!looksLikePolicy(firstText, first.finalUrl)) {
      const candidates = extractLinks(first.html, first.finalUrl);
      if (!candidates.length) {
        return json(
          {
            error:
              "홈페이지에서 개인정보처리방침 링크를 찾지 못했습니다. 방침의 직접 주소를 넣거나 원문을 붙여 넣어 주세요.",
          },
          422,
        );
      }

      let lastError: unknown;
      for (const candidate of candidates.slice(0, 3)) {
        try {
          const fetched = await fetchHtml(candidate.url);
          const candidateText = stripHtml(fetched.html);
          if (candidateText.length >= 500) {
            policyHtml = fetched.html;
            policyText = candidateText;
            policyUrl = fetched.finalUrl;
            lastError = undefined;
            break;
          }
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError && policyText === firstText) throw lastError;
    }

    if (policyText.length < 500) {
      return json(
        {
          error:
            "추출된 방침 내용이 너무 짧습니다. 자바스크립트로만 표시되는 페이지라면 원문을 직접 붙여 넣어 주세요.",
        },
        422,
      );
    }

    return json(
      analyzePrivacyPolicy(policyText, {
        sourceUrl: inputUrl.toString(),
        policyUrl: policyUrl.toString(),
        policyTitle:
          extractTitle(policyHtml) ||
          `${policyUrl.hostname} 개인정보처리방침`,
        retrievedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "TimeoutError"
        ? "사이트 응답 시간이 초과됐습니다. 방침 원문을 직접 붙여 넣어 주세요."
        : error instanceof Error
          ? error.message
          : "분석 중 알 수 없는 오류가 발생했습니다.";
    return json({ error: message }, 502);
  }
}
