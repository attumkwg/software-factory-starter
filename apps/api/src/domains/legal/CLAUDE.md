# 領域: 規約と同意(legal)

> この領域の作業をする AI 向けの1枚。言葉・状態・守るルールの正は [docs/domain/legal/README.md](../../../../../docs/domain/legal/README.md)。ルートと `apps/api/CLAUDE.md` の決まりはそのまま効く。
> 持ち主: (人数が増えたら CODEOWNERS のチーム)。1つの Issue で触るのは、この領域だけにする。
> **規約の文面・何を同意し直しにするかは、法務の確認を経て人が決める**(`docs/guides/legal-documents.md`)。AI は版の行と本文のファイルを用意するまで。

## 触ってよい所

- `apps/api/src/domains/legal/`
- 版の一覧と本文: `packages/shared/src/legal.ts`(`LEGAL_VERSIONS`)・`apps/web/src/legal/<文書>/v<版>.md`(**公開した版のファイルは書き換えない**。新しい版を足す)
- 画面: `apps/web/src/pages/` の `LegalAcceptPage`・`LegalDocumentPage`・`LegalNotices`
- 資料: `docs/domain/legal/README.md`・`docs/db/legal.*.md`(`pnpm docs:db`)

## 触らない所(触るなら別の Issue か、人に聞く)

- ほかの領域のフォルダ。使ってよいのは organizations の `index.ts` だけ(`../dependencies.ts`)
- 同意待ちの関所(`src/authz/middleware.ts`)・登録の同意(`src/auth/sign-up-consent.ts`)は**危険度「高」**(人の確認)
- 同意の記録を書き換える・消す SQL(足すだけ。消すのは解約のコマンドだけ)
- お知らせのメールを API や画面から送れるようにする(運営のコマンド `legal-notify` だけ)

## 先に読む

- `docs/domain/legal/README.md`・`docs/guides/legal-documents.md`
- 仕様: `docs/specs/0009-legal-consent.md`・ADR 0022
- 権限の表: `docs/authz/matrix.yaml` の `/api/legal/consents`

## 外との出入り

- ほかへ出している物(`index.ts`): `legalRoutes`・`findAcceptedVersions`(関所が使う)・`recordConsents`・`addNotices`・`legalChangeMail`・`exportLegalConsentsPage`(書き出し)
- 外へ知らせる出来事: `legal.change_notified`(運営のコマンドが積む)
- 監査ログ: `legal.consent`

## 流すテスト

- 単体: `pnpm --filter @app/api test`(`legal`・`domain-boundaries`)と `pnpm --filter @app/shared test`(版の並び・30日)
- 結合(Docker): `pnpm --filter @app/api test:integration -- legal-consent legal-notify`
- いつも: `tenant-isolation`・`authz-matrix`・`rls`
