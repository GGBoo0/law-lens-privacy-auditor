/** Cloudflare Worker entry point for the vinext-starter template. */
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  RATE_LIMIT_HMAC_SECRET?: string;
}

const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;

function clientAddress(request: Request) {
  // Cloudflare removes and sets this header at the trusted edge. Forwarded
  // headers supplied by clients are not accepted as a rate-limit identity.
  const address = request.headers.get("cf-connecting-ip");
  return address ? normalizeClientNetwork(address) : null;
}

function normalizedIpv4(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1));
  if (octets.some((octet) => octet < 0 || octet > 255)) return null;
  return octets.join(".");
}

/**
 * Treat one IPv6 /64 as a client bucket. Without this normalization a caller
 * can rotate the lower 64 bits and create an effectively unlimited number of
 * D1 rows while remaining on the same typical subscriber network.
 */
export function normalizeClientNetwork(rawValue: string) {
  const value = rawValue.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const ipv4 = normalizedIpv4(value);
  if (ipv4) return ipv4;
  if (!value.includes(":")) return value.slice(0, 128) || "anonymous";

  let address = value;
  let embeddedIpv4: string | null = null;
  const lastColon = address.lastIndexOf(":");
  if (lastColon >= 0 && address.slice(lastColon + 1).includes(".")) {
    embeddedIpv4 = normalizedIpv4(address.slice(lastColon + 1));
    if (!embeddedIpv4) return value.slice(0, 128);
    const octets = embeddedIpv4.split(".").map(Number);
    const pair = [
      ((octets[0] << 8) | octets[1]).toString(16),
      ((octets[2] << 8) | octets[3]).toString(16),
    ];
    address = `${address.slice(0, lastColon)}:${pair.join(":")}`;
  }

  const compressedParts = address.split("::");
  if (compressedParts.length > 2) return value.slice(0, 128);
  const left = compressedParts[0] ? compressedParts[0].split(":") : [];
  const right = compressedParts.length === 2 && compressedParts[1]
    ? compressedParts[1].split(":")
    : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return value.slice(0, 128);
  }
  const missing = 8 - left.length - right.length;
  if (
    missing < 0 ||
    (compressedParts.length === 1 && missing !== 0) ||
    (compressedParts.length === 2 && missing < 1)
  ) {
    return value.slice(0, 128);
  }
  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ].map((part) => part.padStart(4, "0"));

  // IPv4-mapped IPv6 addresses should share the ordinary IPv4 bucket rather
  // than collapsing every mapped address into 0000:0000:0000:0000::/64.
  if (
    embeddedIpv4 &&
    groups.slice(0, 5).every((part) => part === "0000") &&
    groups[5] === "ffff"
  ) {
    return embeddedIpv4;
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

async function hashClientAddress(value: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const rotationDay = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`lawlens-rate-v2:${rotationDay}:${value}`),
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function takeDurableRateLimit(
  request: Request,
  database: D1Database,
  secret: string,
) {
  const now = Date.now();
  const clientNetwork = clientAddress(request);
  if (!clientNetwork) throw new Error("trusted client address is unavailable");
  const clientKey = await hashClientAddress(clientNetwork, secret);
  const row = await database
    .prepare(
      `INSERT INTO rate_windows (client_key, request_count, reset_at)
       VALUES (?1, 1, ?2)
       ON CONFLICT(client_key) DO UPDATE SET
         request_count = CASE
           WHEN rate_windows.reset_at <= ?3 THEN 1
           ELSE rate_windows.request_count + 1
         END,
         reset_at = CASE
           WHEN rate_windows.reset_at <= ?3 THEN excluded.reset_at
           ELSE rate_windows.reset_at
         END
       RETURNING request_count, reset_at`,
    )
    .bind(clientKey, now + RATE_WINDOW_MS, now)
    .first<{ request_count: number; reset_at: number }>();

  await database
    .prepare("DELETE FROM rate_windows WHERE reset_at < ?1")
    .bind(now)
    .run();
  if (!row || row.request_count <= RATE_LIMIT) return null;
  return Math.max(1, Math.ceil((row.reset_at - now) / 1_000));
}

function rateLimitResponse(retryAfter: number) {
  return Response.json(
    { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "Retry-After": String(retryAfter),
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function rateLimitUnavailableResponse() {
  return Response.json(
    { error: "요청 보호 시스템을 확인하고 있습니다. 잠시 후 다시 시도해 주세요." },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "Retry-After": "60",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 이 앱은 next/image를 사용하지 않습니다. 불필요한 이미지 파서 공격면을
    // 열지 않도록 템플릿의 동적 최적화 엔드포인트를 명시적으로 비활성화합니다.
    if (url.pathname === "/_vinext/image") {
      return new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    }

    if (url.pathname === "/api/analyze" && request.method === "POST") {
      try {
        if (!env.DB || !env.RATE_LIMIT_HMAC_SECRET) {
          return rateLimitUnavailableResponse();
        }
        const retryAfter = await takeDurableRateLimit(
          request,
          env.DB,
          env.RATE_LIMIT_HMAC_SECRET,
        );
        if (retryAfter !== null) return rateLimitResponse(retryAfter);
      } catch {
        // 전역 제한 저장소가 고장 난 상태에서 인스턴스별 메모리 제한으로
        // 우회 가능하게 두지 않고, 짧게 실패시켜 보호 상태를 유지합니다.
        return rateLimitUnavailableResponse();
      }
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
