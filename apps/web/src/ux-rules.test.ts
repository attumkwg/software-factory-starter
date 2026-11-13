// 使いやすさの決まりのうち、コードから機械で見られる物(仕様 0100・G-163。見方は docs/guides/ux-review.md)。
// 🎨 の棚卸し(docs/ux/2026-11-14-all-screens.md)で、同じ所見が毎回出そうな物をテストにした。
// 今ある外れは KNOWN に理由と穴の番号つきで並べる(ラチェット: 新しい外れは落ちる・直したら KNOWN から消さないと落ちる)。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(name) ? [path] : [];
  });
}

const files = sources(SRC).map((path) => ({
  file: relative(SRC, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));

/** start の「{」から、対になる「}」までの中身 */
function braced(text: string, start: number): string {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") depth -= 1;
    if (depth === 0) return text.slice(start + 1, i);
  }
  return text.slice(start + 1);
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** 戻せない操作の API(押した瞬間に消える・止まる・取り消される) */
const IRREVERSIBLE = /\bapi\.((?:delete|disable|revoke|remove|suspend|erase|forceLogout)\w*)\(/;

/** onPress の中で、戻せない操作の API を直に呼んでいる所(確認のダイアログ・元に戻すを通っていない) */
function directIrreversible(file: string, text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/onPress=\{/g)) {
    const body = braced(text, (m.index ?? 0) + "onPress=".length);
    const call = body.match(IRREVERSIBLE);
    if (call) found.push(`${file} ${call[1]}`);
  }
  return found;
}

/** 空のときの文を決めていない表(既定の「まだありません」だけで、何をすれば増えるかが出ない) */
function tablesWithoutEmpty(file: string, text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/<Table\b/g)) {
    const end = text.indexOf("/>", m.index);
    const props = text.slice(m.index, end);
    if (!/\bempty(Message|State)=/.test(props)) found.push(`${file}:${lineOf(text, m.index ?? 0)}`);
  }
  return found;
}

describe("戻せない操作は、確認のダイアログか「元に戻す」を通る(手引きの 7)", () => {
  // 直すのは G-164(部品の段)。直したら、ここから消す
  const KNOWN = [
    "pages/TasksPage.tsx deleteTask", // タスクの「消す」(棚卸しの所見 1。元に戻すつきのトーストで直す)
    "pages/settings/TaskMailCard.tsx disableTaskMail", // メールを「止める」(所見 9。確認で直す)
  ];

  it("押した瞬間に消える・止まる操作を、KNOWN 以外に足さない", () => {
    const found = files.flatMap(({ file, text }) => directIrreversible(file, text)).sort();
    expect(found).toEqual([...KNOWN].sort());
  });

  it("見分け方: 直に呼ぶ物は拾い、確認の onConfirm から呼ぶ物は拾わない", () => {
    const direct = `<Button onPress={() =>\n  run(() => api.deleteTask(t.id), { success: "x" })\n}>消す</Button>`;
    const confirmed = `<Button onPress={() => setOpen(true)}>消す</Button>\n<ConfirmDialog onConfirm={() => api.deleteTask(t.id)} />`;
    const harmless = `<Button onPress={() => api.updateTask(t.id, { done })}>完了</Button>`;
    expect(directIrreversible("a.tsx", direct)).toEqual(["a.tsx deleteTask"]);
    expect(directIrreversible("b.tsx", confirmed)).toEqual([]);
    expect(directIrreversible("c.tsx", harmless)).toEqual([]);
  });
});

describe("一覧の表は、空のときの文を決める(手引きの 3)", () => {
  // 直すのは G-164(空の状態の部品)。直したら、ここから消す
  const KNOWN = [
    "pages/OrganizationsPage.tsx", // 所属している組織(0件は起きにくいが、文は決める)
    "pages/ProjectsPage.tsx", // プロジェクト一覧(棚卸しの所見 8)
  ];

  it("空の文の無い表を、KNOWN 以外に足さない(部品の一覧の見本は除く)", () => {
    const found = files
      .filter(({ file }) => file !== "pages/DesignSystemPage.tsx")
      .flatMap(({ file, text }) => tablesWithoutEmpty(file, text))
      .map((at) => at.split(":")[0])
      .sort();
    expect(found).toEqual([...KNOWN].sort());
  });

  it("見分け方: emptyMessage か emptyState があれば良い", () => {
    expect(tablesWithoutEmpty("a.tsx", `<Table label="x" rows={r} />`)).toEqual(["a.tsx:1"]);
    expect(
      tablesWithoutEmpty("b.tsx", `<Table\n  label="x"\n  emptyMessage="まだ無い"\n/>`),
    ).toEqual([]);
    expect(tablesWithoutEmpty("c.tsx", `<Table label="x" emptyState={<E />} />`)).toEqual([]);
  });
});

describe("設定のカードは主ボタンを持たない(1つの画面に並ぶので、手引きの 4)", () => {
  // 設定の画面はカードを縦に並べる。カードごとに primary を持つと、組織の状態しだいで主ボタンが3〜6個になる
  // (棚卸しの所見 2。種データでは出ないので E2E の数えでは拾えない)。直すのは G-164
  const KNOWN = [
    "pages/settings/DomainsCard.tsx",
    "pages/settings/IpAllowlistCard.tsx",
    "pages/settings/MfaRequirementCard.tsx",
    "pages/settings/ScimTokensCard.tsx",
    "pages/settings/SsoCard.tsx",
    "pages/settings/TaskMailCard.tsx",
  ];

  it('variant="primary" を使う設定のカードを、KNOWN 以外に足さない', () => {
    const found = files
      .filter(
        ({ file, text }) => file.startsWith("pages/settings/") && /variant="primary"/.test(text),
      )
      .map(({ file }) => file)
      .sort();
    expect(found).toEqual([...KNOWN].sort());
  });
});
