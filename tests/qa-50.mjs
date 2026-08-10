const deployedBaseUrl = process.env.LAWLENS_BASE_URL?.replace(/\/$/, "");
if (!deployedBaseUrl) {
  process.env.LAW_LENS_TEST_RUNTIME_MANIFEST = "bundled";
}

const localRateLimitRows = new Map();
const localRateLimitDatabase = {
  prepare(statement) {
    let parameters = [];
    return {
      bind(...values) {
        parameters = values;
        return this;
      },
      async first() {
        if (!statement.includes("INSERT INTO rate_windows")) {
          throw new Error(`Unexpected local QA D1 query: ${statement}`);
        }
        const [clientKey, nextResetAt, now] = parameters;
        const current = localRateLimitRows.get(clientKey);
        const row =
          !current || current.reset_at <= now
            ? { request_count: 1, reset_at: nextResetAt }
            : {
                request_count: current.request_count + 1,
                reset_at: current.reset_at,
              };
        localRateLimitRows.set(clientKey, row);
        return row;
      },
      async run() {
        if (!statement.includes("DELETE FROM rate_windows")) {
          throw new Error(`Unexpected local QA D1 query: ${statement}`);
        }
        const [now] = parameters;
        for (const [clientKey, row] of localRateLimitRows) {
          if (row.reset_at < now) localRateLimitRows.delete(clientKey);
        }
        return { success: true };
      },
    };
  },
};

const argumentsMap = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, value = "true"] = argument.replace(/^--/, "").split("=", 2);
    return [key, value];
  }),
);
const minimumVerified = Number(argumentsMap["min-verified"] ?? 0);
const maximumWrongSource = Number(argumentsMap["max-wrong-source"] ?? Number.MAX_SAFE_INTEGER);
let localWorker;

const sites = [
  ["Naver", "www.naver.com", ["naver.com"]],
  ["Daum", "www.daum.net", ["daum.net", "kakao.com"]],
  ["Kakao", "www.kakao.com", ["kakao.com"]],
  ["Google Korea", "www.google.co.kr", ["google.com"]],
  ["YouTube", "www.youtube.com", ["google.com", "youtube.com"]],
  ["Microsoft Korea", "www.microsoft.com/ko-kr", ["microsoft.com"]],
  ["Apple Korea", "www.apple.com/kr", ["apple.com"]],
  ["Samsung", "www.samsung.com/sec", ["samsung.com"]],
  ["LG Electronics", "www.lge.co.kr", ["lge.co.kr"]],
  ["SK Telecom", "www.sktelecom.com", ["sktelecom.com"]],
  ["KT", "www.kt.com", ["kt.com"]],
  ["LG U+", "www.lguplus.com", ["lguplus.com"]],
  ["Nexon", "www.nexon.com", ["nexon.com"]],
  ["NCSoft", "www.ncsoft.com", ["ncsoft.com", "plaync.com"]],
  ["Netmarble", "www.netmarble.net", ["netmarble.com", "netmarble.net"]],
  ["Krafton", "www.krafton.com", ["krafton.com"]],
  ["Smilegate", "www.smilegate.com", ["smilegate.com"]],
  ["SOOP", "www.sooplive.co.kr", ["sooplive.com", "sooplive.co.kr"]],
  ["Coupang", "www.coupang.com", ["coupang.com"]],
  ["11st", "www.11st.co.kr", ["11st.co.kr"]],
  ["Gmarket", "www.gmarket.co.kr", ["gmarket.co.kr"]],
  ["SSG", "www.ssg.com", ["ssg.com"]],
  ["LotteON", "www.lotteon.com", ["lotteon.com", "lotte.com"]],
  ["Musinsa", "www.musinsa.com", ["musinsa.com"]],
  ["Zigzag", "zigzag.kr", ["zigzag.kr", "kakaostyle.com"]],
  ["Kurly", "www.kurly.com", ["kurly.com"]],
  ["Daangn", "www.daangn.com", ["daangn.com"]],
  ["Baemin", "www.baemin.com", ["baemin.com"]],
  ["Coupang Eats", "www.coupangeats.com", ["coupangeats.com", "coupang.com"]],
  ["Yogiyo", "www.yogiyo.co.kr", ["yogiyo.co.kr"]],
  ["Yanolja", "www.yanolja.com", ["yanolja.com", "nol-universe.com"]],
  ["Yeogi", "www.goodchoice.kr", ["goodchoice.kr", "yeogi.com"]],
  ["Toss", "toss.im", ["toss.im"]],
  ["KakaoBank", "www.kakaobank.com", ["kakaobank.com"]],
  ["KB Kookmin", "www.kbstar.com", ["kbstar.com"]],
  ["Shinhan", "www.shinhan.com", ["shinhan.com"]],
  ["Woori", "www.wooribank.com", ["wooribank.com"]],
  ["Hana", "www.kebhana.com", ["kebhana.com"]],
  ["Hyundai Card", "www.hyundaicard.com", ["hyundaicard.com"]],
  ["Hyundai Motor", "www.hyundai.com", ["hyundai.com"]],
  ["Kia", "www.kia.com", ["kia.com"]],
  ["Socar", "www.socar.kr", ["socar.kr", "zendesk.com"]],
  ["TMAP", "www.tmapmobility.com", ["tmapmobility.com"]],
  ["Wavve", "www.wavve.com", ["wavve.com"]],
  ["TVING", "www.tving.com", ["tving.com"]],
  ["Watcha", "watcha.com", ["watcha.com"]],
  ["Melon", "www.melon.com", ["melon.com", "kakao.com"]],
  ["Bugs", "music.bugs.co.kr", ["bugs.co.kr"]],
  ["JobKorea", "www.jobkorea.co.kr", ["jobkorea.co.kr"]],
  ["Saramin", "www.saramin.co.kr", ["saramin.co.kr"]],
];

function hostnameMatches(hostname, expected) {
  return hostname === expected || hostname.endsWith(`.${expected}`);
}

async function analyze(url, index) {
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
      "cf-connecting-ip": `203.0.113.${index + 1}`,
    },
    body: JSON.stringify({ url }),
  });
  if (deployedBaseUrl) return fetch(request);
  if (!localWorker) {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("qa-50", `${process.pid}-${Date.now()}`);
    localWorker = (await import(workerUrl.href)).default;
  }
  return localWorker.fetch(
    request,
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      DB: localRateLimitDatabase,
      RATE_LIMIT_HMAC_SECRET: "qa-only-secret-with-enough-entropy",
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function runSite([name, input, expectedDomains], index) {
  const startedAt = Date.now();
  try {
    const response = await analyze(input, index);
    const body = await response.json();
    if (response.status !== 200) {
      return { name, input, result: body.code || `http_${response.status}`, elapsedMs: Date.now() - startedAt };
    }
    const policyUrl = new URL(body.policyUrl);
    const verified = expectedDomains.some((domain) => hostnameMatches(policyUrl.hostname, domain));
    return {
      name,
      input,
      result: verified ? "verified_success" : "wrong_source",
      policyUrl: body.policyUrl,
      textLength: body.textLength,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return { name, input, result: "test_error", error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - startedAt };
  }
}

const results = [];
for (let index = 0; index < sites.length; index += 5) {
  results.push(...(await Promise.all(sites.slice(index, index + 5).map((site, offset) => runSite(site, index + offset)))));
}

const counts = Object.fromEntries(
  [...new Set(results.map((result) => result.result))]
    .sort()
    .map((key) => [key, results.filter((result) => result.result === key).length]),
);
const verified = counts.verified_success || 0;
const report = {
  target: results.length,
  verifiedSuccess: verified,
  verifiedSuccessRate: `${((verified / results.length) * 100).toFixed(1)}%`,
  falsePositives: counts.wrong_source || 0,
  releaseGate: {
    minimumVerified,
    maximumWrongSource,
    passed:
      verified >= minimumVerified &&
      (counts.wrong_source || 0) <= maximumWrongSource,
  },
  counts,
  results,
};

console.log(JSON.stringify(report, null, 2));
if (!report.releaseGate.passed) process.exitCode = 1;
