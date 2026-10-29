# キットの用語集(キット独自の言葉 ↔ 標準の言葉)

> キットは、詳しくない人にも読めるよう**やさしい日本語**で書いている。そのぶん、業界で使う言葉と違う言い方が多い。引き継ぐ人・審査する人・外の資料と突き合わせる人は、この表で読み替える。
> **プロダクトの**言葉(組織・ロール・タスク…)は [docs/domain/glossary.md](../domain/glossary.md)。ここは**キットの仕組みの**言葉だけ。
> 新しい言葉を作ったら、ここに1行足す(標準の言葉が無ければ「—」)。

## 作り方(ライン)

| キットの言葉 | 標準の言葉(英語) | 意味 | どこで |
|---|---|---|---|
| ライン | AI 開発のパイプライン(AI-assisted delivery pipeline)・ソフトウェアファクトリー | 受付 → 振り分け → 仕様 → 設計 → 実装 → レビュー → 出す の7工程を、AI と人で回す流れ全体 | [concepts/line.md](../concepts/line.md) |
| ハーネス(3層) | エージェントのハーネス(agent harness)・ガードレール | AI を動かし、守り、確かめさせる仕組み一式。①手元の Claude Code(決まり・フック・スキル)②Issue から PR を出す背景の AI ③自前のファクトリー(PR が週に数十件を超えてから)の順に育てる | [concepts/line.md](../concepts/line.md) の 4 |
| 危険度(低・中・高) | リスクの段階(risk tier)・変更のリスク分類 | 変えた場所で決まる PR の重さ。人が何人見るかが変わる(低 0人・中 1人・高 2人) | [reference.md](../reference.md) の「危険度」・`.github/labeler.yml` |
| 守るパス | 保護されたパス(protected paths)・CODEOWNERS の対象 | 危険度「高」の場所の一覧。手元のフック・PR のラベル・CODEOWNERS が同じ一覧を見る。AI は人の確認なしに変えない | `.claude/hooks/protected-paths.json`・[guides/local-guards.md](../guides/local-guards.md) |
| 関所(認可の関所) | 認可のミドルウェア(authorization middleware)・ポリシーの適用点(PEP) | すべての API の前で「この人がこの操作をしてよいか」を決める所。決まりの無い API は既定で 403 | `apps/api/src/authz/middleware.ts` |
| 権限の表 | 認可のマトリクス(authorization matrix)・RBAC の表 | 誰が・どの API で・どうなるか(200 / 403 / 404)の表。テストがコードと突き合わせる | `docs/authz/matrix.yaml` |
| 人に聞く4つ | 人の判断が要る所(human-in-the-loop の判断点) | 事業判断・利用者の挙動・他チームとの契約や制約・戻せないリスク。それ以外は AI が決めて理由を書く | ルートの `CLAUDE.md` |
| 仮決め | 承認待ちの前提(pending assumption) | AI が「人に聞く4つ」を仮に決めたこと。残っている PR はマージしない | 設計書の「未確定事項」・`pnpm decisions` |
| 導入時に決める | 導入時の設定項目(adoption decision)・既定値の確認 | キットの既定のまま動くが、使う会社が本番の前に承認する所 | `pnpm decisions --adopt` |
| 未確定事項 | 未解決の論点(open questions)・前提の記録 | 設計書の表。仮決め・導入時に決める・保留・承認を分けて追う | `docs/designs/` の 12 |
| 設計書(AI 用) | 詳細設計書(design doc) | AI が網羅的に書く設計。人は PR の「人向けのまとめ」だけ読む | `docs/designs/`・[guides/human-review.md](../guides/human-review.md) |
| 人向けのまとめ | レビューの要約(review summary) | PR の本文の頭。事実・理由・問いで、人が判断する所だけ | [guides/human-review.md](../guides/human-review.md) |
| 観点 | レビューの観点(review checklist) | 設計とレビューで見る項目(共通の8つ+このプロダクト特有) | [review-viewpoints.md](../review-viewpoints.md) |
| 作り直し | 上流からの手戻り(rework at the source) | 誤りが入った工程(ナレッジ・要求・設計・実装・テスト)から直す。コードだけで継ぎ当てない | `/rework` |
| 外へ出した物 | 外向きの通信の記録(egress log) | AI が外へ向けてした操作(push・PR・Web を読んだ)。PR の欄に並べる | `pnpm outbound`・`docs/designs/0057-ai-egress.md` |
| 背景の AI | 非同期のエージェント(background agent) | GitHub の Actions の中で動く AI(`@claude`)。人が見ていない所の作業はここか絞った devcontainer で | [guides/unattended-ai.md](../guides/unattended-ai.md) |
| 試し | ドライラン(dry run) | 何も書き換えずに差分だけ出す。運営のコマンドと `pnpm setup:github` の既定 | — |

## 作る物を決める(PMF の前)

| キットの言葉 | 標準の言葉(英語) | 意味 | どこで |
|---|---|---|---|
| 賭け | 機能の仮説・実験(bet / feature hypothesis。Shape Up の bet に近い) | 機能1つぶんの「当たるか」。仮説・合格と撤退の線・期限を先に決める | `docs/product/bets/`・`/bet` |
| 小石 | 判断の記録(decision log entry)。足すだけの ADR の小さい版 | 賭けの中で何を見て何を決めたかの1行。消さずに足す | 賭けのファイルの「小石」 |
| 合格と撤退の線 | 成功の基準と撤退の基準(success / kill criteria) | 確かめる前に決める数字。越えたら進む・下回ったらやめる | `docs/product/plan.md`・賭け |
| 意思で進む | 根拠より判断で進める(conviction bet / override) | 線を越えていないが、引き受けた危なさと止める線を書いて進む | ADR 0035 |
| PSF / PMF | Problem-Solution Fit / Product-Market Fit | 解決策が刺さるか / 市場で使い続けられるか | [guides/before-pmf.md](../guides/before-pmf.md) |
| 試作 | プロトタイプ(clickable prototype) | 押せる画面だけ・偽のデータ・捨てる前提 | `prototypes/`・`/prototype` |
| 約束 | ポジショニング・バリュープロポジション | 誰の何を、どう変えるか。売り文句・LP の元 | `docs/product/positioning.md` |
| 取り組み・作業の種類 | 作業の分類(work classification。資産計上の判定の材料) | PR ごとに「どの賭けか・探索/作り込み/保守/撤去」を書く | PR の本文・[guides/bets-and-assets.md](../guides/bets-and-assets.md) |
| 意義の判断役 | 投資判断の門番(go / no-go gate)・プロダクトの審査役 | 「意義があるから、やる / やらない / 条件つき」を言い切る AI。数で言えなければやらない・ROI の根拠・当たり外れを人が判定、の3つの歯止めつき。呼ぶのはアイデア・分解の前・受け入れの3つだけ | `.claude/agents/purpose-judge.md`・`docs/product/verdicts/` |
| 北極星 | ノーススター指標(north star metric) | いちばんの物差し。工場(キット自身)は「意義があると判断した物が、使う人に届いて使われた数 ÷ 人の工数」 | `docs/product/kpi.yaml`・[roadmap.md](roadmap.md) の 4 |
| 無人化率(有人化率) | 自動化率・人の介在率の裏返し(automation rate) | 1 − 人が使った工数の割合。毎週いちばん目に見る入力の数で、北極星ではない(作る側の効率の数) | [roi.md](roi.md)・`pnpm metrics` |
| センサー | 自動の検査・テスト(automated checks / fitness functions) | コードが正しいかを確かめる物(テスト・型・検査・E2E・計測)。人が判定するのは、センサーそのものが正しいか | [../concepts/risk-areas.md](../concepts/risk-areas.md)・[../concepts/human-decisions.md](../concepts/human-decisions.md) |
| 会計区分 | 資産計上か費用か(capitalization) | 賭けの段階と作業の種類から出す案。決めるのは専門家 | `/ledger` |

## 回す(運用・守り)

| キットの言葉 | 標準の言葉(英語) | 意味 | どこで |
|---|---|---|---|
| 点検 | 定期点検・運用の健全性チェック(operational health check) | 段階ごとに要ることを週・月・年で知らせ、自動で確かめられる物は確かめる | `/checkup`・`pnpm checkup` |
| 点検の台帳 | 点検項目の一覧(control checklist)・運用の台帳 | 点検の正。項目・答え・履歴 | `docs/checkup/todo.yaml` |
| 担当者・相談先 | 責任者(owner)・エスカレーション先 | 点検に答える人・「分からない」を回す詳しい人 | 点検の台帳の `owners` |
| 段階 | 成熟度の段階(maturity stage) | 使い始めた日からの日数(立ち上げ・1か月・3か月…)と、会社の大きさ(🔴🟡🟢) | [concepts/stages.md](../concepts/stages.md) |
| 部品・カタログ | モジュール・機能の一覧(module catalog) | キットの部品ごとの「何をするか・消すと困ること・消し方」 | `docs/kit/catalog.yaml`・`/tailor` |
| 想定の場面 | シナリオ・テーブルトップ演習(tabletop exercise) | 架空の会社でキットを通しで回す台本と判定 | `docs/scenarios/` |
| 穴(G-nn) | ギャップ(gap)・既知の不足 | 場面で見つけた足りない物 | `docs/scenarios/gaps.md` |
| ひな形 / 使う側 | テンプレートのリポジトリ / 派生のリポジトリ(template / downstream) | キットそのもの / キットから作ったプロダクト。定期の運用は使う側だけ | `vars.KIT_ROLE`(ADR 0027) |
| 上流の版 | アップストリームのリリース(upstream release) | キットの版。使う側が取り込む | [upgrade.md](upgrade.md)・`docs/kit/upstream.yaml` |
| 運営のコマンド | 運用の管理コマンド(admin CLI / ops tooling) | 開通・解約・プランなど、API を作らずに運営が打つコマンド | `docs/runbooks/` |
| 代理ログイン | なりすましの閲覧(support impersonation / break-glass access) | 組織が許可したときだけ、社員が閲覧者として入る | [runbooks/support-access.md](../runbooks/support-access.md) |
| 送信待ち | アウトボックス(transactional outbox) | 外へ送る出来事を、同じトランザクションで表に積んで後で送る | ADR 0006 |
| 要配慮個人情報 | 特別な種類の個人データ(special category data。個人情報保護法 2条3項) | 病歴など。別の接続と列ごとの暗号化で扱う | ADR 0029 |
| 列の分類 | データ分類(data classification) | 全部の列に public / internal / personal / sensitive と目的 | `apps/api/src/db/classification.ts` |
| 決裁用・改善用の数字 | DORA の4つ・チームの指標 | 経営に出す数字と、チームが良くするための数字を分ける | [guides/metrics.md](../guides/metrics.md) |
| 見た目の比べ | ビジュアル回帰テスト(VRT) | 画面のスクショを前と比べる | [guides/vrt.md](../guides/vrt.md) |
