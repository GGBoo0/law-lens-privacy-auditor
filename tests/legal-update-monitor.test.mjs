import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  STAGE_EFFECTIVE_DATE_ALGORITHM,
  articleMap,
  buildChangeReport,
  calculateRelativePromulgationEffectiveDate,
  canonicalize,
  compareSnapshots,
  extractStageEffectiveDates,
  extractPipcArticle,
  extractPipcGuideList,
  pipcAttachmentUrl,
  runMonitor,
  semanticVersionFingerprintPayload,
} from "../scripts/check-legal-updates.mjs";
import { syncReviewBranch } from "../scripts/sync-legal-review-branch.mjs";
import { buildMonitorStatus } from "../scripts/write-legal-monitor-status.mjs";
import { SOURCES } from "../lib/legal-bases.mjs";
import { REQUIRED_MONITORED_LEGAL_SOURCE_IDS } from "../lib/legal-source-ids.mjs";
import { LEGAL_BASELINE } from "../lib/legal-baseline.ts";

function git(cwd, ...arguments_) {
  return execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
}

async function createMonitorFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "law-lens-monitor-flow-"));
  const sources = path.join(root, "legal-sources.json");
  const snapshot = path.join(root, "legal-source-snapshot.json");
  const report = path.join(root, "latest.md");
  const githubOutput = path.join(root, "github-output.txt");
  await writeFile(
    sources,
    `${JSON.stringify({
      schemaVersion: 1,
      sources: [
        {
          id: "guide-list",
          name: "테스트 개인정보 안내서 목록",
          type: "pipc_guide_list",
          url: "https://www.pipc.go.kr/guides",
          keywords: ["개인정보 처리방침"],
        },
      ],
    })}\n`,
  );
  return { root, sources, snapshot, report, githubOutput };
}

function guideHtml({ publishedAt = "2026-04-23", suffix = "" } = {}) {
  return `<table><tr><td><a href="/np/cop/bbs/selectBoardArticle.do?nttId=1">개인정보 처리방침 작성지침${suffix}</a></td><td>${publishedAt}</td></tr></table>`;
}

function htmlFetch(getHtml) {
  return async () =>
    new Response(getHtml(), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
}

test("canonical JSON fingerprints can ignore object key order", () => {
  assert.equal(
    canonicalize({ b: 2, a: { d: 4, c: 3 } }),
    canonicalize({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test("every legal authority used by analysis and baseline is monitored", async () => {
  const config = JSON.parse(await readFile("data/legal-sources.json", "utf8"));
  const monitored = new Set(config.sources.map((source) => source.id));
  const used = new Set([
    ...REQUIRED_MONITORED_LEGAL_SOURCE_IDS,
    ...Object.values(SOURCES).map((source) => source.sourceId),
    ...LEGAL_BASELINE.statutes.map((statute) => statute.sourceId),
  ]);
  const missing = [...used].filter((sourceId) => !monitored.has(sourceId));

  assert.deepEqual(missing, []);
  assert.equal(LEGAL_BASELINE.monitoring.sourceCount, config.sources.length);
  assert.ok(monitored.has("privacy-policy-evaluation-notice"));
  assert.ok(monitored.has("ecommerce-act"));
});

test("legal snapshot comparison names changed articles", () => {
  const previous = {
    sources: {
      pipa: {
        name: "개인정보 보호법",
        officialUrl: "https://law.go.kr/example",
        fingerprint: "old",
        versions: [
          {
            id: "1",
            documentHash: "old-document",
            articles: { "0030000": { label: "제30조(개인정보 처리방침)", hash: "old" } },
          },
        ],
      },
    },
  };
  const current = structuredClone(previous);
  current.sources.pipa.fingerprint = "new";
  current.sources.pipa.versions[0].documentHash = "new-document";
  current.sources.pipa.versions[0].articles["0030000"].hash = "new";

  const changes = compareSnapshots(previous, current);
  assert.equal(changes.length, 1);
  assert.match(changes[0].details.join(" "), /제30조/);
});

test("PIPC guide list extraction ignores view counts", () => {
  const source = {
    url: "https://www.pipc.go.kr/list",
    keywords: ["개인정보 처리방침"],
  };
  const first = `
    <tr><td class="boardTitle"><a href="/article?selectBoardArticle.do&id=1">
      [현재 안내서] 개인정보 처리방침 작성지침(2026.4.)
    </a></td><td>2026-04-23</td><td>100</td></tr>`;
  const second = first.replace("100", "9999");

  assert.deepEqual(extractPipcGuideList(first, source), extractPipcGuideList(second, source));
});

test("PIPC article extraction tracks content and attachment identity", () => {
  const html = `
    <table><tr><th>제목</th><td>개인정보 처리방침 작성지침</td></tr>
    <tr><th>작성일</th><td>2026-04-23</td></tr></table>
    <a onclick="javascript:fn_egov_downFile('FILE_1','1','pdf')" alt="지침.pdf">다운로드</a>
    <td class="tbl_cnts"><p>공식 지침 본문입니다.</p></td>`;
  const article = extractPipcArticle(html, { name: "작성지침" });

  assert.equal(article.title, "개인정보 처리방침 작성지침");
  assert.equal(article.attachments[0].fileId, "FILE_1");
  assert.equal(article.attachments[0].name, "지침.pdf");
  assert.match(article.content, /공식 지침/);
});

test("PIPC article monitoring fingerprints attachment bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "law-lens-attachment-"));
  const sources = path.join(root, "legal-sources.json");
  const snapshot = path.join(root, "snapshot.json");
  const report = path.join(root, "report.md");
  const attachmentBytes = Buffer.from("official-guideline-binary-v1");
  const articleHtml = `
    <table><tr><th>제목</th><td>개인정보 처리방침 작성지침</td></tr>
    <tr><th>작성일</th><td>2026-04-23</td></tr></table>
    <a onclick="javascript:fn_egov_downFile('FILE_1','1','pdf')" alt="지침.pdf">다운로드</a>
    <td class="tbl_cnts"><p>공식 지침 본문입니다.</p></td>`;

  try {
    await writeFile(
      sources,
      `${JSON.stringify({
        schemaVersion: 1,
        sources: [
          {
            id: "guideline",
            name: "개인정보 처리방침 작성지침",
            type: "pipc_article",
            url: "https://www.pipc.go.kr/np/article",
          },
        ],
      })}\n`,
    );
    await runMonitor({
      initialize: true,
      sources,
      snapshot,
      report,
      now: () => "2026-08-09T00:17:00.000Z",
      sleepImpl: async () => {},
      fetchImpl: async (url) => {
        if (String(url).includes("FileDown.do")) {
          return new Response(attachmentBytes, {
            status: 200,
            headers: {
              "content-type": "application/octet-stream",
              "content-length": String(attachmentBytes.byteLength),
            },
          });
        }
        return new Response(articleHtml, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    });

    const saved = JSON.parse(await readFile(snapshot, "utf8"));
    const attachment = saved.sources.guideline.article.attachments[0];
    assert.equal(attachment.sizeBytes, attachmentBytes.byteLength);
    assert.equal(
      attachment.contentHash,
      `sha256:${createHash("sha256").update(attachmentBytes).digest("hex")}`,
    );
    assert.equal(
      pipcAttachmentUrl("https://www.pipc.go.kr/np/article", attachment).pathname,
      "/np/cmm/fms/FileDown.do",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("monitor flow leaves snapshot and report untouched when nothing changed", async () => {
  const fixture = await createMonitorFixture();
  let html = guideHtml();
  try {
    await runMonitor({
      ...fixture,
      initialize: true,
      now: () => "2026-08-09T00:17:00.000Z",
      fetchImpl: htmlFetch(() => html),
      sleepImpl: async () => {},
    });
    const snapshotBefore = await readFile(fixture.snapshot, "utf8");
    const reportBefore = await readFile(fixture.report, "utf8");
    await writeFile(fixture.githubOutput, "");

    const result = await runMonitor({
      ...fixture,
      now: () => "2026-08-10T00:17:00.000Z",
      fetchImpl: htmlFetch(() => html),
      sleepImpl: async () => {},
    });

    assert.equal(result.changed, false);
    assert.equal(await readFile(fixture.snapshot, "utf8"), snapshotBefore);
    assert.equal(await readFile(fixture.report, "utf8"), reportBefore);
    assert.match(await readFile(fixture.githubOutput, "utf8"), /changed=false/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("article hashes ignore API metadata but preserve meaningful nested text", () => {
  const baseArticle = {
    조문키: "0030000",
    조문번호: "30",
    조문가지번호: "",
    조문제목: "개인정보 처리방침의 수립 및 공개",
    조문내용: "제30조(개인정보 처리방침의 수립 및 공개) 개인정보처리자는 처리방침을 정하여야 한다.",
    조문시행일자: "20250911",
    조문변경여부: "N",
    조문이동이전: "",
    조문이동이후: "",
    항: {
      항단위: [
        {
          항번호: "①",
          항내용: "① 다음 각 호의 사항이 포함되어야 한다.",
          항제개정일자: "20230314",
          호: {
            호단위: [
              {
                호번호: "1.",
                호내용: "1. 개인정보의 처리 목적",
                호변경여부: "N",
              },
            ],
          },
        },
      ],
    },
  };
  const metadataOnly = structuredClone(baseArticle);
  metadataOnly.조문시행일자 = "20260911";
  metadataOnly.조문변경여부 = "Y";
  metadataOnly.조문이동이전 = "제29조";
  metadataOnly.항.항단위[0].항제개정일자 = "20260401";
  metadataOnly.항.항단위[0].호.호단위[0].호변경여부 = "Y";
  const bodyChange = structuredClone(baseArticle);
  bodyChange.항.항단위[0].호.호단위[0].호내용 = "1. 개인정보의 처리 목적과 법적 근거";

  const baseHash = articleMap({ 조문: { 조문단위: baseArticle } })["0030000"].hash;
  const metadataHash = articleMap({ 조문: { 조문단위: metadataOnly } })["0030000"].hash;
  const changedHash = articleMap({ 조문: { 조문단위: bodyChange } })["0030000"].hash;

  assert.equal(metadataHash, baseHash);
  assert.notEqual(changedHash, baseHash);
});

test("staged effective dates are extracted from defensive appendix shapes", () => {
  const lawBody = {
    부칙: {
      부칙단위: {
        부칙키: "2026031021445",
        부칙공포번호: "21445",
        부칙공포일자: "20260310",
        부칙내용: [
          [
            "부칙 <제21445호, 2026. 3. 10.>",
            "제1조(시행일) 이 법은 공포 후 6개월이 경과한 날부터 시행한다. 다만, 제32조의2제1항 단서는 2027년 7월 1일부터 시행한다.",
            "제2조(적용례) 이 법 시행 후부터 적용한다.",
          ],
        ],
      },
    },
  };

  const stages = extractStageEffectiveDates(lawBody, {
    promulgationNumber: "제21445호",
    promulgationDate: "2026-03-10",
    knownEffectiveDates: ["20260911"],
  });

  assert.deepEqual(
    stages.map((stage) => stage.effectiveDate),
    ["20260911", "20270701"],
  );
  assert.equal(stages[0].source, "law-search");
  assert.equal(stages[1].source, "appendix-explicit");
  assert.match(stages[1].basisText, /2027년 7월 1일/);
});

test("relative promulgation periods capture Decree 36121's 2027-02-20 stage", () => {
  const lawBody = {
    부칙: {
      부칙단위: {
        부칙키: "2026021936121",
        부칙공포번호: "36121",
        부칙공포일자: "20260219",
        부칙내용: [
          "부칙 <제36121호, 2026. 2. 19.>",
          "제1조(시행일) 이 영은 공포 후 6개월이 경과한 날부터 시행한다. 다만, 제42조의2제1항제1호의 개정규정은 공포 후 1년이 경과한 날부터 시행한다.",
        ],
      },
    },
  };

  const stages = extractStageEffectiveDates(lawBody, {
    promulgationNumber: "36121",
    promulgationDate: "20260219",
    knownEffectiveDates: ["20260820"],
  });

  assert.deepEqual(
    stages.map((stage) => stage.effectiveDate),
    ["20260820", "20270220"],
  );
  assert.equal(stages[0].source, "law-search");
  assert.equal(stages[1].source, "appendix-relative");
  assert.match(stages[1].basisText, /공포 후 1년/);
  assert.equal(
    calculateRelativePromulgationEffectiveDate("20260219", { years: 1 }),
    "20270220",
  );
  assert.equal(
    calculateRelativePromulgationEffectiveDate("20240131", { months: 1 }),
    "20240301",
    "month arithmetic must clamp to leap-year February before adding the commencement day",
  );
});

test("semantic source fingerprints include stage dates and parser version", () => {
  const base = {
    versionIdentity: {
      id: "283503:20260820",
      state: "시행예정",
      effectiveDate: "20260820",
    },
    documentHash: "same-semantic-law-text",
    articleHashes: { "0042020": "same-article-hash" },
    stageEffectiveDates: [
      { effectiveDate: "20260820", source: "law-search" },
    ],
  };
  const digest = (value) =>
    createHash("sha256").update(canonicalize(value)).digest("hex");
  const current = semanticVersionFingerprintPayload(base);
  const addedStage = semanticVersionFingerprintPayload({
    ...base,
    stageEffectiveDates: [
      ...base.stageEffectiveDates,
      { effectiveDate: "20270220", source: "appendix-relative" },
    ],
  });
  const upgradedParser = semanticVersionFingerprintPayload({
    ...base,
    stageEffectiveDateAlgorithm: `${STAGE_EFFECTIVE_DATE_ALGORITHM}-next`,
  });

  assert.equal(
    current.stageEffectiveDateAlgorithm,
    STAGE_EFFECTIVE_DATE_ALGORITHM,
  );
  assert.notEqual(digest(current), digest(addedStage));
  assert.notEqual(digest(current), digest(upgradedParser));

  const previousSnapshot = {
    sources: {
      "pipa-decree": {
        name: "개인정보 보호법 시행령",
        officialUrl: "https://www.law.go.kr/example",
        contentHashAlgorithm: "legal-semantic-text-v1",
        stageEffectiveDateAlgorithm: "promulgation-calendar-period-v1",
        contentFingerprint: digest({
          ...current,
          stageEffectiveDateAlgorithm: "promulgation-calendar-period-v1",
        }),
        versions: [
          {
            ...base.versionIdentity,
            documentHash: base.documentHash,
            stageEffectiveDates: base.stageEffectiveDates,
          },
        ],
      },
    },
  };
  const currentSnapshot = structuredClone(previousSnapshot);
  const currentSource = currentSnapshot.sources["pipa-decree"];
  currentSource.stageEffectiveDateAlgorithm = STAGE_EFFECTIVE_DATE_ALGORITHM;
  currentSource.contentFingerprint = digest(addedStage);
  currentSource.versions[0].stageEffectiveDates = addedStage.stageEffectiveDates;

  const changes = compareSnapshots(previousSnapshot, currentSnapshot);
  assert.equal(changes.length, 1);
  assert.match(changes[0].details.join(" "), /단계 시행일 추출 기준 변경/);
  assert.match(changes[0].details.join(" "), /단계 시행일 추가: 20270220/);
});

test("semantic source fingerprints suppress legacy metadata-only changes", () => {
  const previous = {
    sources: {
      pipa: {
        name: "개인정보 보호법",
        officialUrl: "https://law.go.kr/example",
        fingerprint: "legacy-before-metadata-refresh",
        contentHashAlgorithm: "legal-semantic-text-v1",
        contentFingerprint: "same-legal-text",
      },
    },
  };
  const current = structuredClone(previous);
  current.sources.pipa.fingerprint = "legacy-after-metadata-refresh";

  assert.deepEqual(compareSnapshots(previous, current), []);
});

test("official-source fetches use bounded exponential retries", async () => {
  const fixture = await createMonitorFixture();
  let calls = 0;
  const delays = [];
  try {
    const result = await runMonitor({
      ...fixture,
      initialize: true,
      now: () => "2026-08-09T00:17:00.000Z",
      fetchImpl: async () => {
        calls += 1;
        if (calls < 3) return new Response("temporary outage", { status: 503 });
        return new Response(guideHtml(), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
      sleepImpl: async (delay) => delays.push(delay),
    });

    assert.equal(result.initialized, true);
    assert.equal(calls, 3);
    assert.deepEqual(delays, [750, 1_500]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("official-source fetches do not retry permanent client errors", async () => {
  const fixture = await createMonitorFixture();
  let calls = 0;
  const delays = [];
  try {
    await assert.rejects(
      runMonitor({
        ...fixture,
        initialize: true,
        now: () => "2026-08-09T00:17:00.000Z",
        fetchImpl: async () => {
          calls += 1;
          return new Response("not found", { status: 404 });
        },
        sleepImpl: async (delay) => delays.push(delay),
      }),
      /HTTP 404/,
    );

    assert.equal(calls, 1);
    assert.deepEqual(delays, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("monitor flow writes a new snapshot and report for one source change", async () => {
  const fixture = await createMonitorFixture();
  let html = guideHtml();
  try {
    await runMonitor({
      ...fixture,
      initialize: true,
      now: () => "2026-08-09T00:17:00.000Z",
      fetchImpl: htmlFetch(() => html),
      sleepImpl: async () => {},
    });
    const snapshotBefore = await readFile(fixture.snapshot, "utf8");
    await writeFile(fixture.githubOutput, "");
    html = guideHtml({ suffix: " 개정" });

    const result = await runMonitor({
      ...fixture,
      now: () => "2026-08-10T00:17:00.000Z",
      fetchImpl: htmlFetch(() => html),
      sleepImpl: async () => {},
    });

    assert.equal(result.changed, true);
    assert.notEqual(await readFile(fixture.snapshot, "utf8"), snapshotBefore);
    assert.match(await readFile(fixture.report, "utf8"), /테스트 개인정보 안내서 목록/);
    assert.match(await readFile(fixture.githubOutput, "utf8"), /changed=true/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("monitor flow preserves previous files when one source request fails", async () => {
  const fixture = await createMonitorFixture();
  try {
    await runMonitor({
      ...fixture,
      initialize: true,
      now: () => "2026-08-09T00:17:00.000Z",
      fetchImpl: htmlFetch(() => guideHtml()),
      sleepImpl: async () => {},
    });
    const snapshotBefore = await readFile(fixture.snapshot, "utf8");
    const reportBefore = await readFile(fixture.report, "utf8");
    await writeFile(fixture.githubOutput, "");

    await assert.rejects(
      runMonitor({
        ...fixture,
        now: () => "2026-08-10T00:17:00.000Z",
        fetchImpl: async () => {
          throw new Error("network unavailable");
        },
        sleepImpl: async () => {},
      }),
      /공식 소스 확인 실패/,
    );

    assert.equal(await readFile(fixture.snapshot, "utf8"), snapshotBefore);
    assert.equal(await readFile(fixture.report, "utf8"), reportBefore);
    const output = await readFile(fixture.githubOutput, "utf8");
    assert.match(output, /failed=true/);
    assert.match(output, /failed_source_count=1/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("failed monitor status preserves the last successful check", () => {
  const successful = buildMonitorStatus({
    previous: {},
    result: "no_changes",
    checkedAt: "2026-08-09T00:17:00.000Z",
    sourceCount: 11,
    failedSources: 0,
    workflowRunUrl: "https://github.com/example/actions/runs/1",
  });
  const failed = buildMonitorStatus({
    previous: successful,
    result: "failed",
    checkedAt: "2026-08-10T00:17:00.000Z",
    sourceCount: 11,
    failedSources: 1,
    workflowRunUrl: "https://github.com/example/actions/runs/2",
  });

  assert.equal(failed.lastSuccessfulCheckAt, successful.lastSuccessfulCheckAt);
  assert.equal(failed.lastAttemptAt, "2026-08-10T00:17:00.000Z");
  assert.equal(failed.lastResult, "failed");
  assert.equal(failed.consecutiveFailures, 1);
  assert.equal(failed.recentRuns.length, 2);
  assert.equal(failed.recentRuns[1].result, "failed");
  assert.equal(failed.stale, false);
});

test("monitor status records stale failures and a later recovery", () => {
  const successful = buildMonitorStatus({
    previous: {},
    result: "no_changes",
    checkedAt: "2026-08-09T00:00:00.000Z",
    sourceCount: 11,
    failedSources: 0,
    workflowRunUrl: "https://github.com/example/actions/runs/1",
  });
  const firstFailure = buildMonitorStatus({
    previous: successful,
    result: "failed",
    checkedAt: "2026-08-10T00:00:00.000Z",
    sourceCount: 11,
    failedSources: 11,
    workflowRunUrl: "https://github.com/example/actions/runs/2",
  });
  const staleFailure = buildMonitorStatus({
    previous: firstFailure,
    result: "failed",
    checkedAt: "2026-08-11T00:01:00.000Z",
    sourceCount: 11,
    failedSources: 2,
    workflowRunUrl: "https://github.com/example/actions/runs/3",
    workflowRunAttempt: 2,
  });
  const recovered = buildMonitorStatus({
    previous: staleFailure,
    result: "changes_detected",
    checkedAt: "2026-08-11T00:10:00.000Z",
    sourceCount: 11,
    failedSources: 0,
    workflowRunUrl: "https://github.com/example/actions/runs/3",
    workflowRunAttempt: 3,
    historyLimit: 3,
  });

  assert.equal(staleFailure.consecutiveFailures, 2);
  assert.equal(staleFailure.stale, true);
  assert.equal(staleFailure.staleAfter, "2026-08-10T12:00:00.000Z");
  assert.equal(recovered.consecutiveFailures, 0);
  assert.equal(recovered.stale, false);
  assert.equal(recovered.recoveredAt, "2026-08-11T00:10:00.000Z");
  assert.equal(recovered.recentRuns.length, 3);
  assert.deepEqual(
    recovered.recentRuns.map((run) => run.result),
    ["failed", "failed", "changes_detected"],
  );
  assert.equal(recovered.recentRuns.at(-1).workflowRunAttempt, 3);
  assert.equal(recovered.recentRuns.at(-1).recovered, true);
});

test("change report makes human review mandatory", () => {
  const report = buildChangeReport(
    [
      {
        name: "개인정보 보호법",
        officialUrl: "https://law.go.kr/example",
        details: ["시행예정 버전 추가"],
      },
    ],
    "2026-08-08T00:17:00.000Z",
  );

  assert.match(report, /사람 검토 전/);
  assert.match(report, /분석 규칙 자동 반영 안 됨/);
  assert.match(report, /회귀 사례/);
});

test("a second bot update preserves human commits on an open review branch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "law-lens-legal-review-"));
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const runner = path.join(root, "runner");
  const reviewBranch = "automation/legal-source-update-100";

  try {
    git(root, "init", "--bare", remote);
    git(root, "init", seed);
    git(seed, "config", "user.name", "Initial Author");
    git(seed, "config", "user.email", "initial@example.com");
    await mkdir(path.join(seed, "data"), { recursive: true });
    await mkdir(path.join(seed, "reports", "legal-updates"), { recursive: true });
    await mkdir(path.join(seed, "lib"), { recursive: true });
    await writeFile(
      path.join(seed, "data", "legal-source-snapshot.json"),
      '{"version":1}\n',
    );
    await writeFile(path.join(seed, "reports", "legal-updates", "latest.md"), "기준선\n");
    await writeFile(path.join(seed, "lib", "legal-baseline.ts"), "export const rule = 1;\n");
    git(seed, "add", ".");
    git(seed, "commit", "-m", "Initial main");
    git(seed, "branch", "-M", "main");
    git(seed, "remote", "add", "origin", remote);
    git(seed, "push", "-u", "origin", "main");

    git(seed, "switch", "-c", reviewBranch);
    git(seed, "config", "user.name", "github-actions[bot]");
    git(
      seed,
      "config",
      "user.email",
      "41898282+github-actions[bot]@users.noreply.github.com",
    );
    await writeFile(
      path.join(seed, "data", "legal-source-snapshot.json"),
      '{"version":2}\n',
    );
    await writeFile(
      path.join(seed, "reports", "legal-updates", "latest.md"),
      "첫 자동 보고서\n",
    );
    git(seed, "add", "data/legal-source-snapshot.json", "reports/legal-updates/latest.md");
    git(seed, "commit", "-m", "First bot update");

    git(seed, "config", "user.name", "Human Reviewer");
    git(seed, "config", "user.email", "reviewer@example.com");
    await mkdir(path.join(seed, "tests"), { recursive: true });
    await writeFile(path.join(seed, "lib", "legal-baseline.ts"), "export const rule = 2;\n");
    await writeFile(path.join(seed, "tests", "human-review.test.mjs"), "// human test\n");
    git(seed, "add", "lib/legal-baseline.ts", "tests/human-review.test.mjs");
    git(seed, "commit", "-m", "Human legal review");
    git(seed, "push", "-u", "origin", reviewBranch);

    git(root, "clone", "--branch", "main", remote, runner);
    git(runner, "config", "user.name", "github-actions[bot]");
    git(
      runner,
      "config",
      "user.email",
      "41898282+github-actions[bot]@users.noreply.github.com",
    );
    git(
      runner,
      "fetch",
      "origin",
      `refs/heads/${reviewBranch}:refs/remotes/origin/${reviewBranch}`,
    );

    const generatedSnapshot = path.join(root, "generated-snapshot.json");
    const generatedReport = path.join(root, "generated-report.md");
    await writeFile(generatedSnapshot, '{"version":3}\n');
    await writeFile(generatedReport, "두 번째 자동 보고서\n");
    const result = await syncReviewBranch({
      repoDir: runner,
      branch: reviewBranch,
      existing: true,
      snapshotPath: generatedSnapshot,
      reportPath: generatedReport,
    });

    assert.equal(result.committed, true);
    assert.equal(result.humanCommitCount, 1);
    assert.equal(
      git(root, "--git-dir", remote, "show", `refs/heads/${reviewBranch}:lib/legal-baseline.ts`),
      "export const rule = 2;",
    );
    assert.equal(
      git(root, "--git-dir", remote, "show", `refs/heads/${reviewBranch}:tests/human-review.test.mjs`),
      "// human test",
    );
    assert.equal(
      git(
        root,
        "--git-dir",
        remote,
        "show",
        `refs/heads/${reviewBranch}:data/legal-source-snapshot.json`,
      ),
      '{"version":3}',
    );
    const history = git(root, "--git-dir", remote, "log", "--format=%s", reviewBranch);
    assert.match(history, /Human legal review/);
    assert.match(history, /Detect official legal source updates/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow avoids force pushes and keeps human-authored PR text", async () => {
  const workflow = await readFile(".github/workflows/legal-update-monitor.yml", "utf8");
  assert.doesNotMatch(workflow, /push --force|force-with-lease/);
  assert.doesNotMatch(workflow, /gh pr edit/);
  assert.match(workflow, /gh pr comment/);
  assert.match(workflow, /Publish machine-readable monitor status/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /Notify or resolve legal monitor incident/);
  assert.match(workflow, /Notify or resolve legal automation pipeline incident/);
  assert.match(workflow, /headRepositoryOwner,isCrossRepository/);
  assert.match(workflow, /\.isCrossRepository == false/);
  assert.match(workflow, /Revalidate the review destination/);
  assert.match(workflow, /git rev-list --count origin\/main\.\.HEAD/);
  assert.match(workflow, /gh issue create/);
  assert.match(workflow, /gh issue comment/);
  assert.match(workflow, /gh issue close/);
  assert.match(workflow, /--historyLimit 7/);
  assert.match(workflow, /--staleAfterHours 36/);
  assert.match(workflow, /npm test/);
  assert.ok(
    workflow.indexOf("Prepare safe review baseline") <
      workflow.indexOf("Check official legal sources from trusted code"),
  );
  assert.ok(
    workflow.indexOf("Publish machine-readable monitor status") <
      workflow.indexOf("Append bot commit without rewriting review history"),
  );
});
