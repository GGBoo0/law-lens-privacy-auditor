/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;

function clientAddress(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "anonymous"
  );
}

async function hashClientAddress(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`lawlens-rate-v1:${value}`),
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function takeDurableRateLimit(request: Request, database?: D1Database) {
  if (!database) return null;
  const now = Date.now();
  const clientKey = await hashClientAddress(clientAddress(request));
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

  if (clientKey.charCodeAt(0) % 20 === 0) {
    await database
      .prepare("DELETE FROM rate_windows WHERE reset_at < ?1")
      .bind(now - RATE_WINDOW_MS)
      .run();
  }
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

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (url.pathname === "/api/analyze" && request.method === "POST" && env.DB) {
      try {
        const retryAfter = await takeDurableRateLimit(request, env.DB);
        if (retryAfter !== null) return rateLimitResponse(retryAfter);
      } catch {
        // 마이그레이션이 아직 적용되지 않은 짧은 구간에는 API 내부의
        // 메모리 제한을 그대로 사용해 공개 엔드포인트를 보호합니다.
      }
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
