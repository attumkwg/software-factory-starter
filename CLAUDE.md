# CLAUDE.md

マルチテナントの TODO アプリ(組織 → プロジェクト → タスク)。AI エージェントが PR を出す前提の雛形。

> このファイルは**どこを触っても守ること**だけ。場所ごとの決まりは、その場所の `CLAUDE.md`(その下のファイルを読むと読み込まれる): `apps/api/`(領域ごとに `src/domains/<領域>/` も)・`apps/web/`・`packages/`・`infra/`・`.github/`・`docs/`。
> どこに何があるか・コマンドの全部は **`docs/reference.md`**(「🧰 コマンドの全部」)。キット独自の言葉(賭け・小石・関所・ライン・危険度…)は `docs/kit/glossary.md`。

## コマンド(よく使う物)

- `pnpm install` / `pnpm dev`(API 3000 + 画面 5173。先に `docker compose up -d db && pnpm db:migrate && pnpm db:seed`)
- `pnpm lint`(Biome。複雑さ・長さの上限も)/ `pnpm typecheck` / `pnpm test`(単体)/ `pnpm test:integration`(Docker が要る)/ `pnpm test:coverage`(カバレッジの下限。API は単体+結合で見るので Docker が要る。`docs/guides/ci-limits.md`)
- 影響範囲だけ: `pnpm turbo run typecheck test --filter=...[HEAD]`
- `pnpm test:e2e`(`docker compose up --build -d` のあとで。http://localhost:8080 = ALB の代わり)/ `pnpm vrt`(見た目の回帰テスト。画面を変えたら `pnpm vrt:update`。`docs/guides/vrt.md`)
- 守り: `pnpm guards`(危険度「高」の守りが一覧とそろっているか)/ `pnpm self-contained`(キットの外の資料を指していないか)/ `pnpm decisions --strict`(仮決めが残っていないか)/ `pnpm gaps`(穴の一覧の今の数と、済んだ穴を「穴」と書いた文書。表は `--write`)/ `pnpm outbound`(PR の「🚪 外へ出した物」の表。`docs/designs/0057-ai-egress.md`)

## 地図(1行ずつ。詳しくはその場所の CLAUDE.md と資料)

- **入口の分け方**: ルートの `README.md` は使い始める人向けの短い入口(手で直してよいが、詳しい中身は足さない。`<!-- kit:readme -->` の間は `pnpm kit:readme` が作る)。docs の地図は `docs/README.md`。手でやる設定(GitHub・AWS・OIDC の変数・Slack・バックアップ・運営の組織)は `docs/guides/manual-setup.md`
- `apps/api` … Hono の API。領域ごとに `src/domains/<領域>/`。監査ログ・機能フラグ・解約の削除・列の分類・要配慮個人情報もここ(`apps/api/CLAUDE.md`)
- `apps/web` … TanStack Start の画面(SSR。API とは別のサービス。`apps/web/CLAUDE.md`)
- `apps/site` … 公開の LP(静的。本番だけ検索に載る)。言葉は `src/content.ts`(`docs/product/positioning.md` から写す)。決まりは `docs/guides/landing-page.md`
- `packages/` … 画面と API の契約(shared)・ログ(logging)・Sentry(error-reporting)・偽物の Cognito・UI の部品(`packages/CLAUDE.md`)
- `docker/postfix` … メールの中継(本番は ECS で SES へ・手元は Mailpit へ。http://localhost:8025)。`docs/guides/mail.md`
- `prototypes/<賭けの ID>-<名前>/` … 確かめるための試作(押せる画面だけ・偽のデータ・捨てる物)。`/prototype` が作る。本物の API・DB・AWS・秘密を読むと CI が落ちる(`pnpm prototypes`。`docs/guides/prototypes.md`)
- `infra/terraform` … AWS(modules と envs。`infra/CLAUDE.md`)。**apply はしない**(人が CI で行う)
- `.github/` … CI と、GitHub の設定とラベルの正(`.github/CLAUDE.md`)
- `docs/` … 仕様・設計書・ADR・手順書・想定の場面・認証の準備・費用・プロダクトの記録(`docs/CLAUDE.md`)。**根拠は `docs/concepts/`(考え方)と `docs/security.md`(番号つきの決まり)を指す**(外の資料や PR の番号を根拠にしない。`pnpm self-contained`)
- `scripts/` … キットのコマンドの中身(点検・GitHub の設定・認証の準備・費用・数字)。どのコマンドが何かは `docs/reference.md`

## 足したら1行(場所をまたぐ決まり)

| 足した・変えた物 | どこに | 忘れると |
|---|---|---|
| 書き込みの API | `apps/api/src/audit/actions.ts` に名前 | CI が落ちる |
| DB の列 | `apps/api/src/db/classification.ts` に区分と目的 | CI が落ちる |
| `tenant_id` の表 | `apps/api/src/offboarding` の `TENANT_TABLES` | 解約で消し残る |
| ログに出す新しい名前 | `packages/logging` の `ALLOWED_KEYS`(人の確認) | `[REDACTED]` になる |
| 外のサービスの SDK・新しい種類の AWS の資源・Actions | `docs/compliance/vendors.yaml`(人の確認) | CI が落ちる |
| ラベルを使う物・ジョブの名前 | `.github/labels.yml`・`.github/setup.yml` の `required_checks` | CI が落ちる |
| キットの部品 | `docs/kit/catalog.yaml`(`pnpm kit:catalog`) | CI が落ちる |
| 部品を足した・穴を埋めた PR | `docs/scenarios/gaps.md` の行と、当たる場面の判定(何を足すか迷ったら `gaps.md` の「🎯」の段の上から。`pnpm gaps --write`) | CI が落ちる・場面の判定が古くなる |

## 必ず守る

- 仕様(Issue の受け入れ条件か `docs/specs/`)の無い変更はしない。分からなければ PR で「人に判断してほしい所」に書く。
- 1 Issue = 1 PR。PR テンプレートの欄(危険度・テスト結果・判断してほしい所)を全部埋める。
- 何を作るか・作る前に何を確かめるか → `/kickoff`。キットの部品の残す・消す → `/tailor`(正は `docs/kit/catalog.yaml`。部品を足したら1件足す。`pnpm kit:catalog`)。機能1つぶんを確かめながら作る → `/bet`(新しい機能は賭けの ID から)。約束と売り文句(LP・チラシ・営業の言葉の元。PSF の後)→ `/positioning`。ブランド(名前・トーン・色。約束の後)→ `/brand`。点検で担当者に聞くこと・手でやること → `/checkup`(1問ずつ。答えは台帳に書いて PR)。認証(P マーク・ISMS)の準備の期限(規程の見直し・教育・内部監査)→ `/compliance-check`(`/checkup` の一種)。点検の台帳に世の中の変化を取り込む(月1回・人が起動)→ `/checkup-refresh`。セキュリティの質問票の下書き(根拠のリンクつき。下書きはリポジトリの外)→ `/security-questionnaire`。脆弱性(CVE・Dependabot の通知)の精査と対応方針 → `/cve`(届く・まだ直していない穴の中身はリポジトリにも Issue にも書かない。`docs/guides/vulnerabilities.md`)。新しい API → `.claude/skills/add-api-endpoint`。新しい領域 → `.claude/skills/add-domain`(領域ごとの CLAUDE.md も型から作る)。DB の変更 → `.claude/skills/db-migration`。設計 → `/design`。直す → `/rework`。
- **人に聞くのは4つだけ**: 事業判断・利用者の挙動・他チームとの契約や制約・戻せないリスク。それ以外は聞かずに決め、設計書の「決めたこと」に理由を書く。4つに当たる判断は止まらずに仮に決め、設計書の「未確定事項」に `仮決め` で残す(人の答えなしに `承認` にしない)。`仮決め` が残る PR はマージに回さない(`pnpm decisions --strict`)。
- **誤りは、入った工程から作り直す**(ナレッジ → 要求 → 設計 → 実装 → テスト)。上流の誤りをコードだけで継ぎ当てない(`/rework`)。
- CI が落ちたら直すのは2回まで。3回目は止めて、PR に状況を書いて人に渡す。
- **人が見ていない所で回す作業(夜・長い作業)は、外への通信を絞った devcontainer か背景の AI(`claude.yml`)でだけ**。PR の「🚪 外へ出した物」に、外へ向けた操作を並べる(頼まれていない物は「いいえ」)。`docs/guides/unattended-ai.md`

## してはいけない

- テナントをリクエストの値(URL・本文・ヘッダー)で決める。テナントはセッションからだけ。
- ルートやリポジトリで接続プール(`RootDb`)を直接使う。`c.var.tx`(テナントの文脈つき)だけを使う。
- ログにオブジェクトを丸ごと渡す(`logger.info(user)`)。必要な項目だけを `{ userId }` の形で。
- 本番の個人データ(名前・メールアドレス・題名・本文・画面のスクショ)を読む・求める。受け取ってよいのは ID と集計まで。要配慮は件数も受け取らない(`docs/security.md` の AI-6・`docs/compliance/ai-data.md`)。貼られたら使わずに、そう伝える
- 秘密・本番の値をコード・ログ・PR に書く。`.env` を読む・作る。
- 要配慮個人情報(スキーマ `sensitive` の中身・暗号文・復号した値・データ鍵)を読む・ログや PR や Issue に書く・自分の調べの材料にする。事故の調べでも、受け取るのは組織・利用者の ID と鍵の利用の記録の形(誰が・いつ)まで。要配慮の件数も受け取らない(AI-6・`docs/runbooks/incident.md` の 2)。
- 本番の DB や AWS に書き込む操作(戻す・入れ替える・止める)を自分で打つ。手順書(`docs/runbooks/`)のコマンドを、確かめた形で人に渡す。
- 人の承認なしに次を変える(危険度「高」): 一覧は `.claude/hooks/protected-paths.json`(認証・認可・DB・移行・権限の表・分離と認可を確かめるテスト・infra・CI・ハーネス・このファイルと場所ごとの CLAUDE.md・検査の除外・依存の入れ方)。Edit・Write は確認が出る(使う人が手元の `env` に `KIT_EDIT_GUARD=pr` と書いたときは出ない。そのときは PR の危険度を「高」にして、変えた理由を「人に判断してほしい所」に書く)。Bash で書き換えて確認を避けない(フックが聞く)。変数は自分で書かない
- main へ push する・強制 push する・PR をマージする・承認する(フックが止める。`docs/guides/local-guards.md`)
