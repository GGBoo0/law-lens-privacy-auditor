import assert from "node:assert/strict";
import test from "node:test";

const deployedBaseUrl = process.env.LAWLENS_BASE_URL?.replace(/\/$/, "");
let localWorker;

async function analyze(url, clientSuffix) {
  const requestUrl = deployedBaseUrl
    ? `${deployedBaseUrl}/api/analyze`
    : "http://localhost/api/analyze";
  const origin = new URL(requestUrl).origin;
  const request = new Request(requestUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin",
      "x-real-ip": `198.51.100.${clientSuffix}`,
    },
    body: JSON.stringify({ url }),
  });

  if (deployedBaseUrl) return fetch(request);
  if (!localWorker) {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("live-url", `${process.pid}-${Date.now()}`);
    localWorker = (await import(workerUrl.href)).default;
  }
  return localWorker.fetch(
    request,
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function assertNexonPolicy(input, clientSuffix) {
  const response = await analyze(input, clientSuffix);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(body.policyUrl, /member\.nexon\.com\/policy\/policywrapper\.aspx/i);
  assert.ok(body.textLength > 5_000, `unexpected text length: ${body.textLength}`);
  assert.ok(body.discoveryPath.length >= 1);
}

async function assertPolicy(input, clientSuffix, expectedUrl, minimumLength = 5_000) {
  const response = await analyze(input, clientSuffix);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(body.policyUrl, expectedUrl);
  assert.ok(
    body.textLength > minimumLength,
    `unexpected text length for ${input}: ${body.textLength}`,
  );
  assert.ok(body.discoveryPath.length >= 1);
}

test("discovers Nexon's nested policy from the company homepage", async () => {
  await assertNexonPolicy("www.nexon.com", 81);
});

test("follows Nexon's privacy landing page to the full policy", async () => {
  await assertNexonPolicy("member.nexon.com/policy/privacy.aspx", 82);
});

test("uses Naver's official policy page when the homepage omits a crawlable link", async () => {
  await assertPolicy("www.naver.com", 83, /policy\.naver\.com\/rules\/privacy\.html/i);
});

test("uses 11st's dedicated privacy policy host", async () => {
  await assertPolicy("www.11st.co.kr", 84, /privacy\.11st\.co\.kr/i);
});

test("reads Toss's current policy from its public content endpoint", async () => {
  await assertPolicy("toss.im", 85, /toss\.im\/privacy-policy/i);
});

test("resolves Baemin's current policy document without a paid browser", async () => {
  await assertPolicy("www.baemin.com", 86, /terms\.baemin\.com\/terms\//i);
});
