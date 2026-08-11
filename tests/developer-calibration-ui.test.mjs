import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createEmptyDeveloperCalibrationDataset,
  serializeDeveloperCalibrationDataset,
} from "../lib/developer-calibration.mjs";
import { sanitizeCalibrationWorkspace } from "../lib/developer-calibration-local.ts";
import {
  assertCalibrationAnalyzerOutputCompatible,
  assertCalibrationTransferCompatible,
  assertCalibrationTransferLegalCohortCompatible,
  buildCalibrationTransferPayload,
  calibrationAnalyzerOutputIdentity,
  parseCalibrationTransferPayload,
} from "../lib/developer-calibration-transfer.ts";

function analysisFixture() {
  const evidence = "해외 서버를 통해 개인정보를 처리할 수 있습니다.";
  return {
    sourceUrl: "https://secret.example/home",
    policyUrl: "https://secret.example/privacy",
    policyTitle: "표시용 테스트 방침",
    retrievedAt: "2026-08-12T00:00:00.000Z",
    documentHash: "a".repeat(64),
    policyExcerpt: `discard-policy-excerpt ${evidence}`,
    findings: [
      {
        id: "overseas-recipient",
        category: "국외 이전",
        title: "이전받는 자를 확인해 주세요",
        severity: "high",
        findingType: "possible_missing_disclosure",
        requiresFactualVerification: true,
        summary: "국외 이전 수탁자 정보가 충분한지 확인합니다.",
        evidence: `${evidence}${"가".repeat(900)}`,
        recommendation: "국가와 이전받는 자를 함께 확인하세요.",
        legalBasis: [
          {
            sourceId: "pipa-enforcement-decree",
            law: "개인정보 보호법 시행령",
            article: "제31조",
            url: "https://law.go.kr/secret-link",
          },
        ],
      },
    ],
    humanReview: {
      entries: {
        "overseas-recipient": { note: "discard-human-review-note" },
      },
    },
    analysisEngine: {
      version: "KR-PRIVACY-2026.08.11-r4",
    },
    legalBaseline: {
      rulesetVersion: "KR-PRIVACY-2026.08.11-r4",
      asOfDate: "2026-08-12",
      overdueLegalReview: false,
      runtimeManifest: {
        status: "valid",
        source: "bundled",
        generatedAt: "2026-08-11T00:00:00.000Z",
        canonicalSha256: "b".repeat(64),
        legalStateSha256: "c".repeat(64),
      },
    },
  };
}

async function fetchCalibrationPage() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("calibration-ui", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/calibration", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

function builtCalibrationChunks() {
  const roots = [
    new URL("../dist/server/ssr/assets/", import.meta.url),
    new URL("../dist/client/assets/", import.meta.url),
  ];
  return roots.flatMap((root) =>
    readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith("CalibrationWorkspace-") &&
          entry.name.endsWith(".js"),
      )
      .map((entry) => new URL(entry.name, root)),
  );
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

test("server-renders the developer-only notice and all 24 slots", async () => {
  const response = await fetchCalibrationPage();
  assert.equal(response.status, 200);
  const html = await response.text();
  const text = visibleText(html);
  assert.match(text, /개발자 사전 교정 · 전문가 평가 아님/);
  assert.match(text, /표본 24개/);
  assert.match(text, /사례 수집 중 · 정확도 의미 아님/);
  assert.match(text, /slot-01/);
  assert.match(text, /slot-24/);
});

test("calibration deploy artifacts are CSP-safe and render with string code generation disabled", () => {
  const chunks = builtCalibrationChunks();
  assert.equal(chunks.length, 2, "expected one client and one SSR calibration chunk");
  for (const chunk of chunks) {
    const code = readFileSync(chunk, "utf8");
    assert.doesNotMatch(code, /ajv(?:-formats|\/dist)?|compileSchema/iu);
    assert.doesNotMatch(code, /\b(?:eval|Function)\s*\(/u);
  }

  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const evalDisabledFetch = spawnSync(
    process.execPath,
    [
      "--disallow-code-generation-from-strings",
      "--input-type=module",
      "--eval",
      `const workerUrl = new URL("./dist/server/index.js?csp-test=${Date.now()}", import.meta.url);
       const { default: worker } = await import(workerUrl);
       const response = await worker.fetch(
         new Request("http://localhost/calibration", { headers: { accept: "text/html", host: "localhost" } }),
         { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
         { waitUntil() {}, passThroughOnException() {} },
       );
       if (response.status !== 200) throw new Error("Unexpected status " + response.status);
       await response.text();`,
    ],
    { cwd: projectRoot, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(
    evalDisabledFetch.status,
    0,
    `eval-disabled calibration render failed:\n${evalDisabledFetch.stderr || evalDisabledFetch.stdout}`,
  );
});

test("transfer whitelists transient review data and rejects oversized JSON", () => {
  const transfer = buildCalibrationTransferPayload(analysisFixture());
  const serialized = JSON.stringify(transfer);

  assert.equal(transfer.findings[0].evidence.length, 800);
  assert.doesNotMatch(serialized, /discard-policy-excerpt/);
  assert.doesNotMatch(serialized, /secret\.example/);
  assert.doesNotMatch(serialized, /discard-human-review-note/);
  assert.doesNotMatch(serialized, /law\.go\.kr\/secret-link/);
  assert.throws(
    () => parseCalibrationTransferPayload("x".repeat(2_000_001)),
    /2MB/,
  );
});

test("local sanitizer keeps display metadata separate from canonical backup", () => {
  const dataset = createEmptyDeveloperCalibrationDataset();
  const sanitized = sanitizeCalibrationWorkspace({
    schemaVersion: 1,
    savedAt: "2026-08-12T00:00:00.000Z",
    dataset,
    presentations: {
      "slot-01": {
        slotId: "slot-01",
        organizationAlias: "로컬 별칭",
        policyTitle: "로컬 표시 제목",
        importedAt: "2026-08-12T00:00:00.000Z",
        findings: [
          {
            findingId: "overseas-recipient",
            ruleId: "overseas-recipient",
            category: "국외 이전",
            title: "표시 제목",
            severity: "high",
            findingType: "possible_missing_disclosure",
            requiresFactualVerification: true,
            evidence: "discard-indexeddb-evidence",
            summary: "discard-indexeddb-summary",
            legalBasis: [],
          },
        ],
      },
    },
  });
  const localJson = JSON.stringify(sanitized);
  assert.doesNotMatch(localJson, /discard-indexeddb-evidence/);
  assert.doesNotMatch(localJson, /discard-indexeddb-summary/);

  const canonical = serializeDeveloperCalibrationDataset(dataset);
  assert.doesNotMatch(canonical, /presentations/);
  assert.doesNotMatch(canonical, /로컬 별칭/);
  assert.doesNotMatch(canonical, /policyTitle/);
});

test("provenance and analyzer-output mismatches fail closed", () => {
  const transfer = buildCalibrationTransferPayload(analysisFixture());
  const dataset = createEmptyDeveloperCalibrationDataset();

  assert.equal(
    assertCalibrationTransferCompatible(transfer, dataset.pins),
    transfer,
  );
  assert.throws(
    () =>
      assertCalibrationTransferCompatible(
        { ...transfer, rulesetVersion: "KR-PRIVACY-older" },
        dataset.pins,
      ),
    /같은 버전/,
  );
  assert.throws(
    () =>
      assertCalibrationTransferLegalCohortCompatible(transfer, {
        rulesetVersion: transfer.rulesetVersion,
        runtimeLegalStateSha256: `sha256:${"d".repeat(64)}`,
      }),
    /새 교정 데이터셋/,
  );
  assert.throws(
    () =>
      assertCalibrationAnalyzerOutputCompatible(
        `sha256:${"1".repeat(64)}`,
        `sha256:${"2".repeat(64)}`,
      ),
    /분석 결과가 다릅니다/,
  );
  assert.notDeepEqual(
    calibrationAnalyzerOutputIdentity(transfer),
    calibrationAnalyzerOutputIdentity({
      ...transfer,
      findings: [
        { ...transfer.findings[0], evidence: "다른 발견 문구" },
      ],
    }),
  );
});

test("canonical export does not change dataset revision", () => {
  const dataset = createEmptyDeveloperCalibrationDataset();
  const revision = dataset.datasetRevision;
  const updatedAt = dataset.updatedAt;
  serializeDeveloperCalibrationDataset(dataset);
  assert.equal(dataset.datasetRevision, revision);
  assert.equal(dataset.updatedAt, updatedAt);
});
