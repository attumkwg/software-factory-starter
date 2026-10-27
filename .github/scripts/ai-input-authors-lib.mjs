// 背景の AI(claude.yml)に読ませる Issue・PR の書き手を確かめる(G-58・仕様 0060)。
// 起動した人(持ち主)を確かめても、AI が読む本文やコメントを外の人が書いていれば、中の指示に従ってしまう
// (docs/security.md の AI-3)。頼まれた Issue・PR の本文・コメント・レビューの書き手が、全員書き込める人のときだけ動かす。

// 書き込める人。公開のリポジトリでは、誰でも Issue・コメント・レビューを書ける
const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
// 中身をこのリポジトリのワークフローが書くボットだけ。Renovate・Dependabot は上流のリリースノートを本文に写すので入れない
export const TRUSTED_BOTS = new Set(["github-actions[bot]", "claude[bot]"]);
// 1回で確かめる番号の上限(頼む文に番号を並べて API を連打させない)
export const MAX_TARGETS = 10;

/** 頼む文に出てくる Issue・PR の番号(#12・…/issues/12・…/pull/12)。重複なし・小さい順 */
export function numbersInPrompt(prompt) {
  const found = new Set();
  for (const m of String(prompt ?? "").matchAll(/(?:#|\/(?:issues|pull)\/)(\d+)\b/g)) {
    found.add(Number(m[1]));
  }
  return [...found].filter((n) => n > 0).sort((a, b) => a - b);
}

/** 確かめる番号。手動の起動は頼む文から、@claude のコメント・Issue はその番号 */
export function targetsOf({ eventName, prompt, issueNumber }) {
  const numbers = new Set(numbersInPrompt(prompt));
  if ((eventName === "issue_comment" || eventName === "issues") && Number(issueNumber) > 0) {
    numbers.add(Number(issueNumber));
  }
  return [...numbers].sort((a, b) => a - b);
}

/** 書き込める人か、決めたボットか */
export const isTrusted = (item) =>
  Boolean(item?.user) &&
  (item.user.type === "Bot"
    ? TRUSTED_BOTS.has(item.user.login)
    : TRUSTED.has(item.author_association));

/**
 * 1つの Issue・PR の中で、書き込めない人が書いた物。
 * items: { kind: "本文" | "コメント" | "レビュー" | "レビューのコメント", user, author_association, body? }
 * レビューの本文が空(承認だけ・行のコメントだけ)は読む文章が無いので数えない
 */
export function untrustedIn(items) {
  return items
    .filter((i) => i.kind !== "レビュー" || String(i.body ?? "").trim() !== "")
    .filter((i) => !isTrusted(i))
    .map((i) => ({
      kind: i.kind,
      login: i.user?.login ?? "(消えたアカウント)",
      association: i.author_association ?? "NONE",
    }));
}

/** 動かすか。理由の行つき。found: [{ number, untrusted: [...] }] */
export function judge({ targets, found }) {
  if (targets.length === 0)
    return {
      ok: true,
      lines: ["頼む文に Issue・PR の番号が無い(読ませる文章は起動した人の物だけ)"],
    };
  if (targets.length > MAX_TARGETS)
    return {
      ok: false,
      lines: [`番号が ${targets.length} 個ある。1回で頼むのは ${MAX_TARGETS} 個までにしてください`],
    };
  const bad = found.filter((f) => f.untrusted.length > 0);
  if (bad.length === 0)
    return {
      ok: true,
      lines: [
        `#${targets.join("・#")} の本文・コメント・レビューは、全部書き込める人(か決めたボット)が書いた`,
      ],
    };
  const lines = bad.flatMap((f) =>
    f.untrusted.map((u) => `#${f.number} の${u.kind}: @${u.login}(${u.association})`),
  );
  return {
    ok: false,
    lines: [
      "書き込めない人が書いた文章があるので、AI を動かしません(中に AI への指示が仕込まれているかもしれない。docs/security.md の AI-3)",
      ...lines,
      "直し方: 中身を人が読んで確かめ、自分の言葉で新しい Issue に書き直してから、その番号で頼む(外の人の文章は貼らない)",
    ],
  };
}
