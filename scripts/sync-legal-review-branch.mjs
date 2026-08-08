import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

function runGit(arguments_, options = {}) {
  const result = spawnSync("git", arguments_, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : "pipe",
  });
  const allowed = options.allowedExitCodes || [0];
  if (!allowed.includes(result.status ?? 1)) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`git ${arguments_.join(" ")} 실패${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function humanCommitCount(repoDir) {
  const result = runGit(["log", "--format=%ae", "origin/main..HEAD"], {
    cwd: repoDir,
  });
  return result.stdout
    .split(/\r?\n/)
    .map((email) => email.trim())
    .filter((email) => email && email !== BOT_EMAIL).length;
}

export async function syncReviewBranch({
  repoDir = process.cwd(),
  branch,
  existing,
  snapshotPath,
  reportPath,
}) {
  if (!branch || !snapshotPath || !reportPath) {
    throw new Error("브랜치와 생성 파일 경로가 모두 필요합니다.");
  }

  if (existing) {
    runGit(["switch", "--create", branch, "--track", `origin/${branch}`], {
      cwd: repoDir,
      capture: false,
    });
  } else {
    runGit(["switch", "--create", branch], { cwd: repoDir, capture: false });
  }

  const destinationSnapshot = path.join(repoDir, "data", "legal-source-snapshot.json");
  const destinationReport = path.join(repoDir, "reports", "legal-updates", "latest.md");
  await mkdir(path.dirname(destinationSnapshot), { recursive: true });
  await mkdir(path.dirname(destinationReport), { recursive: true });
  await copyFile(snapshotPath, destinationSnapshot);
  await copyFile(reportPath, destinationReport);

  runGit(
    [
      "add",
      "--",
      "data/legal-source-snapshot.json",
      "reports/legal-updates/latest.md",
    ],
    { cwd: repoDir },
  );
  const staged = runGit(["diff", "--cached", "--quiet"], {
    cwd: repoDir,
    allowedExitCodes: [0, 1],
  });
  if (staged.status === 0) {
    return { committed: false, humanCommitCount: humanCommitCount(repoDir) };
  }

  const preservedHumanCommits = humanCommitCount(repoDir);
  if (preservedHumanCommits > 0) {
    console.log(`사람 커밋 ${preservedHumanCommits}개를 보존한 상태에서 봇 커밋을 추가합니다.`);
  }
  runGit(["commit", "-m", "Detect official legal source updates"], {
    cwd: repoDir,
    capture: false,
  });
  runGit(["push", "origin", `HEAD:refs/heads/${branch}`], {
    cwd: repoDir,
    capture: false,
  });
  return { committed: true, humanCommitCount: preservedHumanCommits };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`잘못된 인자입니다: ${key || "(없음)"}`);
    }
    values[key.slice(2)] = value;
  }
  return {
    branch: values.branch,
    existing: values.existing === "true",
    snapshotPath: values.snapshot,
    reportPath: values.report,
  };
}

async function main() {
  await syncReviewBranch(parseArguments(process.argv.slice(2)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
