# 最初の1週間で読む物(引き継ぐ人へ)

> docs は300を超える。**全部は読まない**。この9つを順に読めば、AI に頼んで直し、PR を判断し、障害の入口に立てる。残りは「要るときに引く辞書」。
> 言葉で詰まったら [glossary.md](glossary.md)(賭け = bet・危険度 = risk tier・ハーネス = agent harness など)。

## 読む順(1日に1〜2時間)

| 日 | 読む物 | 何が分かるか | 目安 |
|---|---|---|---|
| 1 | [README.md](../../README.md) | 何のための雛形か・向き不向き・費用・始め方 | 15分 |
| 1 | [glossary.md](glossary.md) | キット独自の言葉と、標準の言葉の対応 | 15分 |
| 1 | [concepts/README.md](../concepts/README.md) | 考え方の1枚(7工程・ハーネス・段階・人と AI の分担) | 15分 |
| 2 | [concepts/line.md](../concepts/line.md) | ラインの作り: 原則・7工程・ハーネス3層・危険度で人が見る量を決める | 40分 |
| 2 | [CLAUDE.md](../../CLAUDE.md) | AI がどこを触っても守ること(人に聞く4つ・してはいけない) | 15分 |
| 3 | [playbook.md](../playbook.md) | 1つの機能が出るまで・毎週やること・人と AI の分担 | 40分 |
| 3 | [guides/human-review.md](../guides/human-review.md) | PR で人が見る所(未確定事項・人向けのまとめ・上流からの作り直し) | 30分 |
| 4 | [reference.md](../reference.md) の「🧭 考え方とこの雛形の対応」 | 考え方が、どのファイルで実現されているか(テナント分離・権限の表・危険度) | 40分 |
| 5 | [runbooks/incident.md](../runbooks/incident.md) | 障害のときの入口と型 | 30分 |

## 手を動かす(読むのと同じ日に)

- 1日目: README の「始め方」の 1(`pnpm install && pnpm test` → `docker compose up --build` → 2社のデータが分かれているのを見る)。
- 2日目: Claude Code でこのフォルダを開き、「`docs/kit/first-week.md` の2日目まで読んだ。このリポジトリで危険度『高』の場所を3つ、理由つきで教えて」と聞く。答えを `.claude/hooks/protected-paths.json` と比べる。
- 3日目: マージ済みの PR を3つ開き、本文の「人に判断してほしい所」「危険度」を読む(何を人が決めてきたか)。
- 4日目: `/checkup` を流す(点検の台帳の担当者を引き継ぐなら、先に `pnpm checkup:adopt --by @自分`)。
- 5日目: `pnpm decisions`(残っている仮決め・導入時に決めること)と `docs/product/` の計画・賭けを見て、いま何を確かめているかを前の担当者に聞く。

## 要るときに引く(最初は読まない)

| 知りたいとき | どこ |
|---|---|
| ある機能をなぜこう作ったか | `docs/specs/`(仕様)・`docs/designs/`(設計書)・`docs/adr/`(判断)。番号で引く |
| セキュリティの決まりの番号(AI-6・L-3 など) | [security.md](../security.md) |
| API・画面・DB を触る | `apps/api/CLAUDE.md`・`apps/web/CLAUDE.md`・[db/](../db/)・[authz/matrix.yaml](../authz/matrix.yaml) |
| どこに何があるか・コマンドの全部 | [reference.md](../reference.md) |
| キットの部品を残すか消すか | [catalog.yaml](catalog.yaml)・`docs/product/tailoring.md` |
| 規模が大きくなったら何が足りないか | [scenarios/](../scenarios/README.md)・[scenarios/gaps.md](../scenarios/gaps.md) |
| 認証(P マーク・ISMS)を目指す | [compliance/README.md](../compliance/README.md) |
| キットの新しい版を取り込む | [upgrade.md](upgrade.md) |
