import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_STRUCTURED_TABLE_LIMITS,
  extractStructuredTables,
} from "../lib/html-table-extractor.ts";

process.env.LAW_LENS_TEST_RUNTIME_MANIFEST = "bundled";

const ruleCorpus = JSON.parse(
  readFileSync(new URL("./fixtures/rule-corpus.json", import.meta.url), "utf8"),
);

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

const permissiveRateDatabase = {
  prepare(sql) {
    return {
      bind(...values) {
        return {
          async first() {
            return sql.includes("INSERT INTO rate_windows")
              ? { request_count: 1, reset_at: Number(values[1]) }
              : null;
          },
          async run() {
            return { success: true };
          },
        };
      },
    };
  },
};

async function fetchWorker(request, extraEnv = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);

  let testRequest = request;
  const testUrl = new URL(request.url);
  if (
    testUrl.pathname === "/api/analyze" &&
    request.method === "POST" &&
    !request.headers.has("cf-connecting-ip")
  ) {
    const headers = new Headers(request.headers);
    headers.set("cf-connecting-ip", "198.51.100.10");
    testRequest = new Request(request, { headers });
  }
  const defaultEnv = {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
    DB: permissiveRateDatabase,
    RATE_LIMIT_HMAC_SECRET: "test-only-secret-with-enough-entropy",
  };

  return worker.fetch(
    testRequest,
    { ...defaultEnv, ...extraEnv },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

let persistentWorker;
const persistentRateRows = new Map();
const persistentRateDatabase = {
  prepare(sql) {
    return {
      bind(...values) {
        return {
          async first() {
            if (!sql.includes("INSERT INTO rate_windows")) return null;
            const [clientKey, nextResetAt, now] = values;
            const previous = persistentRateRows.get(clientKey);
            const row =
              !previous || previous.reset_at <= now
                ? { request_count: 1, reset_at: nextResetAt }
                : {
                    request_count: previous.request_count + 1,
                    reset_at: previous.reset_at,
                  };
            persistentRateRows.set(clientKey, row);
            return row;
          },
          async run() {
            if (sql.includes("DELETE FROM rate_windows")) {
              const [now] = values;
              for (const [key, row] of persistentRateRows) {
                if (row.reset_at < now) persistentRateRows.delete(key);
              }
            }
            return { success: true };
          },
        };
      },
    };
  },
};

async function fetchPersistentWorker(request) {
  if (!persistentWorker) {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("rate-limit-test", `${process.pid}-${Date.now()}`);
    persistentWorker = (await import(workerUrl.href)).default;
  }
  return persistentWorker.fetch(
    request,
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      DB: persistentRateDatabase,
      RATE_LIMIT_HMAC_SECRET: "test-only-secret-with-enough-entropy",
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished Korean product", async () => {
  const response = await fetchWorker(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("cache-control") ?? "", /must-revalidate/);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /법령렌즈/);
  assert.match(html, /개인정보처리방침 리스크 분석/);
  assert.match(html, /위험 신호 분석하기/);
  assert.match(html, /샘플 원문으로 바로 분석/);
  assert.match(html, /href="#analyzer"/);
  assert.match(html, /id="analyzer" tabindex="-1"/);
  assert.match(html, /aria-controls="input-panel-url"/);
  assert.match(html, /서비스 맥락 보정/);
  assert.match(html, /class="contextDetails"/);
  assert.match(html, /본인전송요구\(8\/20~\)/);
  assert.match(html, /입력 데이터와 보안 처리 방식/);
  assert.match(html, /자동화된 결정/);
  assert.match(html, /공개 베타/);
  assert.match(html, /법률 검토를 돕는 자동 점검/);
  assert.match(html, /공식 소스 확인 중/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
  assert.match(html, /http:\/\/localhost\/og\.png/);
  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("ships the responsive self-hosted 2026 interface", () => {
  const css = readFileSync(
    new URL("../app/modern-ui.css", import.meta.url),
    "utf8",
  );
  const font = readFileSync(
    new URL("../public/fonts/PretendardVariable.woff2", import.meta.url),
  );

  assert.match(css, /@font-face/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.filterRow[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /@media print[\s\S]*\.reportSection\s*{[\s\S]*width:\s*100%;[\s\S]*padding:\s*0/);
  assert.doesNotMatch(css, /#7a8699|#748096|#98a2b3/i);
  assert.equal(font.subarray(0, 4).toString("ascii"), "wOF2");
});

test("publishes readable privacy and terms pages for the public beta", async () => {
  const privacyResponse = await fetchWorker(
    new Request("http://localhost/privacy", {
      headers: { accept: "text/html", host: "localhost" },
    }),
  );
  assert.equal(privacyResponse.status, 200);
  const privacyHtml = await privacyResponse.text();
  assert.match(privacyHtml, /개인정보 처리 안내/);
  assert.match(privacyHtml, /HMAC-SHA-256/);
  assert.match(privacyHtml, /익명정보라고 단정하지 않습니다/);
  assert.match(privacyHtml, /외부 AI API나 유료 브라우저 API로/);

  const termsResponse = await fetchWorker(
    new Request("http://localhost/terms", {
      headers: { accept: "text/html", host: "localhost" },
    }),
  );
  assert.equal(termsResponse.status, 200);
  const termsHtml = await termsResponse.text();
  assert.match(termsHtml, /이용조건·문의/);
  assert.match(termsHtml, /분석 결과는 위법 여부를 확정하지 않으며/);
  assert.match(termsHtml, /금지되는 이용/);
});

test("reports legal-monitor degradation through the health endpoint", async () => {
  const response = await fetchWorker(
    new Request("http://localhost/api/health", {
      headers: { accept: "application/json", host: "localhost" },
    }),
  );
  assert.ok([200, 503].includes(response.status));
  assert.equal(response.headers.get("cache-control"), "no-store");

  const health = await response.json();
  assert.ok(["ok", "degraded"].includes(health.status));
  assert.equal(health.service.state, "healthy");
  assert.ok(
    ["healthy", "review_required", "failed", "stale"].includes(
      health.legalMonitor.state,
    ),
  );
  if (health.legalMonitor.state === "failed" || health.legalMonitor.state === "stale") {
    assert.equal(response.status, 503);
    assert.equal(health.status, "degraded");
    assert.equal(response.headers.get("retry-after"), "300");
  }
});

test("accepts legacy and current legal-monitor status schemas", async () => {
  const originalFetch = globalThis.fetch;
  const checkedAt = new Date().toISOString();
  const base = {
    configured: true,
    lastAttemptAt: checkedAt,
    lastSuccessfulCheckAt: checkedAt,
    lastResult: "no_changes",
    sourceCount: 11,
    failedSources: 0,
    workflowRunUrl:
      "https://github.com/GGBoo0/law-lens-privacy-auditor/actions/runs/123",
  };
  const payloads = [
    { schemaVersion: 1, ...base },
    {
      schemaVersion: 2,
      ...base,
      consecutiveFailures: 0,
      recoveredAt: null,
      stale: false,
      staleAfter: new Date(Date.now() + 36 * 60 * 60 * 1_000).toISOString(),
      staleAfterHours: 36,
      workflowRunAttempt: 1,
      recentRuns: [
        {
          checkedAt,
          result: "no_changes",
          sourceCount: 11,
          failedSources: 0,
          workflowRunUrl:
            "https://github.com/GGBoo0/law-lens-privacy-auditor/actions/runs/123",
          workflowRunAttempt: 1,
          consecutiveFailures: 0,
          recovered: false,
        },
      ],
    },
  ];

  try {
    for (const payload of payloads) {
      globalThis.fetch = async () => Response.json(payload);
      const response = await fetchWorker(
        new Request("http://localhost/api/legal-monitor-status", {
          headers: { accept: "application/json", host: "localhost" },
        }),
      );
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.schemaVersion, payload.schemaVersion);
      assert.equal(result.lastSuccessfulCheckAt, checkedAt);
      if (payload.schemaVersion === 2) {
        assert.equal(result.recentRuns.length, 1);
        assert.equal(result.consecutiveFailures, 0);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analyzes pasted policy text without external services", async () => {
  const text =
    "주식회사 테스트는 개인정보 처리 목적을 회원관리로 정합니다. 처리하는 개인정보 항목은 이름과 이메일입니다. 개인정보 처리 및 보유 기간은 회원 탈퇴 시까지입니다. 파기 절차 및 방법에 따라 전자파일은 영구 삭제합니다. 정보주체는 열람, 정정, 삭제, 처리정지와 동의 철회를 요청할 수 있습니다. 개인정보 보호책임자는 privacy@example.com, 02-1234-5678로 연락할 수 있습니다. 안전성 확보조치로 접근권한 관리, 암호화, 접속기록 보관을 시행합니다. 개인정보를 제3자에게 제공하지 않으며 처리 업무를 위탁하지 않습니다. 본 방침은 2026년 7월 1일부터 시행됩니다.";
  const response = await fetchWorker(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  );

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.policyTitle, "직접 입력한 개인정보처리방침");
  assert.equal(result.legalBaseline.date, "2026-08-11");
  assert.equal(result.legalBaseline.verifiedAt, "2026-08-11");
  assert.equal(result.legalBaseline.rulesetVersion, "KR-PRIVACY-2026.08.11-r4");
  assert.equal(result.legalBaseline.monitoring.enabled, true);
  assert.equal(result.legalBaseline.monitoring.sourceCount, 11);
  assert.match(result.documentHash, /^[a-f0-9]{64}$/);
  assert.equal(result.scoreMethod.label, "자동탐지 기재 충족도");
  assert.match(result.scoreMethod.meaning, /공식 평가점수가 아니라/);
  assert.ok(
    result.legalBaseline.statutes.some(
      (statute) =>
        statute.name === "개인정보의 안전성 확보조치 기준" &&
        statute.version.includes("고시 제2026-9호"),
    ),
  );
  assert.ok(
    result.legalBaseline.upcomingChanges.some(
      (change) =>
        change.effectiveFrom === "2026-09-11" &&
        change.lifecycleStatus === "scheduled_review_pending" &&
        change.impactCategories.includes("privacy_officer"),
    ),
  );
  assert.equal(
    result.legalBaseline.upcomingChanges.some(
      (change) => change.effectiveFrom === "2026-08-20",
    ),
    false,
    "the reviewed portability amendment should not remain in the live pending queue",
  );
  assert.equal(result.analysisEngine.mode, "local_rules");
  assert.equal(result.analysisEngine.aiUsed, false);
  assert.equal(result.analysisEngine.externalApiCalls, 0);
  assert.equal(result.analysisEngine.estimatedApiCostKrw, 0);
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(result.counts.high, 0);
  assert.ok(result.coverage.length >= 10);
  assert.deepEqual(
    result.evaluationAxes.map((axis) => axis.key),
    ["appropriateness", "readability", "accessibility", "consistency"],
  );
  assert.equal(
    result.evaluationAxes.find((axis) => axis.key === "consistency").state,
    "not_evaluated",
  );
});

test("uses declared service context to find a missing overseas disclosure", async () => {
  const text =
    "주식회사 테스트는 회원관리와 서비스 제공을 위해 이름과 이메일을 처리합니다. 개인정보 처리 목적과 처리하는 개인정보 항목을 공개합니다. 개인정보 처리 및 보유 기간은 회원 탈퇴 시까지입니다. 파기 절차와 방법에 따라 전자파일을 영구 삭제합니다. 정보주체는 열람, 정정, 삭제, 처리정지를 요청할 수 있습니다. 개인정보 보호책임자는 privacy@example.com으로 연락할 수 있습니다. 안전성 확보조치로 접근권한 관리와 암호화를 시행합니다. 본 방침은 2026년 8월 1일부터 시행합니다.";
  const response = await fetchWorker(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        contexts: { overseas: "yes" },
      }),
    }),
  );

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.detectedSignals.includes("국외 이전 · 사용자 확인"));
  const finding = result.findings.find(
    (candidate) => candidate.id === "overseas-transfer",
  );
  assert.ok(finding);
  assert.equal(finding.requiresFactualVerification, true);
});

test("flags ambiguous wording and conflicting disclosures without an AI API", async () => {
  const text =
    "주식회사 테스트의 개인정보 처리 목적은 회원관리와 서비스 제공입니다. 처리하는 개인정보 항목은 이름과 이메일이고 보유 기간은 회원 탈퇴 시까지입니다. 파기 절차 및 방법에 따라 전자파일은 영구 삭제합니다. 정보주체는 열람, 정정, 삭제, 처리정지와 동의 철회를 요청할 수 있습니다. 개인정보 보호책임자는 privacy@example.com, 02-1234-5678입니다. 안전성 확보조치로 접근권한 관리와 암호화를 시행합니다. 회사는 개인정보를 제3자에게 제공하지 않습니다. 다만 회사가 필요하다고 판단하는 경우 제휴사 등에 개인정보를 제공할 수 있습니다. 처리 업무를 위탁하지 않으나 배송 업무는 외부 업체에 위탁합니다. 본 방침은 2026년 7월 1일부터 시행됩니다.";
  const response = await fetchWorker(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  );

  assert.equal(response.status, 200);
  const result = await response.json();
  const ids = new Set(result.findings.map((finding) => finding.id));
  assert.ok(ids.has("vague-purpose"));
  assert.ok(ids.has("vague-third-party"));
  assert.ok(ids.has("outsourcing-inconsistency"));
  assert.ok(
    result.findings.some(
      (finding) =>
        finding.findingType === "ambiguity_or_inconsistency" &&
        finding.requiresFactualVerification,
    ),
  );
});

test("keeps core heuristic rules stable against the golden corpus", async () => {
  assert.ok(ruleCorpus.length >= 18, "법률 요소 회귀 예제가 충분해야 합니다.");
  for (const example of ruleCorpus) {
    const response = await fetchWorker(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: example.text, contexts: example.contexts }),
      }),
    );
    assert.equal(response.status, 200, example.name);
    const result = await response.json();
    const ids = new Set(result.findings.map((finding) => finding.id));
    for (const expectedId of example.expectedFindingIds) {
      assert.ok(ids.has(expectedId), `${example.name}: ${expectedId}`);
    }
    for (const unexpectedId of example.unexpectedFindingIds ?? []) {
      assert.ok(!ids.has(unexpectedId), `${example.name}: unexpected ${unexpectedId}`);
    }
    for (const [findingId, expectedSeverity] of Object.entries(
      example.expectedSeverities ?? {},
    )) {
      assert.equal(
        result.findings.find((finding) => finding.id === findingId)?.severity,
        expectedSeverity,
        `${example.name}: severity ${findingId}`,
      );
    }
    for (const expectedCoverage of example.expectedCoverage ?? []) {
      assert.ok(
        result.coverage.some(
          (item) =>
            item.label === expectedCoverage.label &&
            item.state === expectedCoverage.state,
        ),
        `${example.name}: coverage ${expectedCoverage.label}/${expectedCoverage.state}`,
      );
    }
  }
});

test("rejects cross-site, non-JSON, and private-network requests", async () => {
  const crossSite = await fetchWorker(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ text: "가".repeat(150) }),
    }),
  );
  assert.equal(crossSite.status, 403);

  const nonJson = await fetchWorker(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }),
  );
  assert.equal(nonJson.status, 415);

  for (const url of [
    "http://127.0.0.1/privacy",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/privacy",
    "http://[fc00::1]/privacy",
    "http://[64:ff9b::0a00:0001]/privacy",
  ]) {
    const response = await fetchWorker(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      }),
    );
    assert.equal(response.status, 400, url);
  }
});

test("cites the current e-commerce retention decree when the signal appears", async () => {
  const text =
    "주식회사 테스트는 회원가입과 주문, 결제, 배송을 위해 이름과 이메일을 처리합니다. 개인정보 처리 목적은 회원관리와 상품 공급입니다. 처리하는 개인정보 항목은 이름과 이메일입니다. 개인정보 처리 및 보유 기간은 회원 탈퇴 시까지입니다. 파기 절차 및 방법에 따라 전자파일은 영구 삭제합니다. 정보주체는 열람, 정정, 삭제, 처리정지와 동의 철회를 요청할 수 있습니다. 개인정보 보호책임자는 privacy@example.com, 02-1234-5678입니다. 안전성 확보조치로 접근권한 관리와 암호화를 시행합니다. 개인정보를 제3자에게 제공하지 않고 처리 업무도 위탁하지 않습니다. 본 방침은 2026년 7월 1일부터 시행합니다.";
  const response = await fetchWorker(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  const finding = result.findings.find(
    (candidate) => candidate.id === "ecommerce-retention",
  );
  assert.ok(finding);
  assert.ok(
    finding.legalBasis.some(
      (basis) =>
        basis.law === "전자상거래 등에서의 소비자보호에 관한 법률 시행령" &&
        basis.article === "제6조",
    ),
  );
});

test("does not activate sector rule packs from explicit absence statements", async () => {
  const text =
    "주식회사 테스트는 개인정보 처리 목적을 회원관리로 정합니다. 처리하는 개인정보 항목은 이름과 이메일입니다. 개인정보 처리 및 보유 기간은 회원 탈퇴 시까지입니다. 파기 절차 및 방법에 따라 전자파일은 영구 삭제합니다. 정보주체는 열람, 정정, 삭제, 처리정지와 동의 철회를 요청할 수 있습니다. 개인정보 보호책임자는 privacy@example.com, 02-1234-5678로 연락할 수 있습니다. 안전성 확보조치로 접근권한 관리와 암호화를 시행합니다. 개인정보를 제3자에게 제공하지 않으며 처리 업무를 위탁하지 않습니다. 회사는 결제 기능을 제공하지 않습니다. 위치정보를 처리하지 않습니다. 신용정보를 처리하지 않습니다. 본 방침은 2026년 8월 1일부터 시행됩니다.";
  const response = await fetchWorker(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  );

  assert.equal(response.status, 200);
  const result = await response.json();
  const ids = new Set(result.findings.map((finding) => finding.id));
  assert.ok(!ids.has("ecommerce-retention"));
  assert.ok(!ids.has("location-sector"));
  assert.ok(!ids.has("credit-sector"));
  assert.ok(!result.detectedSignals.includes("전자상거래"));
  assert.ok(!result.detectedSignals.includes("개인위치정보"));
  assert.ok(!result.detectedSignals.includes("개인신용정보"));
});

test("preserves affirmative sector signals when denials and actual use coexist", async () => {
  const text =
    "주식회사 테스트는 개인정보 처리 목적을 회원관리와 상품 공급으로 정합니다. 처리하는 개인정보 항목은 이름과 이메일입니다. 개인정보 처리 및 보유 기간은 회원 탈퇴 시까지입니다. 파기 절차 및 방법에 따라 전자파일은 영구 삭제합니다. 정보주체는 열람, 정정, 삭제, 처리정지와 동의 철회를 요청할 수 있습니다. 개인정보 보호책임자는 privacy@example.com, 02-1234-5678로 연락할 수 있습니다. 안전성 확보조치로 접근권한 관리와 암호화를 시행합니다. 개인정보를 제3자에게 제공하지 않으며 처리 업무를 위탁하지 않습니다. 회사는 결제 기능을 제공하지 않습니다. 다만 상품 주문과 배송 서비스를 제공합니다. 위치정보를 처리하지 않지만 GPS 기반 위치기반 서비스를 제공합니다. 신용정보를 처리하지 않지만 대출 심사를 위해 신용평점을 조회합니다. 본 방침은 2026년 8월 1일부터 시행됩니다.";
  const response = await fetchWorker(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  );

  assert.equal(response.status, 200);
  const result = await response.json();
  const ids = new Set(result.findings.map((finding) => finding.id));
  assert.ok(ids.has("ecommerce-retention"));
  assert.ok(ids.has("location-sector"));
  assert.ok(ids.has("credit-sector"));
  assert.ok(result.detectedSignals.includes("전자상거래"));
  assert.ok(result.detectedSignals.includes("개인위치정보"));
  assert.ok(result.detectedSignals.includes("개인신용정보"));
});

test("keeps table headers attached to values and rejects unrelated public-suffix domains", async () => {
  const originalFetch = globalThis.fetch;
  const fetchedUrls = [];
  const policyBody = `
    <h1>개인정보처리방침</h1>
    <p>주식회사 예시는 회원관리와 서비스 제공을 위하여 이름과 이메일을 처리합니다.</p>
    <p>개인정보 처리 및 보유 기간은 회원 탈퇴 시까지이며, 파기 절차와 방법에 따라 전자파일을 영구 삭제합니다.</p>
    <p>정보주체는 열람, 정정, 삭제, 처리정지와 동의 철회를 요청할 수 있습니다.</p>
    <p>개인정보 보호책임자는 privacy@example.co.uk이고 안전성 확보조치로 접근권한 관리와 암호화를 시행합니다.</p>
    <h2>개인정보의 제3자 제공</h2>
    <table>
      <tr><th>제공받는 자</th><th>제공 목적</th><th>제공하는 개인정보 항목</th><th>보유 및 이용 기간</th></tr>
      <tr><td>주식회사 배송</td><td>상품 배송</td><td>이름, 주소</td><td>배송 완료 후 30일</td></tr>
    </table>
    <p>처리 업무를 위탁하지 않으며 본 방침은 2026년 8월 1일부터 시행합니다.</p>
    <p>${"개인정보 보호와 투명한 처리를 위한 상세 안내입니다. ".repeat(14)}</p>
  `;

  globalThis.fetch = async (input) => {
    const url = new URL(
      input instanceof URL
        ? input.href
        : typeof input === "string"
          ? input
          : input.url,
    );
    fetchedUrls.push(url.href);
    if (url.hostname === "shop.example.co.uk") {
      return new Response(
        `<a href="https://evil.co.uk/privacy-policy">개인정보처리방침</a>
         <a href="https://privacy.example.co.uk/privacy-policy">개인정보처리방침</a>`,
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (url.hostname === "privacy.example.co.uk") {
      return new Response(policyBody, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.hostname === "evil.co.uk") {
      return new Response(policyBody.replaceAll("주식회사 예시", "악성 외부 문서"), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const response = await fetchWorker(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://shop.example.co.uk" }),
      }),
    );
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(
      result.policyUrl,
      "https://privacy.example.co.uk/privacy-policy",
    );
    assert.ok(!fetchedUrls.some((url) => new URL(url).hostname === "evil.co.uk"));
    assert.ok(
      result.coverage.some(
        (item) => item.label === "제3자 제공" && item.state === "present",
      ),
    );
    assert.ok(
      !result.findings.some((finding) => finding.id === "third-party-fields"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test(
  "terminates safely on a large unfinished table without overlapping rescans",
  { timeout: 2_000 },
  () => {
    const prefix = "<p>safe prefix</p>";
    const openingTags = "<table>".repeat(40_000);
    const html = `${prefix}${openingTags}${"x".repeat(
      1_400_000 - prefix.length - openingTags.length,
    )}`;
    const startedAt = performance.now();
    const output = extractStructuredTables(html);
    const elapsedMilliseconds = performance.now() - startedAt;

    assert.equal(output, `${prefix} `);
    assert.ok(
      elapsedMilliseconds < 1_000,
      `unfinished table scan took ${elapsedMilliseconds.toFixed(1)}ms`,
    );
  },
);

test("caps table, row, cell, and total output against header amplification", () => {
  const prefix = "<p>before</p>";
  const suffix = "<p>after</p>";
  const headerCount = 100;
  const headerText = "H".repeat(9_000);
  const headerRow = `<tr>${Array.from(
    { length: headerCount },
    (_, index) => `<th>${headerText}${index}</th>`,
  ).join("")}</tr>`;
  const dataRow = `<tr>${Array.from(
    { length: headerCount },
    (_, index) => `<td>value-${index}</td>`,
  ).join("")}</tr>`;
  const html = `${prefix}<table>${headerRow}${dataRow.repeat(
    DEFAULT_STRUCTURED_TABLE_LIMITS.maxRowsPerTable + 20,
  )}</table>${suffix}`;

  assert.ok(html.length < 1_450_000, "fixture must fit the fetch response cap");
  const output = extractStructuredTables(html);
  assert.ok(output.startsWith(prefix));
  assert.ok(output.endsWith(suffix));
  assert.ok(
    output.length <=
      prefix.length +
        suffix.length +
        DEFAULT_STRUCTURED_TABLE_LIMITS.maxOutputChars,
  );
  assert.ok(
    !output.includes("H".repeat(DEFAULT_STRUCTURED_TABLE_LIMITS.maxCellChars + 1)),
  );

  const budgetFixture = Array.from(
    { length: 3 },
    (_, tableIndex) => `<table><tr><th>head-${tableIndex}-0</th><th>head-${tableIndex}-1</th><th>head-${tableIndex}-2</th></tr>
      <tr><td>row-${tableIndex}-0</td><td>row-${tableIndex}-1</td><td>row-${tableIndex}-2</td></tr>
      <tr><td>extra-${tableIndex}-0</td><td>extra-${tableIndex}-1</td><td>extra-${tableIndex}-2</td></tr></table>`,
  ).join("");
  const budgeted = extractStructuredTables(budgetFixture, {
    maxTables: 1,
    maxRowsPerTable: 2,
    maxCellsPerRow: 2,
    maxCellChars: 6,
    maxOutputChars: 160,
  });
  assert.match(budgeted, /head-0/);
  assert.doesNotMatch(budgeted, /head-1|head-2|extra-0|row-0-2/);
  assert.ok(budgeted.length <= 160);
});

test("rate-limits repeated analysis requests from one client", async () => {
  const text = "개인정보처리방침 테스트 문장입니다. ".repeat(12);
  let response;
  for (let attempt = 1; attempt <= 13; attempt++) {
    response = await fetchPersistentWorker(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "198.51.100.44",
        },
        body: JSON.stringify({ text }),
      }),
    );
    assert.equal(response.status, attempt <= 12 ? 200 : 429);
  }
  assert.ok(Number(response.headers.get("retry-after")) >= 1);
});

test("groups rotating IPv6 interface addresses into one /64 rate-limit bucket", async () => {
  const text = "개인정보처리방침 테스트 문장입니다. ".repeat(12);
  let response;
  for (let attempt = 1; attempt <= 13; attempt++) {
    response = await fetchPersistentWorker(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": `2001:db8:1234:5678::${attempt.toString(16)}`,
        },
        body: JSON.stringify({ text }),
      }),
    );
    assert.equal(response.status, attempt <= 12 ? 200 : 429);
  }

  const otherNetwork = await fetchPersistentWorker(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "2001:db8:1234:5679::1",
      },
      body: JSON.stringify({ text }),
    }),
  );
  assert.equal(otherNetwork.status, 200);
});

test("requires a hosted HMAC secret before using the durable rate limiter", async () => {
  const database = {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return { request_count: 1, reset_at: Date.now() + 60_000 };
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  };
  const response = await fetchWorker(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "개인정보처리방침 테스트 문장입니다. ".repeat(12) }),
    }),
    { DB: database, RATE_LIMIT_HMAC_SECRET: undefined },
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "60");
});

test("requires the hosted D1 binding for the global rate limiter", async () => {
  const response = await fetchWorker(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "개인정보처리방침 테스트 문장입니다. ".repeat(12),
      }),
    }),
    {
      DB: undefined,
      RATE_LIMIT_HMAC_SECRET: "test-only-secret-with-enough-entropy",
    },
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "60");
});

test("rejects analysis when the trusted Cloudflare client address is absent", async () => {
  const response = await fetchWorker(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "",
        "x-forwarded-for": "198.51.100.200",
      },
      body: JSON.stringify({
        text: "개인정보처리방침 테스트 문장입니다. ".repeat(12),
      }),
    }),
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "60");
});

test("fails closed when the durable rate limiter is unavailable", async () => {
  const database = {
    prepare() {
      throw new Error("D1 unavailable");
    },
  };
  const response = await fetchWorker(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "198.51.100.87",
      },
      body: JSON.stringify({
        text: "개인정보처리방침 테스트 문장입니다. ".repeat(12),
      }),
    }),
    {
      DB: database,
      RATE_LIMIT_HMAC_SECRET: "test-only-secret-with-enough-entropy",
    },
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "60");
});

test("keeps the unused dynamic image parser endpoint closed", async () => {
  const response = await fetchWorker(
    new Request("http://localhost/_vinext/image?url=%2Ffavicon.svg&w=64&q=75"),
  );
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});
