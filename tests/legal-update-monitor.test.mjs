import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChangeReport,
  canonicalize,
  compareSnapshots,
  extractPipcArticle,
  extractPipcGuideList,
} from "../scripts/check-legal-updates.mjs";

test("canonical JSON fingerprints can ignore object key order", () => {
  assert.equal(
    canonicalize({ b: 2, a: { d: 4, c: 3 } }),
    canonicalize({ a: { c: 3, d: 4 }, b: 2 }),
  );
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
  assert.match(article.content, /공식 지침/);
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
