// 見た目の回帰テストの結果を、PR のコメントの本文(Markdown)にする(docs/designs/0011-visual-regression.md の 5.5)。
// CI(.github/workflows/vrt.yml)が report-cli.ts から呼ぶ。PR のコメントは印(MARKER)で見つけて書き換える。

export const MARKER = "<!-- vrt-report -->";
export const BASELINE_DIR = "apps/web/e2e/vrt/__screenshots__";
export const PROJECTS = ["desktop", "mobile"] as const;
export type Project = (typeof PROJECTS)[number];

const PROJECT_LABEL: Record<Project, string> = { desktop: "パソコン", mobile: "スマホ" };
const IMAGE_WIDTH: Record<Project, number> = { desktop: 360, mobile: 160 };

export type Shot = { id: string; label: string };
/** changed … 基準と違う / new … 基準が無い(新しい画面) */
export type Change = { project: Project; id: string; kind: "changed" | "new" };

const normalize = (path: string) => path.split("\\").join("/");

function projectOf(dir: string): Project | undefined {
  return PROJECTS.find((p) => dir.endsWith(`-${p}`));
}

/**
 * 比べた結果の出力(test-results-vrt の中のファイルの一覧)から、違った画面を探す。
 * Playwright は違ったとき <テストのフォルダ>-<組>/<id>-actual.png(今回)と、基準があれば <id>-expected.png を書く。
 */
export function changesFromResults(files: string[]): Change[] {
  const paths = new Set(files.map(normalize));
  const changes: Change[] = [];
  for (const path of [...paths].sort()) {
    if (!path.endsWith("-actual.png")) continue;
    const slash = path.lastIndexOf("/");
    const project = projectOf(path.slice(0, Math.max(slash, 0)));
    if (!project) continue;
    const id = path.slice(slash + 1, -"-actual.png".length);
    const expected = `${path.slice(0, -"-actual.png".length)}-expected.png`;
    changes.push({ project, id, kind: paths.has(expected) ? "changed" : "new" });
  }
  return changes;
}

/** 撮り直した後の `git status --porcelain=v1 -uall -- <基準の置き場>` から、変わった基準を探す。 */
export function changesFromGitStatus(output: string): Change[] {
  const changes: Change[] = [];
  for (const line of output.split("\n")) {
    if (line.length < 4 || !line.endsWith(".png")) continue;
    const status = line.slice(0, 2);
    const path = normalize(line.slice(3));
    const [project, file] = path.slice(BASELINE_DIR.length + 1).split("/");
    const known = PROJECTS.find((p) => p === project);
    if (!path.startsWith(`${BASELINE_DIR}/`) || !known || !file) continue;
    changes.push({
      project: known,
      id: file.slice(0, -".png".length),
      kind: status === "??" ? "new" : "changed",
    });
  }
  return changes;
}

export type ReportInput = {
  /** compare … 比べた / update … ラベル vrt:update で撮り直した */
  mode: "compare" | "update";
  /** テストが全部通ったか */
  passed: boolean;
  shots: Shot[];
  changes: Change[];
  repo: string;
  /** PR の先頭の commit(コメントの画像はこの commit の基準を指す) */
  sha: string;
  runId: string;
  serverUrl?: string;
};

function changeTable(shots: Shot[], changes: Change[]): string[] {
  const label = (id: string) => shots.find((s) => s.id === id)?.label ?? id;
  return [
    "| 画面 | 組 | |",
    "|---|---|---|",
    ...changes.map(
      (c) =>
        `| ${label(c.id)}(\`${c.id}\`) | ${PROJECT_LABEL[c.project]} | ${c.kind === "new" ? "新しい(基準が無い)" : "違う"} |`,
    ),
  ];
}

function summary(input: ReportInput, runUrl: string): string[] {
  const { mode, passed, shots, changes, runId } = input;
  const total = shots.length * PROJECTS.length;
  if (!passed && changes.length === 0) {
    return [`⚠️ 比べる前に失敗しました。[実行のログ](${runUrl})を見てください。`];
  }
  if (mode === "update") {
    if (changes.length === 0) {
      return [
        `✅ 撮り直しても基準の画像と同じでした(${total} 枚)。ラベル \`vrt:update\` は外してください。`,
      ];
    }
    return [
      `🔁 ラベル \`vrt:update\` で基準を撮り直しました。**${changes.length} 枚が変わりました**(コミットするまで、この検査は赤のままです)。`,
      "",
      ...changeTable(shots, changes),
      "",
      "取り込むには、PR のブランチで次を流し、画像を見てからコミットして、ラベルを外してください。",
      "",
      "```bash",
      `gh run download ${runId} -n vrt-baseline -D ${BASELINE_DIR}`,
      "```",
    ];
  }
  if (passed) return [`✅ 基準の画像と同じでした(${total} 枚)。`];
  return [
    `❌ **${changes.length} 枚が基準の画像と違います。**`,
    "",
    ...changeTable(shots, changes),
    "",
    `基準・今回・差分の画像(\`<画面>-expected.png\` / \`-actual.png\` / \`-diff.png\`)は、[この実行](${runUrl})の成果物 \`vrt-diff\` にあります。`,
    "意図した変更なら、基準を撮り直してコミットしてください: 手元で `pnpm vrt:update`、または PR にラベル `vrt:update` を付ける(手順は `docs/guides/vrt.md`)。",
  ];
}

function gallery(input: ReportInput): string[] {
  const { shots, repo, sha, serverUrl = "https://github.com" } = input;
  const image = (project: Project, shot: Shot) =>
    `<img src="${serverUrl}/${repo}/raw/${sha}/${BASELINE_DIR}/${project}/${shot.id}.png" width="${IMAGE_WIDTH[project]}" alt="${shot.label}(${PROJECT_LABEL[project]})">`;
  const settled = input.passed && input.changes.length === 0;
  return [
    "<details>",
    `<summary>主な画面(${shots.length} 画面 × パソコン・スマホ)</summary>`,
    "",
    settled
      ? `この PR の画面です(\`${sha.slice(0, 7)}\` の基準の画像)。`
      : `\`${sha.slice(0, 7)}\` にコミット済みの基準の画像です(今回撮った画面ではありません)。`,
    "",
    "| 画面 | パソコン | スマホ |",
    "|---|---|---|",
    ...shots.map((s) => `| ${s.label} | ${image("desktop", s)} | ${image("mobile", s)} |`),
    "",
    "</details>",
  ];
}

export function buildReport(input: ReportInput): string {
  const runUrl = `${input.serverUrl ?? "https://github.com"}/${input.repo}/actions/runs/${input.runId}`;
  return [
    MARKER,
    "## 📸 画面(見た目の比べ)",
    "",
    ...summary(input, runUrl),
    "",
    ...gallery(input),
    "",
  ].join("\n");
}
