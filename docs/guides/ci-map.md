# CI の一覧(何を守るか・落ちたらどうするか)

> GitHub Actions で動く物の全部を1枚に。**何を守っているか**(止めないと何が起きるか)・落ちたらどうするか・1人の間に要るか。
> 必須のチェックの名前の正は `.github/setup.yml` の `required_checks`、中身の正は `.github/workflows/`。いつ動くか・AWS が無いときどうなるかの早見は [reference.md](../reference.md) の「✅ CI で回るもの」。上限の値は [ci-limits.md](ci-limits.md)、待ちは [ci-speed.md](ci-speed.md)、週100〜200本を流すつまみは [throughput.md](throughput.md)。

## 📌 まとめ

- PR で動く必須のチェックは **16個**。これが全部緑でないとマージできない(ブランチ保護)。目的で分けると **① 壊れていないか 6・② 漏らさない・入られない 7・③ PR の決まり 3**。
- 必須でない PR の検査は **5つ**(印を付ける・インフラ・試作)。止めずに、人の目に出す。
- 定期・手動で動く物は **18**。お金がかかりうる物(AWS・Claude の API)は、ほとんど手動だけにしてある(定期で AWS を使うのは `evidence.yml` だけ。変数が無ければ飛ぶ。[automation.md](automation.md))。
- 1人の間に外してよい必須のチェックは無い。人の数で中身が変わるのは2つ: 「危険度『高』の承認の人数」(数えずに通る)と「未確定事項の答えの出どころ」(持ち主の会話の答えも通る。書き手は確かめない)。
- **個人情報を守る検査は9つ**あるが、どれも「単体」「結合」「Semgrep」の中で動く。横断の表は下の「🔐 個人情報を守る検査」。
- 文書だけの PR では、重いジョブ(結合・E2E・イメージ・VRT など)は中身を省いて成功を返す(`.github/scripts/ci-scope.mjs`。main とマージキューでは全部流す)。

## 1. 必須のチェック(16個。PR とマージキューで動く)

main への push で流れ直すのは `ci.yml` の物だけ(その中でも API の互換は main では飛ぶ)。

### ① 壊れていないか(6つ)

| チェック | 何を守るか | 落ちたら | 1人の間 |
|---|---|---|---|
| Biome・型・単体 | 書き方の崩れ・型の誤り・ロジックの誤り。**他社のデータが見える穴を作る権限の表の抜け**(①)。あわせて、キットの約束が文書とずれていないか(下の表) | 落ちたステップの名前のコマンドを手元で(`pnpm lint`・`pnpm typecheck`・`pnpm test` など) | 要る |
| 結合(Postgres・RLS・2社・権限の表 ②) | **他社のデータが見えない**(本物の Postgres の RLS で、全部の API を2社で叩く)・権限の表どおりに止まるか・カバレッジの下限 | `pnpm test:integration`(Docker が要る)。下限は `pnpm test:coverage` | 要る |
| API の互換(oasdiff。項目は足すだけ) | **古い画面・スマホのアプリが壊れない**(公開 API の項目を消す・意味を変える変更) | 消さずに足す形に戻す([api-changes.md](api-changes.md)) | 要る |
| 移行の検査(squawk) | **DB の移行で本番が止まらない**(表をロックする・戻せない変更) | `pnpm --filter @app/api db:lint`。ロックを取る変更は分けて流す(`.claude/skills/db-migration`) | 要る |
| E2E(docker compose+Playwright) | **会社が来てから去るまでの一周が通る**(本番と同じ形で起動し、外への通信を止めて画面から叩く。Cognito のログインも) | `docker compose up --build -d` → `pnpm test:e2e`。成果物 `playwright-report` にスクショと動画 | 要る |
| 見た目の比べ(VRT) | **意図しない見た目の崩れ**(主な画面を基準の画像と比べる) | 意図した変更なら、ラベル `vrt:update` で基準を撮り直してコミット([vrt.md](vrt.md))。文書だけの PR は中身を省いて成功を返す | 要る |

「Biome・型・単体」の中で、キットの約束が文書とずれていないかも見ている(どれも落ちたらそのコマンドを手元で):

- `pnpm guards` … 危険度「高」の守り(守る場所の一覧・ラベル・CODEOWNERS・フック)がそろっているか
- `pnpm self-contained` … キットの外の資料を根拠にしていないか
- `pnpm gaps` … 穴の一覧と、それを指す文書が今の姿か
- `pnpm design-tests --base HEAD^1` … 設計書の受け入れ条件ごとに、テストのファイルを名指しているか
- 賭けと KPI(`pnpm bets`・`pnpm kpi`)… 線を先に決めたか・ペルソナと KPI を指すか(同じステップでスクリプトのテスト `pnpm test:scripts` も)
- `pnpm kit:catalog` … 部品のカタログの書式・消し方のパス
- `pnpm setup:check` … 使うラベルが一覧にあるか・必須のチェックの名前がジョブにあるか
- `pnpm vendors` … 使う外のサービス・Actions が委託先の台帳にあるか
- `pnpm deps:licenses` … 入れてはいけないライセンス(GPL・AGPL など)の依存が無いか
- `pnpm compliance` … 認証の準備の台帳の指し合い・古さ
- `pnpm decisions --strict`・`pnpm adr` … 設計書に仮決めが残っていないか・ADR の番号(`--strict` を付けないと、仮決めが残っていても手元では落ちない)
- 試作の守り(`pnpm prototypes`)… 試作が本物の API・DB・AWS・秘密を読んでいないか
- 画面の JS・CSS の大きさの上限([ci-limits.md](ci-limits.md))

### ② 漏らさない・入られない(7つ)

| チェック | 何を守るか | 落ちたら | 1人の間 |
|---|---|---|---|
| 秘密情報(gitleaks) | **鍵・トークンがリポジトリに入らない** | **その鍵を作り直す**(消しても履歴に残る)。全履歴を見るので、緑にするには PR のブランチの履歴から消すか、誤検知なら `.gitleaksignore` に指紋を足す | 要る |
| コードの検査(Semgrep CE+自社ルール) | **テナントをリクエストの値で決めない・ログに個人情報を出さない**・生の SQL・お金を小数で持たない・時刻を手元の時間で持たない など(自社ルール13+画面の書き方3+公開のルール) | 指摘のルール名で直す。自社ルールは `.semgrep/rules.yml`(当たるべき所に当たるかのテストも同じジョブ) | 要る |
| 依存と設定(Trivy fs / config) | **既知の脆弱性がある依存・設定の穴**(Dockerfile・compose・Terraform)を入れない | 依存を上げる(Renovate)。届かない物は `/cve` で精査して、理由つきで `.trivyignore.yaml` へ | 要る |
| イメージのビルドと検査(Trivy image・api) | **出荷するイメージ(API)に既知の脆弱性を入れない**・ビルドが通る | ベースイメージか依存を上げる。精査は `/cve`。`.trivyignore.yaml` は効かない(イメージの検査は読まない) | 要る |
| イメージのビルドと検査(Trivy image・web) | 同じ(画面) | api と同じ | 要る |
| イメージのビルドと検査(Trivy image・mail) | 同じ(メールの中継) | api と同じ | 要る |
| ワークフローの検査(actionlint・zizmor) | **CI そのものが乗っ取られない**(Action を SHA で固定・権限を絞る・PR の本文で命令を差し込まれない) | 指摘どおりに直す。CI の設定は危険度「高」 | 要る |

### ③ PR の決まり(3つ)

| チェック | 何を守るか | 落ちたら | 1人の間 |
|---|---|---|---|
| 取り組みと作業の種類(PR の本文) | **何のための作業か**が残る(後で資産か費用かを分ける元。[bets-and-assets.md](bets-and-assets.md)) | PR の本文の「🎯 取り組み」と「作業の種類」を埋める(本文を直すと流し直す) | 要る |
| 危険度「高」の承認の人数 | **認証・DB・CI などが、決めた人数の人の目を通らずに入らない** | 決めた人数の承認をもらう(`.github/setup.yml` の `high_risk_approvals`) | **数えずに通る**(0人。人が増えたら人数を上げる) |
| 未確定事項の答えの出どころ | **AI が人の答えを書いたことにできない**(答えは人の GitHub のコメント・レビューを指す。1人の間は右の列) | 人に GitHub のコメントかレビューで答えてもらい、設計書の行からそれを指す | 要る。**持ち主の会話の答え(Slack・チャット)も通る**(CI は書き手を確かめない。人が増えたら、GitHub のコメント・レビューだけに戻る) |

- 「危険度『高』の承認の人数」「未確定事項の答えの出どころ」と、下の「テストを弱めた印」は、確かめる中身(スクリプト)を **PR の側ではなく土台のブランチの物**で動かす。PR の中で検査を緩めて通すのを防ぐため。

### 🔐 個人情報を守る検査(どのチェックの中で動くか)

個人情報の検査は、独立したチェックではなく、上の「Biome・型・単体」「結合」「Semgrep」の中で動く。どれかが落ちれば、その必須のチェックが赤になる。

| 何を守るか | 中身 | どのチェックの中 | 主なファイル |
|---|---|---|---|
| **ログに個人情報が出ない** | 目印つきの値(名前・電話番号・病名に見立てた文・メールアドレス)を DB・本文・パスに入れ、権限の表の全行 × 全ロールで叩く。出たログの全行に目印が1つでもあれば落とす | 結合 | `apps/api/test/integration/personal-data-logs.int.test.ts` |
| ログには出してよい項目だけ | 許可リストに無い名前の値は `[REDACTED]`。文の中の値も伏せる | 単体 | `packages/logging`(`fields.ts`・`scrub-text.ts`) |
| ログへの渡し方で止める | オブジェクトを丸ごと・広げて・個人情報の名前で・文に埋めて、ログに渡さない | Semgrep | `.semgrep/rules.yml` の `no-whole-object-logging`・`no-spread-in-logging`・`no-personal-field-logging`・`no-template-in-log-message` |
| **他社の個人情報が見えない** | 全部の API を2社で叩く・RLS で行を絞る・テナントをリクエストの値で決めない | 結合・Semgrep | `tenant-isolation.int.test.ts`・`rls.int.test.ts`・`tenant-from-request`・`tenant-scoped-db-only` |
| **個人情報の台帳が抜けない** | DB の全部の列に、区分(個人情報か・要配慮か)と目的がある。本物の DB の列とも突き合わせる | 単体・結合 | `classification.test.ts`・`classification.int.test.ts` |
| **要配慮個人情報は分けて暗号化** | 別のスキーマと接続・RLS・組織ごとの鍵(鍵を消すと読めなくなる)。決まった場所の外から触らせない | 結合・Semgrep | `sensitive.int.test.ts`・`sensitive-data-only-in-module` |
| **消したら残らない** | 解約で会社の分が、1人分の削除で本人の値が残らない(列の分類の個人情報の列と突き合わせる) | 結合 | `offboarding.int.test.ts`・`person-erase.int.test.ts`・`person-data.int.test.ts` |
| **写真から撮った場所が漏れない** | 上げた写真の撮った場所(GPS)・日時・機種・文字の欄を外す。ファイルの名前と URL をログに出さない | 単体・結合 | `strip-metadata.test.ts`・`files.int.test.ts` |
| **エラーの報告に載せない** | Sentry に送る前に、エラーの文とログから値を落とす | 単体 | `packages/error-reporting/src/scrub.ts` |

- 鍵・トークン(秘密)は別で、`gitleaks`(上の ②)と、AI が外へ書く文章を止める手元のフック(`.claude/hooks/guard-secrets-out.mjs`。CI ではない。止めるのは鍵の形だけ)。
- この表の外(API の返事に見せなくてよい項目が混ざる・AI が PR や Issue に個人情報を書く・リポジトリに本物の個人情報が入る など)を CI が見ているかは、まだ洗い出していない。

## 2. 必須でない PR の検査(5つ。止めずに印を付ける)

| ワークフロー | 何を守るか | いつ | 付いたら |
|---|---|---|---|
| `labeler.yml` | **危ない場所の変更を見落とさない**(変えたパスで `risk:low / medium / high`) | PR | 「高」は上の承認の人数が効く |
| `test-weakening.yml` | **AI がテストの側を変えて緑にしない**(skip・確かめを外す・下限を下げる) | PR | `tests:weakened`。危険度「高」とみなす。理由を人が見る |
| `ai-label.yml` | **AI が手伝った PR を数えられる**(週の数字と費用のページの元) | PR を開いた・本文を直した | `ai:assisted`。付けるだけで外さない |
| `terraform.yml` | **インフラ定義の誤りと設定の穴**(fmt・validate・tflint・Trivy。AWS 無しで回る) | `infra/` を変えた PR・main | 指摘どおりに直す。plan は下の `terraform-plan.yml` |
| `prototypes.yml` | **試作だけを合言葉つきの URL に置く**(PR のコードは AWS の権限なしのジョブでビルド) | 試作を変えた PR・main | AWS の変数が無ければ飛ぶ |

## 3. 定期と手動(18)

定期の物は、キットから作ったリポジトリでだけ動く(`KIT_ROLE=product`。例外は `vuln-scan.yml`)。AWS の変数や秘密が無いときは、失敗せずに飛ぶ。

### 見張り・知らせ(自動)

| ワークフロー | 何を守るか | いつ | 落ちたら・来なかったら |
|---|---|---|---|
| `vuln-scan.yml` | **動いていない間に見つかった新しい脆弱性**を拾う(Trivy の最新の DB・zizmor のオンライン版) | 毎週 月曜 5:00 | Issue が立つ → `/cve` で精査 |
| `checkup.yml` | **守りが外れたまま気づかない**を防ぐ(点検の台帳から確かめて担当者に知らせる) | 毎週 月曜 8:00・急ぎは毎日 | 毎週の Issue が来なければ点検が止まっている |
| `progress.yml` | **依頼が途中で止まったまま**にしない(親 Issue に n/m・止まった PR・完成の判定) | 毎朝 8:05・子の Issue が閉じたとき | 親 Issue の本文を見る |
| `human-queue.yml` | **人の判断待ちが埋もれない**(待っている PR・Issue を古い順に1つの Issue へ) | 毎朝 8:10 | 「🧑‍⚖️ 判断待ち」の Issue を上から |
| `metrics.yml` | **速くなったか・人がどれだけ関わったかを数で見られる**(DORA の4つ・無人化率・資産と ROI) | 毎週 月曜 8:30 | Actions の要約を見る([metrics.md](metrics.md)) |
| `evidence.yml` | **審査で見せる記録が消えない**(設定と点検の結果を、消せない置き場へ) | 毎月1日 | 置き場の変数が無ければ飛ぶ([../compliance/README.md](../compliance/README.md)) |

### 出す・戻す・確かめる(手動。有効にすれば定期にできる)

| ワークフロー | 何を守るか | いつ | 要るもの |
|---|---|---|---|
| `deploy.yml` | **確かめた版だけが本番へ**(stg を通る・prod は承認のあと・5xx で自動で戻す・仮決めが残れば止まる) | 手動(main から) | AWS の変数 |
| `deploy-mail-relay.yml` | 同じ(メールの中継。めったに変わらない) | 手動(main から) | AWS の変数 |
| `terraform-plan.yml` | **何が消えるかを人が見てから apply**(plan を PR にコメント) | 手動(PR は stg だけ・prod は main) | AWS の変数 |
| `preview.yml` | **本物に近い環境で確かめてから入れる**(PR ごとの環境・E2E・ZAP の受け身のスキャン) | 手動(PR の番号) | AWS の変数(dev のプレビュー専用) |
| `cleanup-previews.yml` | **消し忘れた環境でお金が出続けない** | 手動 | AWS の変数 |
| `restore-drill.yml` | **「バックアップがある」ではなく「戻せる」**(stg の DB を一時の DB に戻して確かめる) | 手動(有効にすれば毎月) | AWS の変数 |
| `cognito-contract.yml` | **偽物の Cognito と本物がずれていない**(同じテストを stg の本物に流す) | 手動(有効にすれば毎週) | AWS の変数 |
| `security-fuzz.yml` | **変な入力で 500 を返さない・OpenAPI どおりに返す**(全 API にロールごとに変な入力。他社のデータが見えるような意味の穴は見つけない) | 手動 | 要らない(ジョブの中の compose) |
| `zap-api-scan.yml` | **ログインした状態での攻撃に耐える**(stg に認証つきの ZAP) | 手動(公開のリポジトリでは、レポートが誰でも落とせると注意が出る) | stg とスキャン用の利用者 |

### そのほか(手動)

| ワークフロー | 何をするか | いつ | 要るもの |
|---|---|---|---|
| `cost.yml` | **何にいくらかかっているかが見える**(非公開の S3 に費用のページ) | 手動(有効にすれば毎日) | AWS の変数([cost-dashboard.md](cost-dashboard.md)) |
| `demo-reset.yml` | 営業のデモ用の組織を戻す(stg だけ。本番には流れない) | 手動(デモの前) | `DEMO_TENANT_ID`・`AWS_STG_DEPLOY_ROLE_ARN`(main からだけ) |
| `claude.yml` | 背景の AI。**外の人の文章を AI に読ませない**・秘密を AI のサブプロセスから消す | 手動 | Claude の API キー([unattended-ai.md](unattended-ai.md)) |

- 数は 2026-10-31 の `.github/workflows/` の28ファイル = 必須のチェックを持つ5つ(`ci.yml` の12・`vrt.yml`・`pr-work.yml`・`high-risk-approvals.yml`・`decision-evidence.yml`)+ 必須でない PR の検査5つ + 定期と手動の18。
- ワークフローを足した・ジョブの名前を変えたら、この表にも1行(必須のチェックの名前は `pnpm setup:check` が確かめるが、この表は確かめない)。
