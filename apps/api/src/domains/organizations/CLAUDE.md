# 領域: 組織(organizations)

> この領域の作業をする AI 向けの1枚。言葉・状態・守るルールの正は [docs/domain/organizations/README.md](../../../../../docs/domain/organizations/README.md)。ルートと `apps/api/CLAUDE.md` の決まりはそのまま効く。
> 持ち主: (人数が増えたら CODEOWNERS のチーム)。1つの Issue で触るのは、この領域だけにする。
> **ほかの全部の領域がここを使う**(土台)。`index.ts` から出している関数の形を変えると、ほかの領域が落ちる。足すのはよい・変える・消すのは使う側も一緒に直す。

## 触ってよい所

- `apps/api/src/domains/organizations/`(組織・利用者・アカウント・招待・二段階認証の必須・サポートの許可・会社のドメイン・IP の範囲・組織の人を止める・戻す・ロール・強制ログアウト)
- 画面: `apps/web/src/pages/` の `AccountPage`・`SettingsPage`・`InvitationsPage`・`InvitationAcceptPage`・`SupportGrantsPage`・`SupportStaffPage`・`MembersPage`(と `account/`・`settings/`)
- 契約: `packages/shared` の組織・アカウント・招待のスキーマ(足すだけ)
- 資料: `docs/domain/organizations/README.md`・`docs/db/organizations.*.md`(`pnpm docs:db`)

## 触らない所(触るなら別の Issue か、人に聞く)

- ほかの領域のフォルダ。この領域はどこも使わない(`../dependencies.ts` で空)。ほかの領域を import しない
- ログイン・セッション(`src/auth/`)・認可の関所(`src/authz/`)・DB の部品(`src/db/`)は**危険度「高」**(人の確認)。アカウントの仕事でも、そこを直すなら Issue を分けて人に聞く
- サポートの代理ログインの関所(運営の組織か・期限)の決まりを緩める変更(docs/security.md の T-7)

## 先に読む

- `docs/domain/organizations/README.md`(社員がお客さんの組織に入れるのは代理ログインだけ・二段階認証の必須)
- 仕様: `docs/specs/0004-support-access.md`・`0006-account-security.md`・`0026-tenant-provisioning.md`・`0027-invitations.md`・`0056-sso-scim-ip-audit-export.md`・`0079-member-admin.md`
- 権限の表: `docs/authz/matrix.yaml` の `/api/me`・`/api/account*`・`/api/invitations*`・`/api/organization/*`・`/api/support*`

## 外との出入り

- ほかへ出している物(`index.ts`): `findAccess`・`findRole`・`findTimeZone`・`findContact`・`listUserIds` などの読む関数、アカウントと招待の操作、書き出し(`exportOrganization`・`exportUsersPage`)
- 外へ知らせる出来事: `organizations.email_changed`・`invitation_created`・`mfa_enabled`・`mfa_disabled`・`password_changed`・`tenant_opened`
- 監査ログ: `account.*`・`invitation.*`・`organization.mfa_*`・`support*`・`tenant.create`・`domain.*`・`ip_allowlist.update`・`member.sign_out`・`member.role_change`・`member.disable`・`member.enable`

## 流すテスト

- 単体: `pnpm --filter @app/api test`(`domain-boundaries`・`support`・`session` を含む)
- 結合(Docker): `pnpm --filter @app/api test:integration -- account-security invitations mfa-requirement support-access tenant-provisioning organization-domains ip-allowlist members`
- いつも: `tenant-isolation`・`authz-matrix`・`rls`
