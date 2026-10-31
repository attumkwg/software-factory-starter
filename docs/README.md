# docs の地図

> はじめての人は **[getting-started.md](getting-started.md)**(使い始めの手引き)から。引き継ぐ人は **[kit/first-week.md](kit/first-week.md)**(最初の1週間で読む9つ)から。ルートの README は短い入口で、詳しい中身(ファイルの地図・コマンド・考え方とファイルの対応・CI の一覧)は **[reference.md](reference.md)** にある。

> docs には2種類ある。**「いまの正」は常に今の姿に直す。「記録」は書いた時のまま残す**(直さずに、新しいものを足す)。

## いまの正(今の姿。変わったら同じ PR で直す)

| 場所 | 中身 | 直すとき | 危険度 |
|---|---|---|---|
| [concepts/](concepts/README.md) | 考え方の本体(7工程・ハーネス3層・段階と費用・人と AI の分担・長く回す)。ADR・仕様・コードが根拠として引く | 考え方を変えたとき(ADR を足すほどの判断なら ADR も) | 低 |
| [domain/](domain/) | 用語集と領域ごとの説明(エンティティ・状態・守るルール・境目) | 言葉・ルール・状態が変わったとき | 中 |
| [authz/matrix.yaml](authz/matrix.yaml) | 権限の表(誰が・どの API で・どうなるか) | API を足す・権限を変えるとき | 高 |
| [design-system.md](design-system.md) | 部品の一覧と使い方 | 部品を足す・変えるとき | 中 |
| [db/](db/) | 表の説明書(tbls で作る。手で直さない) | 移行を足したあと `pnpm docs:db` | 低 |
| [playbook.md](playbook.md) | 開発の進め方・毎週やること・分担 | 進め方を変えたとき(週の振り返りで決める) | 低 |
| [review-viewpoints.md](review-viewpoints.md) | 設計とレビューの観点(共通の8つ+このプロダクト特有)。溜めていく台帳 | 人がレビューで新しい観点に気づいたとき・機械で確かめられるようになったとき | 低 |
| [security.md](security.md) | セキュリティの決まり(AI ならではの守り AI-n・認可 AZ-n・テナント分離 L-n / T-n / V-n。番号は動かさない)・何を確かめていて、何を確かめていないか・深い診断の段取り | 検査を足す・変えたとき | 中 |
| [compliance/](compliance/README.md) | 認証の準備(P マーク・ISMS)の入口。委託先の台帳(`vendors.yaml`。コードと CI で照らす)・AI に渡すデータの決まり・管理操作の記録の場所・附属書 A の管理策の一覧(正)と適用宣言書(SoA)・規程と様式のひな形・毎月の証跡(消せない S3) | 外の会社・SDK・AWS のサービス・Actions を足すとき(`pnpm vendors` が落ちて気づく)。管理策の適用を変える・規程を制定し見直すとき(SoA は `pnpm compliance --write`。`/compliance-check` が期限を聞く) | 高(台帳) |
| [legal/](legal/README.md) | お客さんに出す取り決めの型(申込書・SLA・個人データの取り扱いの取り決め)。文面は書かず、項目ごとにキットの既定・根拠のファイル・使う人が決めること。条件を「変えない / 仕組みを変えれば変えられる / 契約だけで変えられる」に分ける | 根拠の仕組み(バックアップ・保存の期間・障害の連絡・見張り・委託先)を変えたとき | 低 |
| [kit/catalog.yaml](kit/catalog.yaml) | キットの部品のカタログ(何をするか・要る/要らないプロダクト・消すと困ること・つながり・法令や認証・消し方)。README の「使い始めたらやること」はここから作る | 部品を足す・消す・ファイルを動かしたとき(`pnpm kit:catalog` が落ちて気づく)。README は `pnpm kit:readme` | 低 |
| [kit/one-pager.md](kit/one-pager.md) | 経営者・情シス向けの1枚(流れの図・人と AI の分担・費用・効果の見込みを【実測】と【仮定】に分けて・審査で聞かれること) | 費用の数字・人が止まる所・効果の実測が変わったとき | 低 |
| [kit/first-week.md](kit/first-week.md)・[kit/glossary.md](kit/glossary.md) | 引き継ぐ人が最初の1週間で読む9つと、キット独自の言葉 ↔ 標準の言葉の対応(プロダクトの言葉は `domain/glossary.md`) | 入口の文書を足す・動かしたとき・新しい言葉を作ったとき | 低 |
| [kit/roadmap.md](kit/roadmap.md)・[kit/roi.md](kit/roi.md)・[kit/release-check.md](kit/release-check.md) | 公開までの道のり(2026-10-31 に公開)・キット自身の ROI と数の出どころ・公開や版を切る前の点検 | 公開・版を切るとき・数を言うとき | 低 |
| [kit/limits.md](kit/limits.md) | できないこと・1人の間の回し方・確かめていないこと(本物の AWS の上で確かめる物の表)を1か所に。各行に代わりにどうするか・穴の番号 | 穴が済んだ・本物の AWS で確かめた・できないことが増えた・減ったとき | 中 |
| [kit/maintenance.md](kit/maintenance.md)・[kit/upgrade.md](kit/upgrade.md) | キットの保守の方針(誰が・どこまで・いつまで・版の付け方)と、キットから作ったリポジトリへの新しい版の取り込み方(取り込んだ版は `kit/upstream.yaml`)。変更の記録はルートの `CHANGELOG.md`、穴の知らせ方は `SECURITY.md` | 約束の日数・版の付け方を変えたとき・版を切るとき(`CHANGELOG.md`) | 低 |
| [product/tailoring.md](product/) | 部品の残す・消すの記録(答え・部品ごとの決定と理由)。足すだけ | `/tailor` が書く | 低 |
| [product/plan.md](product/) | 始め方の計画(誰の困りごと・いちばん危ない思い込み・確かめ方・合格と撤退の線)。テンプレートあり | 確かめた結果が出たとき(`/kickoff` が書く) | 低 |
| [product/legal.md](product/) | 法令と業界の決まりの洗い出し(作り・データ・相手から当てはまりそうな候補と、専門家に聞くこと)。ひな形 `product/_legal-template.md` | `/kickoff` が書き、`/bet` が機能を足すたびに見直す | 低 |
| [product/roadmap.md](product/) | ロードマップの1枚(社内の版と、約束しない社外の版 `roadmap-public.md`)。賭けから作る | `pnpm bets --roadmap --write`(手で直さない) | 低 |
| [product/industry.md](product/industry.md)・[product/personas.md](product/personas.md)・[product/councils/](product/councils/)・[product/kpi.yaml](product/kpi.yaml) | 業界の前提・ペルソナ(P-n。7つの立場の地図)・合議の記録・KPI の木(北極星1・入力 2〜4・守り1以上と値の記録。合議から)。型と見本(架空)あり。考え方は [guides/kpi.md](guides/kpi.md) | 計画を立てた・客層を足した・話を聞いた・測った・賭けが psf に入るとき(`/persona`・`/council` が書く。`pnpm kpi` が確かめる) | 低 |
| [product/bets/](product/bets/) | 機能ごとの賭け(仮説・線と期限・小石 = 足すだけの判断の記録・資産か費用かの案)。テンプレートと見本あり。考え方は [guides/bets-and-assets.md](guides/bets-and-assets.md) | 賭けを開く・結果が出た・段階が変わるとき(`/bet` が書く。`pnpm bets` が確かめる) | 低 |
| [product/positioning.md](product/) | 約束(誰の何を、どう変えるか)・売り文句・代わりとの違い・言わないこと・根拠(どの記録・小石か)。テンプレートあり。LP・チラシ・営業の資料・ブランドはここから作る | PSF の結果が出たとき・次の池に進むとき(`/positioning` が書く)。変えたら LP とブランドも | 低 |
| [product/brand.md](product/) | ブランド(名前(仮)と確かめること・話し方のトーン・色の理由とコントラストの比)。テンプレートあり。色の正は `packages/ui/src/tokens.css` | 約束を変えた・正式な名前を決めたとき(`/brand` が書き、トークンの PR と一緒に) | 低 |
| [reference.md](reference.md) | キットの中身の早見表(ファイルの地図・手元のコマンドの全部・考え方とファイルの対応・CI で回る物・わざとやっていないこと・注意)。AI が「どこに何があるか」を探す入口 | ファイル・コマンド・ワークフローを足す・動かしたとき | 低 |
| [scenarios/](scenarios/README.md) | 想定の場面(架空の A 社 10人・B 社 100人が企画 → 法令 → 開発 → お金 → 運用 → セキュリティ → 規模拡大を回す台本)と、足りない物の一覧([scenarios/gaps.md](scenarios/gaps.md)) | 部品を足した・穴を埋めたとき(場面の判定と gaps.md の行を同じ PR で) | 低 |
| [getting-started.md](getting-started.md) | 使い始めの手引き(手元 → 置き換え → GitHub → AWS → Slack → 運用) | 手順や費用が変わったとき | 低 |
| [guides/](guides/) | 自動で動くもの・Slack・見張りと知らせ・データの保存と削除・例外処理・API の変え方・手元で AWS をどこまで再現するか・[PMF の前の進め方](guides/before-pmf.md)(何を作るかを安く確かめる)・[試作を出す](guides/prototypes.md)(押せる画面だけ・合言葉つきの URL)・[公開の LP を出す](guides/landing-page.md)(事前登録の同意・どこから来たかの計測)・[人が見る所を絞る](guides/human-review.md)(未確定事項・人向けのまとめ・上流からの作り直し)・[CI の一覧](guides/ci-map.md)(何を守るか・落ちたらどうするか)・[守りの3層](guides/local-guards.md)(AI に勝手に変えさせない所と、GitHub のプランで変わる所)・[人が見ていない所で AI を回す](guides/unattended-ai.md)(絞った devcontainer か背景の AI でだけ・外へ出した物を見る)・[GitHub を一括で整える](guides/github-setup.md)(pnpm setup:github・ひな形と使う側)・[ラベルの手引き](guides/labels.md)(何のラベルか・誰が付けるか・付いたらどうするか)・[費用のページ](guides/cost-dashboard.md)(何にいくら・見積もりとの比べ)・[当番の決まり](guides/on-call.md)(夜中に誰が見るか・どのアラームで起こすか)・[手でやる設定](guides/manual-setup.md)(GitHub・AWS・OIDC の変数・Slack・バックアップ・運営の組織)・[題材を差し替える](guides/replace-subject.md)(TODO → 自分のプロダクトの順と量の例) など、仕組みの使い方 | 仕組みを変えたとき | 低 |

## 記録(書いた時のまま。古くなっても直さない)

| 場所 | 中身 | 書くとき |
|---|---|---|
| [product/interviews/](product/interviews/) | 話を聞いた記録(1人1ファイル。名前・連絡先は書かない)。テンプレートあり | 話を聞いたその日に |
| [specs/](specs/) | 機能ごとの仕様(受け入れ条件・悪用のされ方)。テンプレートあり | 作る前(`/new-feature` が書く) |
| [designs/](designs/) | 機能ごとの設計書(AI 用。8つの観点で網羅的に)と、AI の仮決めを追う「未確定事項」。テンプレートあり。仕様と同じ番号 | 仕様と同じ PR で(`/design` が書く)。完了までは作り直しで直してよい(`/rework`) |
| [adr/](adr/) | 設計の判断となぜそうしたか。テンプレートあり | 後から「なぜ?」と聞かれそうな判断をしたとき |
| [runbooks/](runbooks/) | 困ったときの手順。入口は [runbooks/incident.md](runbooks/incident.md)(障害対応の型)。アラーム・Sentry・サポートの代理ログイン・開通(組織を作る)・契約のプラン・1人分の開示と削除・解約・DB を戻す・デプロイと移行を戻す・秘密が漏れた・他社のデータが見えた・個人データが漏れた(委員会への報告と本人への通知)・管理操作の記録(CloudTrail)・要配慮個人情報の段を上げる・Cognito・メール | 事故のあと・当番の手順を決めたとき |
| [incidents/](incidents/) | 障害の振り返り(S1・S2。1件1ファイル) | 障害のあと5営業日以内([runbooks/incident.md](runbooks/incident.md) の 6) |

- 仕様と今の姿が違ってきたら、**仕様は直さず**、domain(いまの正)を直し、必要なら新しい仕様を足す(設計書も同じ)。
- ただし**完了する前**(実装の PR がまだマージされていない間)は、誤りが見つかれば仕様と設計書を直してよい。直し方は `/rework`(誤りが入った工程から作り直す)。
- 判断を変えたら、古い ADR は消さずに「置き換え(→ ADR NNNN)」と書いて、新しい ADR を足す。

## 何をいつ直すか(早見表)

| こんな変更をしたら | 一緒に直すもの |
|---|---|
| 新しい API | `authz/matrix.yaml`(テストが落ちて気づく)・`domain/<領域>/` の守るルール |
| DB の表・列 | `pnpm docs:db` で `db/` を作り直す・`domain/<領域>/` のエンティティ |
| 新しい言葉・言葉の意味 | `domain/glossary.md` |
| 状態(例: 未完了 → 完了)の増減 | `domain/<領域>/` の状態 |
| 部品 | `design-system.md` |

迷ったら `/update-domain-docs` スキル(変更を読んで、直すべき資料を挙げて直す)。
