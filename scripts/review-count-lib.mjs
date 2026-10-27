// 危険度「高」の PR に、人の承認が決めた人数あるかを数える(G-43・仕様 0059)。
// GitHub のルールセットの承認数はリポジトリで1つの値で、CODEOWNERS は並べた誰か1人の承認で通る。
// だから「高だけ2人」は、この必須のチェックで止める。

/** 守るパスの一覧(protected-paths.json の書き方)に当たるか。"x/**" は x/ の下の全部、ほかは同じ名前だけ */
export const isProtected = (file, paths) =>
  paths.some((p) => (p.endsWith("/**") ? file.startsWith(p.slice(0, -2)) : file === p));

/**
 * 変えたファイル(名前を変えた物は元の名前も)か、ラベル risk:high・tests:weakened で「高」か。
 * tests:weakened はテストか検査を弱めた印(test-weakening.yml。G-60)
 */
export function isHighRisk({ files, labels, paths }) {
  if (labels.includes("risk:high") || labels.includes("tests:weakened")) return true;
  return files.some((f) =>
    [f.filename, f.previous_filename].filter(Boolean).some((name) => isProtected(name, paths)),
  );
}

// 書き込める人だけ数える。公開のリポジトリでは、誰でも「承認」のレビューを付けられる
const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/** 人ごとの最後の判断で、いま承認している人。PR を出した人・ボット・外の人は数えない。コメントだけは判断を変えない */
export function approvers({ reviews, author }) {
  const last = new Map();
  for (const r of reviews) {
    if (!r.user || r.user.type === "Bot" || r.user.login === author) continue;
    if (!TRUSTED.has(r.author_association)) continue;
    if (r.state === "COMMENTED" || r.state === "PENDING") continue;
    last.set(r.user.login, r.state);
  }
  return [...last]
    .filter(([, state]) => state === "APPROVED")
    .map(([login]) => login)
    .sort();
}

/** .github/setup.yml の ruleset.high_risk_approvals(書いていなければ 0 = 数えない) */
export function requiredFromSetup(text) {
  const m = text.match(/^[ \t]+high_risk_approvals:[ \t]*(\d+)/m);
  return m ? Number(m[1]) : 0;
}

/** 通すか。理由の1行つき */
export function judge({ high, required, approved }) {
  if (!high) return { ok: true, message: "危険度「高」の場所を変えていない" };
  if (required === 0)
    return {
      ok: true,
      message:
        "危険度「高」だが、人数は 0(1人の間)。人が増えたら .github/setup.yml の ruleset.high_risk_approvals を 2 に",
    };
  const who = approved.length > 0 ? `(${approved.map((a) => `@${a}`).join("・")})` : "";
  if (approved.length >= required)
    return { ok: true, message: `危険度「高」: 承認 ${approved.length} / ${required} 人${who}` };
  return {
    ok: false,
    message: `危険度「高」: 承認が ${approved.length} / ${required} 人${who}。あと ${required - approved.length} 人の承認が要る`,
  };
}
