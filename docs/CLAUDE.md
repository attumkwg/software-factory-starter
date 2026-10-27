# docs のルール

> 全体のルールはルートの `CLAUDE.md`。docs の地図(いまの正と記録)は `docs/README.md`、ファイルの全部は `docs/reference.md`。キット独自の言葉は `docs/kit/glossary.md`。

## 根拠と番号

- **根拠は `docs/concepts/`(考え方の本体: 7工程・ハーネス3層・段階と費用・人と AI の分担・長く回す)と `docs/security.md`(セキュリティの決まり `AI-n`・`AZ-n`・`L-n`・`T-n`・`V-n`・`D-n`。番号は動かさない)を指す**。外の資料や PR の番号を根拠にしない(`pnpm self-contained`)。
- `docs/specs` 仕様 / `docs/designs` 設計書(AI 用・網羅。未確定事項もここ。番号は仕様と対で同じ。`pnpm adr` が出す「仕様と設計書の次の番号」)/ `docs/adr` 設計判断(番号は `pnpm adr` が出す「次の番号」)。仕様・設計書・設計判断とも、同じフォルダで番号が重なると CI が落ちる。
- `docs/authz/matrix.yaml` … 権限の表(危険度「高」)。`docs/runbooks` … 手順(障害のときの入口は `incident.md`)。

## 場所ごと

- `docs/scenarios/` … 想定の場面(架空の A 社 10人・B 社 100人が企画から運用まで回す台本)と、足りない物の一覧 `gaps.md`(G-01 など)。**部品を足した・穴を埋めた PR では、当たる場面の判定と `gaps.md` の行も直す**(行は消さずに「✅ 済み」に。場面は「判定」と「足す前の判定」)。何を足すか迷ったら `gaps.md` の上から。
- `docs/review-viewpoints.md` … 設計とレビューの観点(共通の8つ+このプロダクト特有)。人が気づいた観点は足していく。使い方は `docs/guides/human-review.md`。
- `docs/product/plan.md` … 始め方の計画(誰の困りごと・確かめ方・合格と撤退の線)。`/kickoff` が書く。考え方は `docs/guides/before-pmf.md`。
- `docs/product/bets/` … 機能ごとの賭け(仮説・線と期限・小石 = 足すだけの判断の記録・資産か費用かの案)。`/bet` が書き、`pnpm bets` が確かめる。PR の本文に「取り組み」と「作業の種類」。`docs/guides/bets-and-assets.md`。
- `docs/product/positioning.md` … 約束(誰の何を、どう変えるか)・売り文句・代わりとの違い・言わないこと・根拠(どの記録・小石か)。`/positioning` が書く(PSF の後。LP・ブランドはここから)。
- `docs/product/brand.md` … ブランド(名前(仮)・話し方のトーン・色の理由と比)。`/brand` が約束の後に書く。色の正は `packages/ui/src/tokens.css`(比は `pnpm contrast`)。
- `docs/compliance/` … 認証(P マーク・ISMS)の準備の入口。附属書 A の管理策の一覧 `controls.yaml`(正)から適用宣言書 `soa.md` を `pnpm compliance --write` で作る(古い・根拠のリンク切れ・台帳が無い管理策を指すと CI が落ちる。点検の台帳 `docs/checkup/todo.yaml` の項目を足したら作り直す)。規程のひな形は `policies/`。毎月の証跡は `evidence.yml` が消せない S3 へ(`pnpm evidence --list`)。期限の来た見直し・教育・内部監査は `/compliance-check`。
- `docs/compliance/vendors.yaml` … 委託先の台帳(外の会社ごとに預け方・国・区分・契約・消え方)。**外のサービスの SDK・新しい種類の AWS の資源・Actions を足したら台帳に1件か1行**(無ければ CI が落ちる。台帳は人の確認が要る)。AI に渡すデータの決まりは `ai-data.md`。AWS の管理操作の記録は `infra/terraform/modules/audit-trail`(手順は `docs/runbooks/audit-trail.md`)。
- `docs/cost/`・`scripts/cost/` … 費用のページ(何にいくら・動いている物ごと・見積もりとの比べ)。`cost.yml` が非公開の S3 に置く(公開の場所に出さない)。AWS のリソースにはタグ `Component`(provider の別名で付ける)と `Bet`。SaaS の月額は `docs/cost/saas.yaml`・見積もりは `estimates.yaml`。人の時間(PR からの目安と手入力の幅)と賭けごとの PL も出す(分数は `people.yaml`。時給・売上は非公開の S3 の `cost/inputs/` だけ。**リポジトリに金額を置かない**)。月1回の資産と費用の区分の案は `/ledger`。`docs/guides/cost-dashboard.md`。
- `docs/checkup/todo.yaml` … 点検の台帳(正)。答えは `/checkup` が `pnpm checkup:answer` で書く(手で書かない)。台帳を直したら `pnpm checkup --write-readme`。
- `docs/kit/` … キットの持ち物: 部品のカタログ `catalog.yaml`(`/tailor` の正。部品を足したら1件。`pnpm kit:catalog`)・保守の方針 `maintenance.md`・取り込んだ版 `upstream.yaml` と取り込みの手引き `upgrade.md`・用語集 `glossary.md`・最初の1週間で読む道 `first-week.md`。
