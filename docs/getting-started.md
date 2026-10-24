# 使い始めの手引き

> このキットを「自分のプロダクトの土台」として使えるようになるまでの順番。
> ①〜③はお金がかからない。④から AWS の費用がかかる。急がず、①②で十分に慣れてから進めてよい。

| # | やること | かかる時間の目安 | お金 |
|---|---|---|---|
| はじめ | GitHub を一括で整える(`pnpm setup:github`) | 10分 | 0円 |
| ⓪ | 何を作るかを決める(`/kickoff`) | 半日〜(確かめるのは数週間) | 0円 |
| ⓪' | 部品を選ぶ(`/tailor`) | 30分〜(消すのは1つずつ PR) | 0円 |
| ① | 手元で動かす | 30分 | 0円 |
| ② | 自分のプロダクトに置き換える | 数日〜(最初の機能まで) | 0円 |
| ③ | GitHub の設定 | 1時間 | 0円(Actions の無料枠の中) |
| ④ | AWS を立てる | 1〜2日 | 月 約2.2万円〜(下の表) |
| ⑤ | Slack から頼めるようにする | 半日〜 | 案による |
| ⑥ | 毎週の運用 | 毎週30分 | — |

---

## はじめに: GitHub を一括で整える

キットから自分のリポジトリを作ったら、最初に1つだけ流す(`gh` でそのリポジトリの管理者としてログインしておく):

```bash
pnpm setup:github
```

試し(差分だけを出す。何も書き換えない)。中身を見て、よければ `pnpm setup:github --apply`。ブランチ保護と必須のチェック・ラベル・Environments・Actions の設定がそろい、変数 `KIT_ROLE=product` が付いて**定期の運用(毎週の点検の知らせ・定期の脆弱性チェック)が動き出す**。何度流しても同じ結果になる。

最後に「人がやること」(Renovate の App・秘密の値・台帳を自分の物にする `pnpm checkup:adopt`・最初の `/checkup-refresh` など)が、済んでいない物だけ出る。手順と困ったときは [guides/github-setup.md](guides/github-setup.md)。

## ⓪ 何を作るかを決める

キットは「作る」を速くする。だから**作る前に、作る物が合っているかを安く確かめる**。

- Claude Code で `/kickoff` と打つ。誰の困りごとか・どこまで確かめたか・いちばん危ない思い込み・確かめ方・合格と撤退の線を、1問ずつ聞いて `docs/product/plan.md` にする(Claude が競合や値段を下調べする)。
- 確かめた結果が出たら、もう一度 `/kickoff`。基準と比べて「進む・変える・やめる」を決める。
- 考え方と段階ごとのキットの使い方は [guides/before-pmf.md](guides/before-pmf.md)。**話を聞く・画面だけで確かめる段階では、AWS は要らない。**
- ①は並行して進めてよい(キットに慣れておく)。②で題材を差し替えるのは、作る物が決まってから。
- 作る物が見えたら `/tailor`。会社向けか・個人情報・お金・メール・検索・スマホ・認証の予定を1問ずつ聞き、キットの部品(監査ログ・代理ログインなど)ごとに残す・消すを決めて `docs/product/tailoring.md` に残す。**迷ったら残す**。部品の一覧は [kit/catalog.yaml](kit/catalog.yaml)。

## ① 手元で動かす

要るもの: **Node.js 24**(版の切り替えは mise などで。`.node-version` に `24` とある)・**Docker**。

```bash
corepack enable
```

```bash
pnpm install
```

```bash
pnpm test
```

```bash
docker compose up --build
```

http://localhost:8080 を開き、`admin@acme.test` でログインする(パスワードなし。開発用のログイン)。

> アプリが送ったメールは http://localhost:8025(Mailpit)に届く。外には出ない。

> 本番と同じ「登録 → 確認コード → ログイン → 二段階認証」を試すときは、偽物の Cognito を重ねて立てる: `docker compose -f docker-compose.yml -f docker-compose.cognito.yml up --build -d`(AWS は要らない。確認コードは http://localhost:8025 に届く。[guides/local-environment.md](guides/local-environment.md))。
画面は SSR(サーバーで HTML を作る)なので、ページのソースを見ると中身が入っている。

確かめること:

- [ ] `pnpm test`(単体)と `pnpm test:integration`(本物の Postgres)が通る
- [ ] `pnpm test:e2e`(画面の E2E。`docker compose up` のあと)が通る
- [ ] `admin@globex.test` でログインすると、Acme のプロジェクトが見えない(組織が分かれている)
- [ ] Claude Code でこのフォルダを開き、`/new-feature` で「タスクに期限を付けたい」と頼んでみる(OK と言うまで何も作られない)

## ② 自分のプロダクトに置き換える

TODO アプリは「ラインを見せるための題材」。**ラインは残し、題材を差し替える**。

| 残す(ライン) | 差し替える(題材) |
|---|---|
| `apps/api/src/app.ts`・`authz/middleware.ts`・`auth/`・`db/tenant.ts`・`db/client.ts`・ログ・設定 | `apps/api/src/domains/` の projects と tasks(organizations は残す) |
| `drizzle/0001_rls.sql` の形(新しい表にも同じ形で RLS) | 領域の `schema.ts`・`drizzle/` の移行・`domains/dependencies.ts` の向き |
| `authz/policy.ts` の仕組み・`docs/authz/matrix.yaml` の形 | 権限の名前と行(自分の API に合わせる) |
| `packages/ui`(部品とトークンの仕組み) | `tokens.css` の色(自分のブランド) |
| CI・検査・Semgrep のルール・ハーネス(`CLAUDE.md`・`.claude/`) | `CLAUDE.md` の最初の1行(何のプロダクトか) |
| `docs/` の形(テンプレート・地図) | `docs/domain/` の中身・`docs/specs/0001` |
| Terraform の modules | envs の名前(`project` の変数)・ドメイン |

進め方:

1. 最初の機能を `/new-feature` で仕様にする(②の承認は自分)。
2. 移行が要るなら `.claude/skills/db-migration` の手順で。projects・tasks の表は、使わなくなったら消す移行を足す(いきなり 0000 を書き換えない。まだ本番が無いなら 0000 から作り直してもよい)。
3. 新しい API は `.claude/skills/add-api-endpoint` の手順で(権限の表に1行)。
4. TODO の部品を消すたびに `pnpm test:all` が通ることを確かめる。権限の表のテストが、消し忘れ・書き忘れを落としてくれる。

## ③ GitHub の設定

「はじめに」の `pnpm setup:github --apply` で、下の物はほぼそろっている(設定の正は `.github/setup.yml`・`.github/labels.yml`)。ここでは中身を確かめる。詳しくはルートの README の「本人が手でやる設定」の 1。要点:

> ⚠️ **非公開のリポジトリを GitHub Free で使うと、ブランチ保護・Environments が使えない**(下の1つ目と3つ目ができない)。AWS と Claude の鍵を入れる前に、公開にするか Pro / Team にする。何が守られて何が守られないかは [guides/local-guards.md](guides/local-guards.md)。

- [ ] **ブランチ保護(main)**: PR 必須・CI のチェック必須。🧍 1人の間は承認 0(自分の PR は自分で承認できない)、👥 人が増えたら承認 1+CODEOWNERS の承認。危険度「高」を2人にするならチームを作って CODEOWNERS を書き換える。
- [ ] **ラベル**: `.github/labels.yml` の全部(`risk:high` / `risk:medium` / `risk:low` ほか)。セットアップが作る。
- [ ] **Environments**: `stg`・`prod`(prod に承認する人。🧍 1人の間は「Prevent self-review」をオフ)。
- [ ] **Actions の無料枠**: 🌐 公開なら上限なし(標準の実行環境)。🔒 非公開は Free で月 2,000分。このキットの CI は PR 1回で 20〜40分。止め方と見方は [guides/automation.md](guides/automation.md)。
- [ ] **お金のかかる自動のもの**は、いまは全部手動。使い始める日を [guides/automation.md](guides/automation.md) の表に入れる。

## ④ AWS を立てる

手順はルートの README の「本人が手でやる設定」の 2・3。ここでは**費用の目安**と**節約のしかた**。

### 月の費用の目安(東京リージョン・定価・1ドル=150円)

| 置き方 | 月の目安 | 一番大きいもの |
|---|---|---|
| 手元だけ(①〜③) | 0円 | — |
| stg だけ | 約2.2万〜2.7万円 | NAT(1つ 月 約7千円)・Aurora・ALB・Fargate(API と画面で2つ) |
| 本番(prod) | 約5.3万〜7.3万円 | NAT(AZ ごとに2つ)・Aurora 2台・Fargate(API 2つ+画面 2つ) |
| 試作の置き場所(`envs/preview/prototypes`) | 0〜数十円 | CloudFront・S3(無料枠の中がほとんど)。[guides/prototypes.md](guides/prototypes.md) |
| PR ごとの環境の土台 | 約1.2万円 | NAT・ALB |
| ┗ PR 1本を24時間立てる | +月 約1,200円 | Fargate Spot(DB・API・画面を1つのタスクに) |
| 全部(stg+本番+プレビュー) | 約9.5万〜11.5万円 | NAT が合わせて4つ |

- Aurora の東京の単価は**推定**(公式の料金表で確かめていない)。実際は使い方で2〜3倍ぶれる。
- WAF・GuardDuty・Security Hub は、上に加えて合わせて 月 約3千〜5千円(量で変わる。[security.md](security.md))。
- 費用の警報(AWS Budgets)は Terraform が作る(`monthly_budget_usd`。既定は stg 250ドル・prod 600ドル): 使った額が 80% のときと、月末の見込みが 100% を超えるときに Slack へ。アラームと合わせて [guides/monitoring.md](guides/monitoring.md)。
- 見張り(アラーム 15〜20個)は1環境 月 約300〜450円。
- API と画面は**混んだときに台数が増える**(自動調整。[guides/monitoring.md](guides/monitoring.md))。上の表は最小の台数のとき。上限まで1か月ずっと増えたままなら、本番は +約3.4万円(API 4台 約2.7万円+画面 4台 約6,800円)、stg は +約5,100円。ふだんは増えない。

### PMF の前の節約

| やること | 効き目 | 気をつけること |
|---|---|---|
| 本番の NAT を1つに(`single_nat_gateway = true`) | 月 約7千円 | 1つの AZ の障害で外に出られなくなる |
| 本番の Aurora を1台に(`instance_count = 1`) | 本番が 約3万〜4万円に | 予備が無いので、障害のとき戻るまで数分かかる |
| PR が無い間は、プレビューの土台ごと壊す(`envs/preview/base` を destroy) | 月 約1.2万円 | 使うときに立て直す(30分ほど) |
| stg の Aurora を使わない間は 0 まで縮める(`min_acu = 0`。設定済み) | 夜と休日の分 | 最初のアクセスが数十秒遅い |
| ログを14日で消す | 量に比例 | 調べものは14日以内に |

**AI の席(Claude Code)は削らない**。PMF 前に一番速さをくれるのはそこ。

## ⑤ Slack から頼めるようにする

[guides/slack.md](guides/slack.md)。おすすめは「Slack のフォーム → Issue」で始めて、Team / Enterprise なら Claude Tag に進む。

## ⑥ 毎週の運用

[playbook.md](playbook.md) の「毎週やること」。30分で:

- [ ] ラインの振り返り(AI が同じ失敗をした所 → ルール・テスト・lint・スキルに)
- [ ] Renovate の PR(低はまとめてマージ)
- [ ] `/release-notes` でリリースノートの下書き
- [ ] 来週 AI に渡せる「承認済みの仕様」があるか
- [ ] AWS の費用(Cost Explorer)と Actions の使った分数

困ったときの手順は [runbooks/](runbooks/)。docs 全体の地図は [README.md](README.md)。
