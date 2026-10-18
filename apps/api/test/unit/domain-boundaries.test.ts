import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOMAIN_DEPENDENCIES } from "../../src/domains/dependencies.ts";

// 領域の境界(ADR 0004)を CI で守る。AI が何千回 PR を出しても、領域どうしが絡まないように。
//
//   1. 領域 A から領域 B を使えるのは、dependencies.ts に A → B があるときだけ
//   2. ほかの領域・src の共通部分から領域を使うときは、その領域の index.ts(公開の入口)だけ
//      例外: schema.ts どうし(外部キーのため)と、src/db の schema.ts・seed.ts(全部の表を集める所)
//   3. 向きに輪(A → B → A)が無い
//   4. 領域のフォルダ名 = Postgres のスキーマ名

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
const DOMAINS_DIR = join(SRC, "domains");
const toPosix = (p: string) => p.split(sep).join("/");

type SourceFile = { path: string; text: string };

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

/** src からの相対パスで、その場所が属する領域(領域の外なら null)。 */
const domainOf = (srcRelative: string) => srcRelative.match(/^domains\/([^/]+)\//)?.[1] ?? null;

export function findViolations(files: SourceFile[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    const from = toPosix(file.path); // src からの相対パス
    const fromDomain = domainOf(from);
    for (const [, spec] of file.text.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = toPosix(join(dirname(from), spec as string)).replace(/^\.\//, "");
      const toDomain = domainOf(target);
      if (!toDomain || toDomain === fromDomain) continue;

      const isPublic = target === `domains/${toDomain}/index.ts`;
      const isSchemaToSchema = from.endsWith("/schema.ts") && target.endsWith("/schema.ts");
      const isDbAggregator =
        fromDomain === null &&
        (from === "db/schema.ts" || from === "db/seed.ts") &&
        target.endsWith("/schema.ts");

      if (fromDomain && !DOMAIN_DEPENDENCIES[fromDomain]?.includes(toDomain)) {
        problems.push(`${from}: 領域 ${fromDomain} → ${toDomain} は dependencies.ts に無い`);
      } else if (!isPublic && !isSchemaToSchema && !isDbAggregator) {
        problems.push(`${from}: ${target} を直接読んでいる(domains/${toDomain}/index.ts を通す)`);
      }
    }
  }
  return problems;
}

function findCycle(deps: Readonly<Record<string, readonly string[]>>): string[] | null {
  const visiting = new Set<string>();
  const done = new Set<string>();
  const walk = (node: string, path: string[]): string[] | null => {
    if (visiting.has(node)) return [...path, node];
    if (done.has(node)) return null;
    visiting.add(node);
    for (const next of deps[node] ?? []) {
      const cycle = walk(next, [...path, node]);
      if (cycle) return cycle;
    }
    visiting.delete(node);
    done.add(node);
    return null;
  };
  for (const node of Object.keys(deps)) {
    const cycle = walk(node, []);
    if (cycle) return cycle;
  }
  return null;
}

describe("領域の境界(ADR 0004)", () => {
  const files = listFiles(SRC).map((full) => ({
    path: relative(SRC, full),
    text: readFileSync(full, "utf8"),
  }));
  const domains = readdirSync(DOMAINS_DIR).filter((n) =>
    statSync(join(DOMAINS_DIR, n)).isDirectory(),
  );

  it("領域どうしは、決めた向きに・公開の入口(index.ts)だけを通して使っている", () => {
    expect(findViolations(files)).toEqual([]);
  });

  it("向きに輪が無い", () => {
    expect(findCycle(DOMAIN_DEPENDENCIES)).toBeNull();
  });

  it("どの領域も dependencies.ts に載っていて、index.ts と、同じ名前の Postgres のスキーマを持つ", () => {
    expect([...domains].sort()).toEqual(Object.keys(DOMAIN_DEPENDENCIES).sort());
    for (const d of domains) {
      expect(statSync(join(DOMAINS_DIR, d, "index.ts")).isFile()).toBe(true);
      expect(readFileSync(join(DOMAINS_DIR, d, "schema.ts"), "utf8")).toContain(`pgSchema("${d}")`);
    }
  });

  // 見張りそのものが効いていること(ルールが緩むと、上のテストが黙って通ってしまう)
  it("破った書き方を見つける", () => {
    const bad = findViolations([
      // projects → tasks の向きは決めていない
      {
        path: "domains/projects/routes.ts",
        text: 'import { taskRoutes } from "../tasks/index.ts";',
      },
      // tasks → projects はよいが、中のファイルを直接読んでいる
      {
        path: "domains/tasks/routes.ts",
        text: 'import { getProject } from "../projects/repository.ts";',
      },
      // 共通部分から領域の中を直接
      {
        path: "authz/middleware.ts",
        text: 'import { users } from "../domains/organizations/schema.ts";',
      },
    ]);
    expect(bad).toHaveLength(3);
    expect(
      findViolations([
        {
          path: "domains/tasks/routes.ts",
          text: 'import { projectExists } from "../projects/index.ts";',
        },
        {
          path: "domains/tasks/schema.ts",
          text: 'import { projects } from "../projects/schema.ts";',
        },
        { path: "db/schema.ts", text: 'export * from "../domains/tasks/schema.ts";' },
      ]),
    ).toEqual([]);
    expect(findCycle({ a: ["b"], b: ["a"] })).not.toBeNull();
  });
});
