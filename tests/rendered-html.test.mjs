import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ruleCorpus = JSON.parse(
  readFileSync(new URL("./fixtures/rule-corpus.json", import.meta.url), "utf8"),
);

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

let persistentWorker;

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
  assert.match(html, /aria-controls="input-panel-url"/);
  assert.match(html, /서비스 맥락 보정/);
  assert.match(html, /자동화된 결정/);
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
  assert.equal(result.legalBaseline.date, "2026-08-05");
  assert.equal(result.legalBaseline.verifiedAt, "2026-08-05");
  assert.equal(result.legalBaseline.rulesetVersion, "KR-PRIVACY-2026.08.05-r2");
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
        change.status === "시행 전 · 분석 규칙 미적용",
    ),
  );
  assert.ok(
    result.legalBaseline.upcomingChanges.some(
      (change) =>
        change.effectiveFrom === "2026-08-20" &&
        change.status === "시행 전 · 적용 대상은 본인전송요구 방법 반영 필요",
    ),
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
