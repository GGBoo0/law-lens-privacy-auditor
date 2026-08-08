import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LAW_API_BASE = "https://www.law.go.kr/DRF";
const USER_AGENT =
  "LawLensPrivacyKR/1.0 (+https://github.com/GGBoo0/law-lens-privacy-auditor)";

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort((a, b) => a.localeCompare(b, "ko"))
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'");
}

function cleanText(value = "") {
  return decodeHtml(
    String(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function pick(object, keys) {
  return Object.fromEntries(
    keys.filter((key) => object?.[key] !== undefined).map((key) => [key, object[key]]),
  );
}

async function fetchText(url, fetchImpl = fetch) {
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/json,text/html;q=0.9,*/*;q=0.8",
          "user-agent": USER_AGENT,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(25_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
  }

  throw lastError;
}

async function fetchJson(url, fetchImpl = fetch) {
  const text = await fetchText(url, fetchImpl);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`공식 API가 JSON이 아닌 응답을 반환했습니다: ${url}`);
  }
}

function lawApiUrl(endpoint, parameters) {
  const url = new URL(`${LAW_API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

function articleMap(lawBody) {
  const units = toArray(lawBody?.조문?.조문단위);
  return Object.fromEntries(
    units.map((unit, index) => {
      const key = String(unit?.조문키 || unit?.조문번호 || index + 1);
      return [
        key,
        {
          label: cleanText(unit?.조문내용 || `조문 ${key}`).slice(0, 140),
          hash: fingerprint(unit),
        },
      ];
    }),
  );
}

async function collectLaw(source, options) {
  const searchUrl = lawApiUrl("lawSearch.do", {
    OC: options.oc,
    target: "eflaw",
    type: "JSON",
    query: source.query,
    display: 100,
  });
  const search = await fetchJson(searchUrl, options.fetchImpl);
  const rows = toArray(search?.LawSearch?.law)
    .filter((row) => row?.법령명한글 === source.exactName)
    .filter((row) => ["현행", "시행예정"].includes(row?.현행연혁코드))
    .sort((a, b) =>
      `${a?.시행일자 || ""}-${a?.법령일련번호 || ""}`.localeCompare(
        `${b?.시행일자 || ""}-${b?.법령일련번호 || ""}`,
      ),
    );

  if (rows.length === 0) {
    throw new Error(`${source.exactName}의 현행·시행예정 법령을 찾지 못했습니다.`);
  }

  const versions = [];
  const bodyCache = new Map();
  for (const row of rows) {
    let response = bodyCache.get(String(row.법령일련번호));
    if (!response) {
      const bodyUrl = lawApiUrl("lawService.do", {
        OC: options.oc,
        target: "law",
        MST: row.법령일련번호,
        type: "JSON",
      });
      response = await fetchJson(bodyUrl, options.fetchImpl);
      bodyCache.set(String(row.법령일련번호), response);
    }
    const lawBody = response?.법령;
    if (!lawBody?.기본정보 || !lawBody?.조문) {
      throw new Error(`${source.exactName} 본문 구조를 확인할 수 없습니다.`);
    }

    const stableBody = {
      기본정보: pick(lawBody.기본정보, [
        "법령명_한글",
        "공포번호",
        "제개정구분",
        "법령ID",
        "법종구분",
        "시행일자",
        "공포일자",
      ]),
      개정문: lawBody.개정문,
      조문: lawBody.조문,
      부칙: lawBody.부칙,
      제개정이유: lawBody.제개정이유,
    };

    versions.push({
      id: `${row.법령일련번호}:${row.시행일자 || "unknown"}`,
      state: row.현행연혁코드,
      effectiveDate: String(row.시행일자 || ""),
      promulgationDate: String(row.공포일자 || ""),
      promulgationNumber: String(row.공포번호 || ""),
      revisionType: String(row.제개정구분명 || ""),
      documentHash: fingerprint(stableBody),
      articles: articleMap(lawBody),
    });
  }

  return {
    id: source.id,
    name: source.name,
    type: source.type,
    officialUrl: source.officialUrl,
    fingerprint: fingerprint(
      versions.map(({ articles, ...version }) => ({
        ...version,
        articleHashes: Object.fromEntries(
          Object.entries(articles).map(([key, value]) => [key, value.hash]),
        ),
      })),
    ),
    versions,
  };
}

async function collectAdministrativeRule(source, options) {
  const searchUrl = lawApiUrl("lawSearch.do", {
    OC: options.oc,
    target: "admrul",
    type: "JSON",
    query: source.query,
    display: 20,
  });
  const search = await fetchJson(searchUrl, options.fetchImpl);
  const row = toArray(search?.AdmRulSearch?.admrul).find(
    (item) => item?.행정규칙명 === source.exactName,
  );

  if (!row?.행정규칙일련번호) {
    throw new Error(`${source.exactName}의 현행 행정규칙을 찾지 못했습니다.`);
  }

  const bodyUrl = lawApiUrl("lawService.do", {
    OC: options.oc,
    target: "admrul",
    ID: row.행정규칙일련번호,
    type: "JSON",
  });
  const response = await fetchJson(bodyUrl, options.fetchImpl);
  const body = response?.AdmRulService;
  if (!body) {
    throw new Error(`${source.exactName} 본문 구조를 확인할 수 없습니다.`);
  }

  const version = {
    id: String(row.행정규칙일련번호),
    state: String(row.현행연혁구분 || "현행"),
    effectiveDate: String(row.시행일자 || ""),
    promulgationDate: String(row.발령일자 || ""),
    promulgationNumber: String(row.발령번호 || ""),
    revisionType: String(row.제개정구분명 || ""),
    documentHash: fingerprint(body),
    articles: {},
  };

  return {
    id: source.id,
    name: source.name,
    type: source.type,
    officialUrl: source.officialUrl,
    fingerprint: fingerprint(version),
    versions: [version],
  };
}

export function extractPipcGuideList(html, source) {
  const items = [];
  const anchorPattern =
    /<a\s+[^>]*href=["']([^"']*selectBoardArticle\.do[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const title = cleanText(match[2]);
    if (!source.keywords.some((keyword) => title.includes(keyword))) continue;

    const rowStart = html.lastIndexOf("<tr", match.index);
    const rowEnd = html.indexOf("</tr>", match.index);
    const rowHtml =
      rowStart >= 0 && rowEnd >= 0 ? html.slice(rowStart, rowEnd + 5) : "";
    const publishedAt = rowHtml.match(/20\d{2}-\d{2}-\d{2}/)?.[0] || "";
    items.push({
      title,
      publishedAt,
      url: new URL(decodeHtml(match[1]), source.url).href,
    });
  }

  return [...new Map(items.map((item) => [item.url, item])).values()].sort((a, b) =>
    `${b.publishedAt}-${b.title}`.localeCompare(`${a.publishedAt}-${a.title}`, "ko"),
  );
}

function tableValue(html, label) {
  const pattern = new RegExp(
    `<th[^>]*>\\s*${label}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`,
    "i",
  );
  return cleanText(html.match(pattern)?.[1] || "");
}

export function extractPipcArticle(html, source) {
  const content = cleanText(
    html.match(/<td[^>]*class=["'][^"']*tbl_cnts[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] ||
      "",
  );
  const attachments = [];
  const attachmentPattern =
    /onclick="[^"]*fn_egov_downFile\('([^']+)','([^']+)','([^']+)'\)[^"]*"[^>]*?(?:alt="([^"]+)")?[^>]*>/gi;

  for (const match of html.matchAll(attachmentPattern)) {
    attachments.push({
      fileId: match[1],
      sequence: match[2],
      extension: match[3],
      name: cleanText(match[4] || "첨부파일"),
    });
  }

  const article = {
    title: tableValue(html, "제목"),
    publishedAt: tableValue(html, "작성일"),
    content,
    attachments: attachments.sort((a, b) =>
      `${a.fileId}-${a.sequence}`.localeCompare(`${b.fileId}-${b.sequence}`),
    ),
  };

  if (!article.title || (!article.content && article.attachments.length === 0)) {
    throw new Error(`${source.name} 게시물 구조를 확인할 수 없습니다.`);
  }

  return article;
}

async function collectPipcGuideList(source, options) {
  const html = await fetchText(source.url, options.fetchImpl);
  const items = extractPipcGuideList(html, source);
  if (items.length === 0) {
    throw new Error(`${source.name}에서 대상 안내서를 찾지 못했습니다.`);
  }
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    officialUrl: source.url,
    fingerprint: fingerprint(items),
    items,
  };
}

async function collectPipcArticle(source, options) {
  const html = await fetchText(source.url, options.fetchImpl);
  const article = extractPipcArticle(html, source);
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    officialUrl: source.url,
    fingerprint: fingerprint(article),
    article,
  };
}

async function collectSource(source, options) {
  if (source.type === "law") return collectLaw(source, options);
  if (source.type === "administrative_rule") {
    return collectAdministrativeRule(source, options);
  }
  if (source.type === "pipc_guide_list") {
    return collectPipcGuideList(source, options);
  }
  if (source.type === "pipc_article") return collectPipcArticle(source, options);
  throw new Error(`지원하지 않는 법령 소스 유형입니다: ${source.type}`);
}

function changedArticles(previousVersion, currentVersion) {
  const previous = previousVersion?.articles || {};
  const current = currentVersion?.articles || {};
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  return [...keys]
    .filter((key) => previous[key]?.hash !== current[key]?.hash)
    .map((key) => current[key]?.label || previous[key]?.label || `조문 ${key}`)
    .slice(0, 20);
}

function describeSourceChange(previous, current) {
  if (!previous) return ["새 감시 대상이 추가되었습니다."];
  if (!current) return ["감시 대상이 설정에서 제거되었습니다."];

  if (current.versions) {
    const oldVersions = new Map((previous.versions || []).map((item) => [item.id, item]));
    const newVersions = new Map((current.versions || []).map((item) => [item.id, item]));
    const details = [];

    for (const [id, version] of newVersions) {
      if (!oldVersions.has(id)) {
        details.push(
          `${version.state} 버전 추가: 시행 ${version.effectiveDate || "미상"}, 공포번호 ${version.promulgationNumber || "미상"}`,
        );
        continue;
      }
      const oldVersion = oldVersions.get(id);
      if (oldVersion.documentHash !== version.documentHash) {
        const articles = changedArticles(oldVersion, version);
        details.push(
          articles.length > 0
            ? `기존 버전 본문 변경 감지: ${articles.join(" / ")}`
            : "기존 버전 본문 또는 부칙·개정이유 변경 감지",
        );
      }
    }

    for (const [id, version] of oldVersions) {
      if (!newVersions.has(id)) {
        details.push(
          `이전 감시 버전 제외: ${version.state}·시행 ${version.effectiveDate || "미상"}`,
        );
      }
    }

    return details.length > 0 ? details : ["법령 메타데이터 변경을 감지했습니다."];
  }

  if (current.items) {
    const oldItems = new Map((previous.items || []).map((item) => [item.url, item]));
    const newItems = new Map(current.items.map((item) => [item.url, item]));
    const added = [...newItems.values()].filter((item) => !oldItems.has(item.url));
    const removed = [...oldItems.values()].filter((item) => !newItems.has(item.url));
    return [
      ...added.map((item) => `안내서 목록 추가: ${item.title}`),
      ...removed.map((item) => `안내서 목록 제외: ${item.title}`),
      ...(added.length === 0 && removed.length === 0
        ? ["안내서 제목 또는 게시일 변경을 감지했습니다."]
        : []),
    ];
  }

  return ["게시물 본문 또는 첨부파일 변경을 감지했습니다."];
}

export function compareSnapshots(previousSnapshot, currentSnapshot) {
  const previous = previousSnapshot?.sources || {};
  const current = currentSnapshot?.sources || {};
  const ids = new Set([...Object.keys(previous), ...Object.keys(current)]);

  return [...ids]
    .filter((id) => previous[id]?.fingerprint !== current[id]?.fingerprint)
    .map((id) => {
      const source = current[id] || previous[id];
      return {
        id,
        name: source.name,
        officialUrl: source.officialUrl,
        details: describeSourceChange(previous[id], current[id]),
      };
    });
}

export function buildChangeReport(changes, checkedAt) {
  const date = checkedAt.slice(0, 10);
  const lines = [
    "# 공식 법령·지침 변경 감지 보고서",
    "",
    `- 확인 시각: ${checkedAt}`,
    `- 변경 감지 소스: ${changes.length}개`,
    "- 상태: 사람 검토 전·분석 규칙 자동 반영 안 됨",
    "",
    "이 보고서는 공식 출처의 변경 사실을 자동 감지한 결과입니다. 변경된 조문이 현재 분석 규칙에 미치는 영향을 확인하고, 필요한 규칙·법적 근거·회귀 테스트를 이 PR에 추가한 뒤 병합하세요.",
    "",
  ];

  for (const change of changes) {
    lines.push(`## ${change.name}`, "", `[공식 원문](${change.officialUrl})`, "");
    for (const detail of change.details) lines.push(`- ${detail}`);
    lines.push("");
  }

  lines.push(
    "## 검토 체크리스트",
    "",
    "- [ ] 시행 중인 규정인지 시행예정 규정인지 확인",
    "- [ ] 개인정보처리방침 법정 기재사항에 미치는 영향 확인",
    "- [ ] `lib/legal-baseline.ts`의 버전·시행일·공식 URL 갱신",
    "- [ ] 영향을 받는 규칙과 양성·음성 회귀 사례 추가",
    "- [ ] 테스트 통과 후 규칙셋 버전과 사람 검토일 갱신",
    "",
    `<!-- legal-monitor:${date} -->`,
  );
  return `${lines.join("\n")}\n`;
}

export function buildInitialReport(snapshot) {
  const upcoming = Object.values(snapshot.sources)
    .flatMap((source) =>
      (source.versions || [])
        .filter((version) => version.state === "시행예정")
        .map((version) => ({
          name: source.name,
          officialUrl: source.officialUrl,
          ...version,
        })),
    )
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const lines = [
    "# 공식 법령·지침 자동 감시 기준선",
    "",
    `- 최초 수집 시각: ${snapshot.capturedAt}`,
    `- 공식 소스: ${snapshot.sourceCount}개`,
    "- 상태: 자동 감시 기준선 생성 완료",
    "",
    "이 파일은 최초 감시 기준선입니다. 아래 시행예정 법령은 자동 적용하지 않으며, 시행 전 분석 규칙 영향을 별도로 검토합니다.",
    "",
    "## 최초 수집 시 확인된 시행예정 법령",
    "",
  ];

  if (upcoming.length === 0) {
    lines.push("- 없음");
  } else {
    for (const version of upcoming) {
      lines.push(
        `- [${version.name}](${version.officialUrl}) · 시행 ${version.effectiveDate} · ${version.promulgationNumber || "공포번호 미상"} · ${version.revisionType || "개정 유형 미상"}`,
      );
    }
  }

  lines.push(
    "",
    "## 운영 원칙",
    "",
    "- 공식 소스 변경이 없으면 저장소와 배포를 수정하지 않습니다.",
    "- 변경이 발견되면 이 파일을 변경 보고서로 교체한 Draft PR을 만듭니다.",
    "- 법률 판단 규칙과 규칙셋 검토일은 사람 검토 후에만 변경합니다.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function parseArguments(argv) {
  const options = {
    initialize: false,
    sources: "data/legal-sources.json",
    snapshot: "data/legal-source-snapshot.json",
    report: "reports/legal-updates/latest.md",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--initialize") options.initialize = true;
    else if (argument === "--sources") options.sources = argv[++index];
    else if (argument === "--snapshot") options.snapshot = argv[++index];
    else if (argument === "--report") options.report = argv[++index];
    else throw new Error(`알 수 없는 인자입니다: ${argument}`);
  }
  return options;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function setGithubOutputs(outputs) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `${Object.entries(outputs)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("\n")}\n`,
    "utf8",
  );
}

export async function runMonitor(options) {
  const config = JSON.parse(await readFile(options.sources, "utf8"));
  if (!Array.isArray(config.sources) || config.sources.length === 0) {
    throw new Error("법령 감시 소스 설정이 비어 있습니다.");
  }

  const checkedAt = new Date().toISOString();
  const collected = {};
  const failures = [];
  for (const source of config.sources) {
    try {
      collected[source.id] = await collectSource(source, {
        oc: process.env.LAW_OPEN_API_OC?.trim() || "test",
      });
      console.log(`확인 완료: ${source.name}`);
    } catch (error) {
      failures.push(`${source.name}: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (failures.length > 0) {
    await setGithubOutputs({ changed: false, failed: true, checked_at: checkedAt });
    throw new Error(`공식 소스 확인 실패\n${failures.join("\n")}`);
  }

  const currentSnapshot = {
    schemaVersion: 1,
    capturedAt: checkedAt,
    sourceCount: config.sources.length,
    sources: collected,
  };

  if (options.initialize) {
    await writeJson(options.snapshot, currentSnapshot);
    await mkdir(path.dirname(options.report), { recursive: true });
    await writeFile(options.report, buildInitialReport(currentSnapshot), "utf8");
    await setGithubOutputs({
      changed: false,
      failed: false,
      initialized: true,
      checked_at: checkedAt,
      source_count: config.sources.length,
    });
    console.log(`초기 공식 소스 스냅샷 ${config.sources.length}개를 저장했습니다.`);
    return { changed: false, initialized: true, currentSnapshot, changes: [] };
  }

  const previousSnapshot = JSON.parse(await readFile(options.snapshot, "utf8"));
  const changes = compareSnapshots(previousSnapshot, currentSnapshot);

  if (changes.length > 0) {
    await writeJson(options.snapshot, currentSnapshot);
    await mkdir(path.dirname(options.report), { recursive: true });
    await writeFile(options.report, buildChangeReport(changes, checkedAt), "utf8");
  }

  await setGithubOutputs({
    changed: changes.length > 0,
    failed: false,
    checked_at: checkedAt,
    change_count: changes.length,
    source_count: config.sources.length,
  });
  console.log(
    changes.length > 0
      ? `공식 소스 ${changes.length}개의 변경을 감지했습니다.`
      : `공식 소스 ${config.sources.length}개에 변경이 없습니다.`,
  );
  return { changed: changes.length > 0, currentSnapshot, changes };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await runMonitor(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
