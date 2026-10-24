import { describe, expect, it } from "vitest";
import {
  buildReport,
  changesFromGitStatus,
  changesFromResults,
  MARKER,
  type ReportInput,
} from "./report.ts";

const base: ReportInput = {
  mode: "compare",
  passed: true,
  shots: [
    { id: "login", label: "ログイン" },
    { id: "projects", label: "プロジェクトの一覧" },
  ],
  changes: [],
  repo: "owner/repo",
  sha: "0123456789abcdef",
  runId: "42",
};

describe("違った画面を探す(比べた結果の出力から)", () => {
  it("基準があれば「違う」、無ければ「新しい」。組はフォルダの末尾", () => {
    const changes = changesFromResults([
      "screens-ログイン-login--desktop/login-actual.png",
      "screens-ログイン-login--desktop/login-expected.png",
      "screens-ログイン-login--desktop/login-diff.png",
      // Windows では区切りが \
      "screens-設定-settings--mobile\\settings-actual.png",
      "screens-設定-settings--mobile\\trace.zip",
      ".last-run.json",
    ]);
    expect(changes).toEqual([
      { project: "desktop", id: "login", kind: "changed" },
      { project: "mobile", id: "settings", kind: "new" },
    ]);
  });

  it("組の分からないフォルダは数えない", () => {
    expect(changesFromResults(["other/login-actual.png", "login-actual.png"])).toEqual([]);
  });
});

describe("変わった基準を探す(撮り直した後の git status から)", () => {
  it("直した画像は「違う」、足した画像は「新しい」。置き場の外と画像以外は数えない", () => {
    const out = [
      " M apps/web/e2e/vrt/__screenshots__/desktop/login.png",
      "?? apps/web/e2e/vrt/__screenshots__/mobile/new-screen.png",
      " M apps/web/src/other.png",
      " M apps/web/e2e/vrt/__screenshots__/tablet/login.png",
      " M apps/web/e2e/vrt/screens.ts",
      "",
    ].join("\n");
    expect(changesFromGitStatus(out)).toEqual([
      { project: "desktop", id: "login", kind: "changed" },
      { project: "mobile", id: "new-screen", kind: "new" },
    ]);
  });
});

describe("PR のコメントの本文", () => {
  it("全部同じ: 印・枚数・画面の表(PR の先頭の commit の基準の画像)", () => {
    const md = buildReport(base);
    expect(md.startsWith(MARKER)).toBe(true);
    expect(md).toContain("✅ 基準の画像と同じでした(4 枚)");
    expect(md).toContain("この PR の画面です(`0123456`");
    expect(md).toContain(
      '<img src="https://github.com/owner/repo/raw/0123456789abcdef/apps/web/e2e/vrt/__screenshots__/desktop/login.png" width="360" alt="ログイン(パソコン)">',
    );
    expect(md).toContain("/mobile/projects.png");
  });

  it("違う画面: 名前と組・成果物のある実行へのリンク・受け入れる方法", () => {
    const md = buildReport({
      ...base,
      passed: false,
      changes: [{ project: "mobile", id: "login", kind: "changed" }],
    });
    expect(md).toContain("❌ **1 枚が基準の画像と違います。**");
    expect(md).toContain("| ログイン(`login`) | スマホ | 違う |");
    expect(md).toContain(
      "[この実行](https://github.com/owner/repo/actions/runs/42)の成果物 `vrt-diff`",
    );
    expect(md).toContain("pnpm vrt:update");
    expect(md).toContain("コミット済みの基準の画像です(今回撮った画面ではありません)");
  });

  it("違う画面が無いのに落ちた: 比べる前の失敗としてログへ", () => {
    expect(buildReport({ ...base, passed: false })).toContain("⚠️ 比べる前に失敗しました");
  });

  it("ラベルで撮り直した: 変わった画像と、取り込む1行", () => {
    const md = buildReport({
      ...base,
      mode: "update",
      changes: [{ project: "desktop", id: "projects", kind: "new" }],
    });
    expect(md).toContain("🔁 ラベル `vrt:update` で基準を撮り直しました。**1 枚が変わりました**");
    expect(md).toContain("| プロジェクトの一覧(`projects`) | パソコン | 新しい(基準が無い) |");
    expect(md).toContain("gh run download 42 -n vrt-baseline -D apps/web/e2e/vrt/__screenshots__");
  });

  it("ラベルで撮り直しても同じ: ラベルを外すよう出す", () => {
    expect(buildReport({ ...base, mode: "update" })).toContain(
      "撮り直しても基準の画像と同じでした(4 枚)。ラベル `vrt:update` は外してください",
    );
  });
});
