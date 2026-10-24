// 確かめ方(checks/*.mjs)に渡す ctx の本物。テストでは偽物を渡す。
//   ctx.api(sub)   … gh api repos/<owner>/<name>/<sub>(sub が空ならリポジトリそのもの)
//   ctx.gh(path)   … gh api <path>(リポジトリの外。検索・請求など)
//   ctx.run(cmd, args) … 手元のコマンドを流し、{ code } か { error } を返す
//   ctx.read(path) / ctx.exists(path) / ctx.files(dir) … リポジトリのファイル(無ければ undefined / false / [])
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ghApi } from "./gh.mjs";

const NO_REPO = {
  ok: false,
  status: 0,
  message: "確かめるリポジトリが分からない(gh repo view が通らない)",
};

/** dir の下のファイルを全部(リポジトリの根からの相対パス・/ 区切り) */
function listFiles(root, dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => relative(root, join(d.parentPath, d.name)).replaceAll("\\", "/"))
    .sort();
}

/** ひな形か使う側か(.github/setup.yml の template_repository と同じ名前なら template。ADR 0027) */
export function roleOfRepo(root, repo) {
  const abs = join(root, ".github/setup.yml");
  const m = existsSync(abs) && readFileSync(abs, "utf8").match(/^template_repository:\s*(\S+)/m);
  if (!m || !repo) return "product";
  return m[1].toLowerCase() === String(repo).toLowerCase() ? "template" : "product";
}

export function makeContext({ root = process.cwd(), repo, today, ledger }) {
  return {
    repo,
    role: roleOfRepo(root, repo),
    today,
    ledger,
    api: (sub) => (repo ? ghApi(`repos/${repo}${sub ? `/${sub}` : ""}`) : NO_REPO),
    gh: (path) => (repo ? ghApi(path) : NO_REPO),
    run: (cmd, args) => {
      const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", timeout: 120_000 });
      return r.error ? { error: r.error.message } : { code: r.status };
    },
    read: (path) => {
      const abs = join(root, path);
      return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
    },
    exists: (path) => existsSync(join(root, path)),
    files: (dir) => listFiles(root, dir),
  };
}
