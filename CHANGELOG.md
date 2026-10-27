# 変更の記録(キット)

> キット(software-factory-starter)の版ごとの変更。版の付け方といつ切るかは [docs/kit/maintenance.md](docs/kit/maintenance.md) の 4。
> キットから作ったリポジトリでは、これは**キットの**記録。自分のリポジトリで読むときは `git fetch kit` → `git show kit/main:CHANGELOG.md`。
> 版を切るときに、前の版から main に入った PR から書く(PR ごとには書かない)。各版の「取り込むときにすること」を先に読む。

<!--
版の節の型(無い見出しは消してよい):

## [0.Y.Z] - YYYY-MM-DD

### 取り込むときにすること
- 移行・pnpm setup:github --apply の流し直し・使う側の設定・消えたファイルの扱い。無ければ「なし」

### 足した / 変えた / 直した / セキュリティ / 消した
- 1行ずつ(PR の番号つき)
-->

## [未リリース]

> 最初の版 `v0.1.0` になる予定(タグを打つのは持ち主)。これより前の変更は git の履歴(〜#117)にある。

### 取り込むときにすること

- なし(最初の版)

### 足した

- 保守の約束: `SECURITY.md`(穴の知らせ方)・この `CHANGELOG.md`・保守の方針 [docs/kit/maintenance.md](docs/kit/maintenance.md)(誰が・どこまで・いつまで・版の付け方)。穴 G-41
