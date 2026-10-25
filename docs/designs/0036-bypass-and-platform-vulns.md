# 設計: 確認を飛ばすモードの禁止と、基盤の穴の作り直しと出し直し

> 仕様: [specs/0036](../specs/0036-bypass-and-platform-vulns.md)。判断の記録: [ADR 0047](../adr/0047-no-bypass-permissions.md)

## 0. 全体像

`.claude/settings.json` の `permissions.disableBypassPermissionsMode` を `"disable"` に。守りの手引きに、全社に配る設定の節。基盤の穴の手順書を足し、`/cve` と脆弱性の手引きの直し方に1つ足す。

## 作業の前に読んだ物(ガイド)

- `docs/guides/local-guards.md`・`docs/guides/vulnerabilities.md`・`.claude/skills/cve/SKILL.md`・`scripts/check-guards.mjs`
- `docs/scenarios/06-security-audit.md` の 6-3・6-12・`07-grow.md` の 7-7

## 1. 設計方針

- 「お願い」ではなく手段の側で止める(`docs/concepts/people-and-ai.md` の 1)。リポジトリの設定で止められる所は止め、止められない所(リポジトリの外)は配る設定として書く。

## 2. データモデル

なし。

## 3. API

なし。

## 4. 状態遷移

なし。

## 5. システム間連携

なし。

## 6. 業務ルール

- 基盤の穴: どこに当たるか(画面と API のイメージ・CI・手元・PostgreSQL)→ 土台のイメージが直ったか → 作り直し → stg → 本番(人の承認)→ 手元 → 記録。

## 7. 要求との対応

| 受け入れ条件 | どこで |
|---|---|
| 確認を飛ばすモードの禁止 | `.claude/settings.json` |
| 配る設定 | `docs/guides/local-guards.md` の「手元の設定を全社に配る」 |
| 基盤の穴 | `docs/runbooks/platform-vuln.md`・`docs/guides/vulnerabilities.md` の 5・`.claude/skills/cve/SKILL.md` の ③ |

## 8. 非機能

なし。

## 9. このプロダクト特有

なし。

## 10. 観点ごとの扱い

| 観点 | 扱い | 理由 |
|---|---|---|
| 守り | 最重要 | 手段を持たせない側の設定 |
| 互換 | 採用 | `pnpm guards` が通る(フックの付き方は変えない) |

## 11. 決めたこと(AI が決めた。人に聞かなかった)

- 確認を飛ばすモードの禁止は、使う人が手元で外さない前提の既定にする(外したいときは自分の端末の設定で。キットとしてはすすめない)。

## 12. 未確定事項(AI の仮決め。人の承認と分けて追う)

| 番号 | 工程 | 種類 | 仮決め(設計した事実) | なぜそうしたか | 人が判断する問い | 状態 |
|---|---|---|---|---|---|---|

## 13. 作り直しの記録

なし。
