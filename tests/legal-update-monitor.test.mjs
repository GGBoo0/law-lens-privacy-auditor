import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildChangeReport,
  canonicalize,
  compareSnapshots,
  extractPipcArticle,
  extractPipcGuideList,
} from "../scripts/check-legal-updates.mjs";
import { syncReviewBranch } from "../scripts/sync-legal-review-branch.mjs";

function git(cwd, ...arguments_) {
  return execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
}

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
  assert.ok(
    workflow.indexOf("Prepare safe review baseline") <
      workflow.indexOf("Check official legal sources from trusted code"),
  );
});
