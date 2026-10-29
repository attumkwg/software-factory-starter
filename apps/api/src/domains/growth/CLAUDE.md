# 領域: 集客(growth)

> この領域の作業をする AI 向けの1枚。言葉・状態・守るルールの正は [docs/domain/growth/README.md](../../../../../docs/domain/growth/README.md)。ルートと `apps/api/CLAUDE.md` の決まりはそのまま効く。
> 持ち主: (人数が増えたら CODEOWNERS のチーム)。1つの Issue で触るのは、この領域だけにする。
> 表は**運営の組織の持ち物**(お客さんの組織のデータではない)。この領域には `routes.ts` が無い(組織の中の人が使う API は作らない)。

## 触ってよい所

- `apps/api/src/domains/growth/`
- 運営の組織の文脈を開く所: `apps/api/src/pre-registrations/`(`routes.ts` = 公開の入口・`command.ts` = 運営のコマンド)
- 公開の LP: `apps/site/`(言葉は `src/content.ts`。決まりは `docs/guides/landing-page.md`)
- 契約: `packages/shared/src/pre-registration.ts`(同意の文・保存期間・入力の形。足すだけ)
- 資料: `docs/domain/growth/README.md`・`docs/db/growth.*.md`(`pnpm docs:db`)・`docs/runbooks/pre-registrations.md`

## 触らない所(触るなら別の Issue か、人に聞く)

- ほかの領域のフォルダ。使ってよいのは organizations の `index.ts` だけ(`../dependencies.ts`)
- この領域の中で接続プールに触る(運営の組織の `withTenant` は `src/pre-registrations/` が開く。Semgrep の `tenant-scoped-db-only`)
- 公開の入口のテナントをリクエストから決める(設定の運営の組織に固定)・一覧を返す API を足す
- 同意の文の版(`PRE_REGISTRATION_CONSENTS`)を書き換える(新しい版を足す)・向きを足す(`../dependencies.ts`)

## 先に読む

- `docs/domain/growth/README.md`(テナントを決めない・登録の有無を漏らさない・数と率だけ)
- 仕様: `docs/specs/0025-public-landing-page.md`・ADR 0038
- 権限の表: `docs/authz/matrix.yaml` の `/api/public/pre-registrations`・`/confirm`・`/withdraw`

## 外との出入り

- ほかへ出している物(`index.ts`): 公開の入口の読み書き(`registerPreRegistration`・`confirmPreRegistration`・`withdrawPreRegistration`・`countView`)・運営のコマンドと組織を作るコマンドの読み書き(`countsBySource`・`findByEmail`・`deleteByEmail`・`purgeExpired`・`loadPreRegistrationForTenant`・`markPreRegistrationConverted`)・確認のメール(`preRegistrationConfirmMail`)・`linkKey`・`tokyoDay`
- 外へ知らせる出来事: `growth.pre_registration_received`(登録の ID だけ)
- 監査ログ: `pre_registration.purged`・`pre_registration.deleted`・`pre_registration.converted`・`pre_registration.found`(運営の組織の監査ログ)

## 流すテスト

- 単体: `pnpm --filter @app/api test`(`growth-links`・`domain-boundaries`)と `pnpm --filter @app/site test`
- 結合(Docker): `pnpm --filter @app/api test:integration -- growth-public growth-commands tenant-commands`
- いつも: `tenant-isolation`・`authz-matrix`・`rls`
