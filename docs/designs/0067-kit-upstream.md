# 設計: キットの新しい版を取り込む道

> **AI 用の設計書。省略せずに網羅的に書く(正はこちら)。** 人はこれを開かず、PR の本文の「人向けのまとめ」を見る([guides/human-review.md](../guides/human-review.md))。
> 仕様: [docs/specs/0067-kit-upstream.md](../specs/0067-kit-upstream.md)
> 状態: 下書き
> 観点の順は [review-viewpoints.md](../review-viewpoints.md)。当てはまらない節も消さずに「該当なし(理由)」と書く。

## 0. 全体像

取り込んだ版を `docs/kit/upstream.yaml` に持ち、キットの最新のリリースと比べて、点検(`kit-upstream`)と `pnpm setup:github` の「人がやること」が同じ文で知らせる。取り込み方は `docs/kit/upgrade.md`(まるごと merge / 差分を要る場所だけ / 直しだけ cherry-pick)。

```mermaid
flowchart LR
  K[キット: 版を切る PR で upstream.yaml の version を上げる → タグ・リリース] --> R[GitHub のリリース latest]
  U[使う側: upstream.yaml の version] --> C{比べる}
  R --> C
  C -->|新しい版| N[/checkup の kit-upstream・pnpm setup:github が知らせる/]
  N --> G[docs/kit/upgrade.md の手順で取り込む PR(危険度「高」)]
  G --> U
```

## 作業の前に読んだ物(ガイド)

- 穴 G-42(`docs/scenarios/gaps.md`)・`docs/scenarios/09-adoption.md` の 9-5・9-7(雛形が捨てられる理由の ②)・9-8(配る形は本人の判断)
- 仕様 0066 と `docs/kit/maintenance.md`(版 `v0.Y.Z`・Y は取り込むときに手が要る・直すのは最新の版だけ)
- `scripts/setup/next-steps.mjs`(作った日より後にキットのコミットがあれば、コミットの一覧を見るよう知らせていた)・`scripts/setup/plan.mjs` の `kitDates`・`scripts/setup/fake-github.mjs`
- `scripts/checkup/`(確かめ方は `checks/<名前>.mjs` の `check(ctx)`・`ctx.gh` は読むだけ・ひな形は `ctx.role === "template"`。`ledger-review` と同じ扱い)・`docs/checkup/todo.yaml`(項目の書き方。足すと `docs/checkup/README.md` と `docs/compliance/soa.md` を作り直す)
- `.github/setup.yml`(`template_repository`・`allow_merge_commit: false`・`linear_history: true` → 取り込みの merge は squash でまとめる)
- README と `docs/getting-started.md`(clone して `kit` の remote を残す形。G-47)

## 1. 設計方針

- **版を正にする**: 比べるのは日付やコミットではなく、GitHub のリリースの latest のタグ(`maintenance.md` の 4 で持ち主が作る)。版が無い間は今までどおり日付で知らせる(CHANGELOG の「未リリース」へ)。
- **取り込んだ版はファイルで持つ**(`docs/kit/upstream.yaml`): git の履歴(merge-base と describe)は、cherry-pick・差分で当てた・履歴がつながっていないリポジトリで当てにならない。キットが版を切るときにこのファイルを上げるので、clone した時点の版をそのまま持ち、merge で取り込めば自動で上がる。
- 比べる部品は1つ(`scripts/checkup/upstream.mjs`)にし、点検と `pnpm setup:github` が同じ文で知らせる。
- 取り込みは自動にしない(手引きと AI への頼み方まで)。ぶつかりは使う側の判断(消した部品・題材)が要る。
- 新しい依存は足さない(`yaml` は既にある)。

## 2. データモデル

- DB: 該当なし。
- ファイル `docs/kit/upstream.yaml`: `repository`(キットのリポジトリ `owner/name`)・`version`(取り込んだ最後のタグ `vX.Y.Z`。版の前は `null`)。

## 3. API

- アプリの API: 該当なし。
- GitHub の API(読むだけ): `GET repos/{キット}/releases/latest`。404 は「まだ版が無い」。ほかの失敗は点検で unknown、`pnpm setup:github` では版の比べを飛ばして日付の知らせに落ちる。

## 4. 状態遷移

`upstream.yaml` の `version`: `null` → `v0.1.0` → …(上がるだけ。取り込まないと決めた版も、理由を PR に書いて上げてよい。手引きの 5)。cherry-pick だけのときは上げない。

## 5. システム間連携

- GitHub のリリース(キットのリポジトリ・公開)を読む。点検は `CHECKUP_READ_TOKEN` があればそれで(既存の決まり)。
- 書き込む連携は無い。

## 6. 業務ルール

- 比べ(`compareUpstream`): 3つの数字を前から比べる。最新の方が大きければ `behind`。**手が要る**のは、0. の間は2つ目まで、1 から後は1つ目が上がったとき(`maintenance.md` の 4 と同じ)。いまの記録が無い・形が違うときは `behind` で手が要る。最新の形が違えば `unknown`。
- 点検の項目 `kit-upstream`: `phase: 1m`・`every: monthly`・`verify: auto`・`severity: normal`・`who: human`。ひな形では比べずに合格。キットのリポジトリは `upstream.yaml` の `repository`、無ければ `.github/setup.yml` の `template_repository`。
- `pnpm setup:github` の「人がやること」(使う側だけ): 版があれば `behind` のときだけ1行。版が無ければ、作った日より後のコミットがあるときに CHANGELOG の「未リリース」と手引きへ。`SECURITY.md` にキットの目印(「キット(software-factory-starter)そのもの」)があれば書き換えを1行。
- `/checkup` のスキル: `kit-upstream` の不合格は問いではなく知らせ。CHANGELOG のその版の「取り込むときにすること」を見せ、取り込む PR を出すかを聞く(点検の答えの PR とは分ける)。
- キットの持ち主: 版を切る PR で `upstream.yaml` の `version` を新しいタグにする(`maintenance.md` の 4 の 2)。

## 7. 要求との対応

| 受け入れ条件(仕様) | 設計のどこ | テスト |
|---|---|---|
| 取り込んだ版を `upstream.yaml` に持つ | 2.・`maintenance.md` の 4 | `upstream.test.mjs`(読み方) |
| `/checkup` の `kit-upstream` が新しい版・同じ版・版なし・読めないを見分ける | 6.・`checks/kit-upstream.mjs` | `upstream.test.mjs`(kit-upstream) |
| ひな形では比べない | 6. | `upstream.test.mjs`(role: template) |
| `pnpm setup:github` が版と CHANGELOG・版が無ければ日付で案内 | 6.・`next-steps.mjs` の `kitUpdates` | `plan.test.mjs`(版があれば…・作り始めるときに…) |
| `SECURITY.md` がキットのままなら知らせる | 6.・`next-steps.mjs` | `plan.test.mjs`(SECURITY.md) |
| `upgrade.md` で読み方・選び方・ぶつかり・PR が分かる | `docs/kit/upgrade.md` の 0〜5 | 人が読む |

## 8. 非機能

- 性能: GitHub の API を1回足すだけ(点検は月1回、`pnpm setup:github` は打ったとき)。
- セキュリティ: 読むだけ。知らせの URL は設定ファイルのリポジトリ名からだけ作る。取り込みの PR は守るパスに触れるので「高」。
- 運用: 点検の項目が1つ増える(月1回)。
- 費用: 無し。

## 9. このプロダクト特有

| 観点 | この変更では |
|---|---|
| テナント分離 | 該当なし(アプリに触れない) |
| 権限の表 | 該当なし |
| 監査ログ | 該当なし |
| 解約で消す一覧 | 該当なし |
| サポートの代理ログイン | 該当なし |
| ログの個人情報 | 該当なし |
| 列の分類(`personal` / `sensitive`) | 該当なし |
| 画面の部品 | 該当なし |

## 10. 観点ごとの扱い

| 観点 | 扱い | 理由 |
|---|---|---|
| 設計方針 | 採用 | 版をファイルで持つ・自動で取り込まない |
| データモデル | 軽く確認 | `upstream.yaml` の2項目だけ |
| API | 軽く確認 | GitHub のリリースを読むだけ(404 = 版なし) |
| 状態遷移 | 軽く確認 | 版は上がるだけ |
| システム間連携 | 軽く確認 | 読むだけ |
| 業務ルール | 採用 | 手が要る版の見分けは `maintenance.md` の 4 と同じでなければならない(テストで固定) |
| 要求との対応 | 機械で検証 | `upstream.test.mjs`・`plan.test.mjs` |
| 非機能 | 低優先 | API 1回 |

## 11. 決めたこと(AI が決めた。人に聞かなかった)

- 取り込んだ版は git の履歴ではなくファイルで持つ — cherry-pick・差分で当てた・履歴がつながっていないリポジトリでも同じに動く。merge なら自動で上がる。
- 比べる相手はリリースの latest — タグの一覧は並びが版の順とは限らない。持ち主はタグと同時にリリースを作る(`maintenance.md` の 4)。
- 点検は月1回(`phase: 1m`) — 版は多くて月1回(`maintenance.md` の 4)。穴の版は勧告と Watch で早く届く(手引きの 0)。
- 取り込みを自動の PR にしない — ぶつかりは使う側の判断が要り、守るパスに触れる。
- 取り込みの merge は squash でまとめる — ルールセットが直線の履歴を求める(`.github/setup.yml`)。

## 12. 未確定事項(AI の仮決め。人の承認と分けて追う)

| 番号 | 工程 | 種類 | 仮決め(設計した事実) | なぜそうしたか | 人が判断する問い | 状態 |
|---|---|---|---|---|---|---|
| U-1 | 設計 | 事業判断 | 配る形は「全部入りの雛形+取り込みの手引き」のまま。「仕組みだけを別に配る」は下の案に書くだけ | 配る形は誰に先に見せるか・保守の量に効き、持ち主が決める(09-adoption の 9-8) | 仕組み(スキル・ハーネス・危険度・点検)を別に配る形に分けるか。分けるならいつか | 仮決め |

### 案: 仕組みだけを別に配る(U-1 の材料。作っていない)

| 案 | 中身 | 良い所 | 気になる所 |
|---|---|---|---|
| ① 今のまま(全部入り+この手引き) | 雛形を clone、版ごとに merge か差分 | 作る物が無い。アプリと仕組みが同じ版でそろう | 消した部品が多いほど取り込みが重い。既存のリポジトリには入らない(G-51) |
| ② Claude Code のプラグイン | スキル・フック・守るパスの一覧・PR テンプレートをプラグインにし、`/plugin install` で入れる。アプリは参照の実装として雛形に残す | 既存のリポジトリにも入る(G-51 の答えにもなる)。仕組みの更新がプラグインの版で届く | フックの守るパスはリポジトリごとに違う(設定の置き場が要る)。CI・ラベル・ルールセットはプラグインでは配れない(`pnpm setup:github` は残る)。キットと2つの版を持つ |
| ③ 仕組みを別のリポジトリにし、`git subtree` で取り込む | `.claude/`・`scripts/checkup`・`scripts/setup`・`docs/concepts` などを別のリポジトリに | 取り込む範囲がはっきりする | 使う側の手順が増える。キットの中で仕組みとアプリが別の版になる |

- おすすめ(AI の案): 外の最初の利用者が付くまでは ①。既存のリポジトリに入れたい声(G-51)が2件を超えたら ② を試す。

## 13. 作り直しの記録

| 日付 | きっかけ | 入った工程 | 直した物 | 作り直した下流 |
|---|---|---|---|---|
