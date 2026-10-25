# 領域: 集客(growth)

> 公開の LP(`apps/site`)の事前登録と、来た所ごとの数を持つ領域(docs/specs/0025-public-landing-page.md・ADR 0038)。
> 持ち主は**運営の組織**(`SUPPORT_TENANT_ID`)。お客さんの組織のデータではない。

## エンティティ

| もの | 置き場所 | 持っていること |
|---|---|---|
| 事前登録 | `growth.pre_registrations` | 会社名・メールアドレス・会社の規模の幅・来た所(UTM)・どのページで・同意した文の版とプライバシーポリシーの版・状態・消す日 |
| 日ごとの数 | `growth.lp_daily_counts` | 日(日本時間)・ページ・来た所ごとの見た数・登録の数・確認の数(個人の行は持たない) |
| 同意の文 | `@app/shared` の `PRE_REGISTRATION_CONSENTS` | 版・文(何に使うか・いつ消すか・どこで消せるか)・チェックの文 |

## 状態

- 事前登録: **確認待ち**(`pending`。送った)→ **確認済み**(`confirmed`。確認のメールのリンクを開いた)→ **組織にした**(`converted`。組織を作るコマンドに渡した)。戻らない。
- 取り消し(本人のメールのリンク・運営のコマンド)は、どの状態からでも**行を消す**(止める一覧も残さない)。
- 消す日(`delete_after`): 確認待ちは登録から7日・確認済みは登録から1年・組織にしてから30日(`PRE_REGISTRATION_RETENTION_DAYS`)。過ぎたら `pre-registrations-purge` が消す。

## 守るルール

1. **テナントはリクエストから決めない**。公開の入口(`/api/public/*`)は設定の運営の組織に固定する。公開の LP の URL(`PUBLIC_SITE_URL`)か運営の組織が無ければ、公開の入口は全部 404。
2. 同意のチェックが無い・古い同意の文の版からの登録は受けない(400)。
3. 登録の有無を漏らさない: 同じアドレスでも、罠の欄に値があっても、同じ答え(204)。
4. 確認のメールは同じアドレスへ24時間に1通。確認のリンクは7日で切れる。確認するまで案内を送らない・組織にできない。
5. 確認・取り消しのリンクは「登録の ID.署名」(HMAC。DB に持たない)。公開のページの URL の `#` の後ろに載せる(サーバーのログに残らない)。取り消しは GET では消さない(メールの道具の先読みで消えないように)。
6. UTM は英数と `-_.` だけ・100文字まで。外れた値は空にする。見た数は Cookie も端末の ID も使わない。
7. 一覧を返す API は作らない。数・率は運営のコマンドだけ。メールアドレス・会社名は出さない(AI に渡すのは数と率まで。AI-6)。
8. 集める項目は会社名・メールアドレス・会社の規模の幅だけ(自由記述は置かない)。

## 他の領域との境目

| 相手 | 渡すもの | 受け取るもの |
|---|---|---|
| organizations | — | 運営の組織(外部キー) |
| 組織を作るコマンド(G-01 の `create-tenant`) | 確認済みの登録(`loadPreRegistrationForTenant` → 組織の名前の案・最初の管理者のメールアドレス) | 作った組織の ID(`markPreRegistrationConverted`) |
| アウトボックス・メール | 出来事 `growth.pre_registration_received`(登録の ID だけ) | — |

## 関係するファイル

- `packages/shared/src/pre-registration.ts`(同意の文・保存期間・入力の形・UTM の整え方)
- `apps/api/src/domains/growth/`(Postgres のスキーマ `growth`。`repository.ts` = 公開の入口の読み書き・`operator.ts` = 運営のコマンドと組織へのつなぎの読み書き・`links.ts` = リンクの署名)
- `apps/api/src/pre-registrations/`(運営の組織の文脈を開く所: `routes.ts` = 公開の入口・`command.ts` = 運営のコマンド。領域の中では接続プールに触らない決まり = Semgrep の `tenant-scoped-db-only`)
- `docs/guides/landing-page.md`(LP の決まり)・`docs/runbooks/pre-registrations.md`(運営のコマンド)
- `docs/db/growth.pre_registrations.md`・`docs/db/growth.lp_daily_counts.md`(表の説明書)

## これから決めること

- 提供開始の案内・試しの利用の招待を、確認済みの人に送るコマンド(いまは無い)
- 期限で消す仕事を、人が打つコマンドから定期の仕事にする(いまは週1回、人が打つ)
