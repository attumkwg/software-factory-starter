// PR のコメントの本文を作って標準出力に出す(.github/workflows/vrt.yml から。Node 24 がそのまま TS を読む)。
//   VRT_MODE=compare|update  VRT_PASSED=true|false  HEAD_SHA=<PR の先頭の commit>
//   GITHUB_REPOSITORY・GITHUB_RUN_ID・GITHUB_SERVER_URL は Actions が入れる
// apps/web で動かす(test-results-vrt を読み、撮り直したときは git で変わった基準を見る)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { buildReport, changesFromGitStatus, changesFromResults } from "./report.ts";
import { EXTRA_SHOTS, SCREENS } from "./screens.ts";

const env = (name: string) => process.env[name] ?? "";
const mode = env("VRT_MODE") === "update" ? "update" : "compare";

const changes =
  mode === "update"
    ? changesFromGitStatus(
        execFileSync(
          "git",
          ["status", "--porcelain=v1", "-uall", "--", "e2e/vrt/__screenshots__"],
          {
            encoding: "utf8",
          },
        ),
      )
    : changesFromResults(
        existsSync("test-results-vrt")
          ? readdirSync("test-results-vrt", { recursive: true, encoding: "utf8" })
          : [],
      );

process.stdout.write(
  buildReport({
    mode,
    passed: env("VRT_PASSED") === "true",
    shots: [...SCREENS, ...EXTRA_SHOTS].map(({ id, label }) => ({ id, label })),
    changes,
    repo: env("GITHUB_REPOSITORY"),
    sha: env("HEAD_SHA"),
    runId: env("GITHUB_RUN_ID"),
    serverUrl: env("GITHUB_SERVER_URL") || undefined,
  }),
);
