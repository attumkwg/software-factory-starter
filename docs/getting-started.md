# 使い始めの手引き

> このキットを「自分のプロダクトの土台」として使えるようになるまでの順番。
> ①〜③はお金がかからない。④から AWS の費用がかかる。急がず、①②で十分に慣れてから進めてよい。

| # | やること | かかる時間の目安 | お金 |
|---|---|---|---|
| ① | 手元で動かす | 30分 | 0円 |
| ② | 自分のプロダクトに置き換える | 数日〜(最初の機能まで) | 0円 |
| ③ | GitHub の設定 | 1時間 | 0円(Actions の無料枠の中) |
| ④ | AWS を立てる | 1〜2日 | 月 約2万円〜(下の表) |
| ⑤ | Slack から頼めるようにする | 半日〜 | 案による |
| ⑥ | 毎週の運用 | 毎週30分 | — |

---

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

http://localhost:3000 を開き、`admin@acme.test` でログインする(パスワードなし。開発用のログイン)。

確かめること:

- [ ] `pnpm test`(単体)と `pnpm test:integration`(本物の Postgres)が通る
- [ ] `pnpm test:e2e`(画面の E2E。`docker compose up` のあと)が通る
- [ ] `admin@globex.test` でログインすると、Acme のプロジェクトが見えない(組織が分かれている)
- [ ] Claude Code でこのフォルダを開き、`/new-feature` で「タスクに期限を付けたい」と頼んでみる(OK と言うまで何も作られない)

## ② 自分のプロダクトに置き換える

TODO アプリは「ラインを見せるための題材」。**ラインは残し、題材を差し替える**。

| 残す(ライン) | 差し替える(題材) |
|---|---|
| `apps/api/src/app.ts`・`authz/middleware.ts`・`auth/`・`db/tenant.ts`・`db/client.ts`・ログ・設定 | `apps/api/src/routes/`・`repositories/` の projects と tasks |
| `drizzle/0001_rls.sql` の形(新しい表にも同じ形で RLS) | `db/schema.ts` の projects と tasks・`drizzle/0000_init.sql` |
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

ルートの README の「本人が手でやる設定」の 1 を順に。要点:

- [ ] **ブランチ保護(main)**: PR 必須・CI のチェック必須・CODEOWNERS の承認。危険度「高」を2人にするならチームを作って CODEOWNERS を書き換える。
- [ ] **ラベル**: `risk:high` / `risk:medium` / `risk:low` ほか。
- [ ] **Environments**: `stg`・`prod`(prod に承認する人)。
- [ ] **Actions の無料枠**: 非公開のリポジトリは Free で月 2,000分。このキットの CI は PR 1回で 20〜40分。止め方と見方は [guides/automation.md](guides/automation.md)。
- [ ] **お金のかかる自動のもの**は、いまは全部手動。使い始める日を [guides/automation.md](guides/automation.md) の表に入れる。

## ④ AWS を立てる

手順はルートの README の「本人が手でやる設定」の 2・3。ここでは**費用の目安**と**節約のしかた**。

### 月の費用の目安(東京リージョン・定価・1ドル=150円)

| 置き方 | 月の目安 | 一番大きいもの |
|---|---|---|
| 手元だけ(①〜③) | 0円 | — |
| stg だけ | 約2万〜2.5万円 | NAT(1つ 月 約7千円)・Aurora・ALB |
| 本番(prod) | 約5万〜7万円 | NAT(AZ ごとに2つ)・Aurora 2台・Fargate 2つ |
| PR ごとの環境の土台 | 約1.2万円 | NAT・ALB |
| ┗ PR 1本を24時間立てる | +月 約1,000円 | Fargate Spot |
| 全部(stg+本番+プレビュー) | 約9万〜11万円 | NAT が合わせて4つ |

- Aurora の東京の単価は**推定**(公式の料金表で確かめていない)。実際は使い方で2〜3倍ぶれる。
- WAF・GuardDuty・Security Hub は、上に加えて合わせて 月 約3千〜5千円(量で変わる。[security.md](security.md))。
- 費用の警報(AWS Budgets)を最初に作る: 月の上限の 80% と 100% でメール。

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
