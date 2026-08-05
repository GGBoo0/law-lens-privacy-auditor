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

test("uses Google's official Korean privacy policy for YouTube", async () => {
  await assertPolicy("www.youtube.com", 87, /policies\.google\.com\/privacy/i);
});

test("reads Hyundai's current policy through its public web endpoint", async () => {
  await assertPolicy("www.hyundai.com", 88, /privacy\.hyundai\.com\/overview\/full-policy/i);
});

test("reads Kia's current policy through its public web endpoint", async () => {
  await assertPolicy("www.kia.com", 89, /privacy\.kia\.com\/overview\/full-policy/i);
});

test("reads KakaoBank's current policy through its public content endpoint", async () => {
  await assertPolicy("www.kakaobank.com", 90, /m\.kakaobank\.com\/PrivacyPolicy/i);
});

test("reads Wavve's current policy through its public content endpoint", async () => {
  await assertPolicy("www.wavve.com", 91, /wavve\.com\/customer\/agreement/i);
});

test("reads TVING's current policy through its public content endpoint", async () => {
  await assertPolicy("www.tving.com", 92, /tving\.com\/policy\/privacy/i);
});

test("resolves SOOP's versioned current policy document", async () => {
  await assertPolicy("www.sooplive.co.kr", 93, /res\.sooplive\.com\/policy\/policy2\.html/i);
});

test("does not mistake LG U+'s unrelated external document for its policy", async () => {
  const response = await analyze("www.lguplus.com", 94);
  const body = await response.json();
  assert.ok([200, 422].includes(response.status), JSON.stringify(body));
  assert.doesNotMatch(body.policyUrl || "", /notm\.or\.kr/i);
});

test("does not mistake Yanolja's careers policy for its customer policy", async () => {
  const response = await analyze("www.yanolja.com", 95);
  const body = await response.json();
  assert.ok([200, 422].includes(response.status), JSON.stringify(body));
  assert.doesNotMatch(body.policyUrl || "", /careers\.nol-universe\.com/i);
});

test("uses Kakao's official privacy policy for Daum", async () => {
  await assertPolicy("www.daum.net", 96, /kakao\.com\/policy\/privacy/i);
});

test("uses Microsoft's general privacy statement instead of a topical policy", async () => {
  await assertPolicy("www.microsoft.com/ko-kr", 97, /microsoft\.com\/ko-kr\/privacy\/privacystatement/i);
});

test("uses Apple's legal privacy policy instead of its privacy marketing page", async () => {
  await assertPolicy("www.apple.com/kr", 98, /apple\.com\/legal\/privacy\/kr/i);
});

test("reads TMAP's current policy from its public terms endpoint", async () => {
  await assertPolicy("www.tmapmobility.com", 99, /web\.tmapmobility\.com\/policy\/detail/i);
});

test("uses Watcha's official legal privacy page", async () => {
  await assertPolicy("watcha.com", 100, /watcha\.com\/ko-KR\/legals\/privacy/i);
});

test("uses JobKorea's official privacy policy page", async () => {
  await assertPolicy("www.jobkorea.co.kr", 101, /jobkorea\.co\.kr\/service\/policyprivacy/i);
});

test("uses Saramin's current privacy policy page", async () => {
  await assertPolicy("www.saramin.co.kr", 102, /saramin\.co\.kr\/index\/privacy-policy/i);
});
