import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

async function fetchWorker(request) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    request,
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
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

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /법령렌즈/);
  assert.match(html, /개인정보처리방침 리스크 분석/);
  assert.match(html, /위험 신호 분석하기/);
  assert.match(html, /http:\/\/localhost\/og\.png/);
  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
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
  assert.equal(result.legalBaseline.date, "2026-07-26");
  assert.equal(result.analysisEngine.mode, "local_rules");
  assert.equal(result.analysisEngine.aiUsed, false);
  assert.equal(result.analysisEngine.externalApiCalls, 0);
  assert.equal(result.analysisEngine.estimatedApiCostKrw, 0);
  assert.ok(result.score >= 80);
  assert.equal(result.counts.high, 0);
  assert.ok(result.coverage.length >= 10);
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
  assert.ok(ids.has("third-party-inconsistency"));
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
