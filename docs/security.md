# セキュリティ: 何を確かめていて、何を確かめていないか

> 自動の検査は「型どおりの穴」まで。**他社のデータが見える・業務の手順の抜け道**は、権限の表のテストと人の診断で見る。
> 見つかった穴は必ず「再現するテスト+同じ形を止めるルール」にして、二度と出さない。

このページの前半は **決まり**(なぜそう作るか)、後半は **確かめ方**(何を確かめていて、何を確かめていないか)。

- 決まりには番号がある(`AI-1`・`AZ-1`・`L-1`・`T-1`・`V-1`・`D-1`)。コード・ADR・仕様・Semgrep のルールは「`docs/security.md の T-6`」の形で引く。**番号は動かさない・使い回さない**(やめた決まりは「廃止」と書いて残す)。引いた番号がこのページに無いと CI が落ちる(`pnpm self-contained`)。
- 考え方の全体(7工程・段階・人と AI の分担)は [concepts/](concepts/README.md)。

## 決まり 1: AI ならではの守り(AI-1〜AI-6)

AI エージェントが PR を出す前提なので、従来の守りに加えてこの6つ。

| 番号 | 決まり | このキットのどこ |
|---|---|---|
| AI-1 | **AI は本番に入れない**。本番の鍵・本番の DB・本番に届く MCP を AI の環境に置かない。読み取りも dev・stg まで | `CLAUDE.md` の「してはいけない」・OIDC の役割(下の「GitHub Actions から AWS へ」)・`docs/runbooks/` のコマンドは人に渡す |
| AI-2 | **AI の環境から外に出られる先を絞る**(パッケージの取得先・GitHub・モデルの API だけ) | | あり([guides/unattended-ai.md](guides/unattended-ai.md)・[設計書 0057](designs/0057-ai-egress.md)・ADR [0068](adr/0068-ai-egress-by-where-it-runs.md)・[0069](adr/0069-background-ai-runs-integration-tests.md))。人が見ていない作業は ① 許可リストのプロキシと firewall で絞った devcontainer(`.devcontainer/egress/`。中の Docker で結合テスト・E2E が回る)か ② Web を読む道具と GitHub 以外の MCP を持たない背景の AI(`claude.yml`)でだけ回す。CI と背景の AI の結合テスト・E2E のコンテナは外へ出られない(`.github/scripts/block-container-egress.sh`)。外へ向けた操作は記録し(`.claude/hooks/record-outbound.mjs`)、PR の「🚪 外へ出した物」に並べる。手元のそのままの環境(devcontainer の外)は OS では絞らない |
| AI-3 | **Issue の文章は「データ」**。外の人が書いた Issue をそのまま AI に渡すと、中の指示に従ってしまう(プロンプトインジェクション)。**AI を起動できるのは組織のメンバーだけ**。**AI に読ませる Issue・PR の書き手も、書き込める人だけ**。AI が外へ書く文章(コメント・PR の本文)に秘密を出さない | `.github/workflows/claude.yml`(起動できるのはリポジトリの持ち主 OWNER だけ・前の段 `authors` が頼まれた Issue・PR の本文・コメント・レビューの書き手を確かめる `.github/scripts/ai-input-authors.mjs`・Bash などから API キーを消す `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`・後ろの段 `output-secrets` が書かれた文章を gitleaks で見る)・外へ書く文章の秘密の形を止めるフック `.claude/hooks/guard-secrets-out.mjs`([設計書 0060](designs/0060-background-ai-inputs.md)) |
| AI-4 | **自分で頼んだ AI の PR を、自分で承認できない**ようにする(PR は頼んだ人の名前で作る)。**設計書の未確定事項の「承認」も、人が GitHub に書いた答えを指す**(AI は人の答えを書けない) | フック(`docs/guides/local-guards.md`)・GitHub のルールセット・必須のチェック「未確定事項の答えの出どころ」(`scripts/decision-evidence.mjs`・[設計書 0061](designs/0061-decision-evidence.md))。1人の間は自分の承認も可にしている([guides/manual-setup.md](guides/manual-setup.md) の 1) |
| AI-5 | **AI に CI の設定・CODEOWNERS・ブランチ保護・検査の除外を変えさせない**(変えるなら危険度「高」で人が見る) | `.claude/hooks/protected-paths.json`・編集と Bash のフック(`guard-edit.mjs`・`guard-bash.mjs`。手元で外したら PR の `risk:high` と CODEOWNERS)・`pnpm guards` |
| AI-6 | **本番の個人データを AI に渡さない**。渡すのは ID と集計まで(区分の internal・public)。**要配慮(sensitive)は一切渡さない**。本番から出すのは人で、貼る前に人が見る | [compliance/ai-data.md](compliance/ai-data.md)(出どころごとの表)・委託先の台帳で AI の会社に personal・sensitive を書くと落ちる(`pnpm vendors`)・`CLAUDE.md` の「してはいけない」 |

## 決まり 2: 認可(AZ-1〜AZ-6)

認証(ログイン)は製品に任せる(このキットは Cognito)。**認可は自作になるので、仕組みで守る。**

| 番号 | 決まり | このキットのどこ |
|---|---|---|
| AZ-1 | **既定は拒否**。権限を書いていない API は誰も呼べない | `apps/api/src/authz/policy.ts`(`ROUTE_RULES` に無い API は 403) |
| AZ-2 | **判断を1か所に集める**。各 API の中に `if (role === …)` を散らさない。API は「この操作にはこの権限が要る」と宣言するだけ | `policy.ts`・`middleware.ts`(認可の関所) |
| AZ-3 | **権限の表を人が読み、全 API で自動テスト**。AI が API を足すと、表に1行足さない限り CI が通らない。その1行が「誰に何を許すか」の判断なので、表の変更は危険度「高」 | `docs/authz/matrix.yaml`・`authz-coverage.test.ts`・`authz-matrix.int.test.ts` |
| AZ-4 | **他社のデータは 403 ではなく 404**(存在すること自体を漏らさない) | `matrix.yaml` の「他社」の列 |
| AZ-5 | **画面から来た ID を信じない**。テナント・利用者はログインのセッションから取る(T-1) | `src/auth/session.ts`・Semgrep の `tenant-from-request` |
| AZ-6 | **大事な操作は監査ログ**: 誰が・いつ・何を・許可か拒否か。権限の変更・データの書き出し・管理者と社員の操作は必ず | `apps/api/src/audit`([ADR 0013](adr/0013-audit-log.md)) |

## 決まり 3: テナント分離

> 1つのシステムに複数の会社(テナント)が同居する。**一番重い事故は「他社のデータが見える」**で、1件でも信用を失う。だから「書き忘れても漏れない」ように、層を重ねて守る。

### 分け方

| 型 | 中身 | 良い所 | 弱い所 |
|---|---|---|---|
| 共有(プール) | 全社が同じ表。行にテナント ID | 安い・運用が1つ・新しい会社をすぐ足せる | 書き忘れで漏れる・1社の重さが全体に響く |
| スキーマ分け | 1つの DB に会社ごとのスキーマ | ある程度分かれる | 会社が数千になると移行と運用が重い |
| 専用(サイロ) | 会社ごとに DB(や AWS アカウント) | 最も強く分かれる・個別の鍵や場所の要件に応えられる | 高い・会社ごとに運用が増える |

- **既定は「共有」+下の層(T-1〜T-9)で守る**。大企業・規制の重い業種・データの置き場所の指定がある顧客だけ「専用」にする([ADR 0001](adr/0001-shared-tables-with-rls.md))。
- **最初から「専用にも移せる」作り**にしておく: 全テーブルにテナント ID([concepts/stages.md の「最初の日に決めておく8つ」](concepts/stages.md#2-最初の日に決めておく8つ))。後から1社だけ切り出せる。

### どこから漏れるか(L-1〜L-9)

| 番号 | 場所 | 漏れ方 | 守る決まり |
|---|---|---|---|
| L-1 | API | 他社の ID を指定すると取れる(テナントで絞り忘れ) | T-1・T-2・T-3 |
| L-2 | キャッシュ | キーにテナントが無く、他社の結果が返る | T-4 |
| L-3 | 検索 | 検索の条件にテナントの絞り込みが無い | T-4 |
| L-4 | ファイル(S3) | 他社のファイルの URL を推測できる・期限の長い署名つき URL | T-4 |
| L-5 | 裏の処理(キュー・バッチ) | テナントの文脈を持たずに動き、全社分を処理する・混ぜる | T-4 |
| L-6 | 書き出し・分析・ログ | CSV や分析の表で他社の行が混ざる | T-2・T-3 |
| L-7 | サポート用の管理画面 | 社員が全社を見られて、操作の記録も無い | T-7 |
| L-8 | SSO・招待 | 他社の IdP から自社の利用者としてログインできる・メールのドメインを確かめずに参加させる | T-8 |
| L-9 | 1社の暴走 | 1社の大量のリクエストやバッチで、全社が遅くなる(うるさい隣人) | T-6 |

### 層を重ねて守る(T-1〜T-9)

| 番号 | 決まり | このキットのどこ |
|---|---|---|
| T-1 | **テナントはログインのセッションから決める**。リクエストの値(URL・本文・ヘッダー)で決めない。複数社に入る人は明示的に切り替え、1度に1社分だけ有効にする | `src/auth/session.ts`(署名つき Cookie)・`src/authz/middleware.ts`・Semgrep の `tenant-from-request` |
| T-2 | **アプリの入口でテナントの文脈を作り**、以後の読み書きはその文脈で自動で絞る部品(リポジトリ)を必ず通す。生の SQL・接続プールの直接の利用は検査で止める | `c.var.tx`・`src/domains/*/repository.ts`・Semgrep の `tenant-scoped-db-only`・`no-raw-sql` |
| T-3 | **DB の行レベルセキュリティ(RLS)を最後の砦に**。トランザクションごとに `SET LOCAL` でテナント ID を渡し、ポリシーで他社の行を返さない。アプリの接続ユーザーは**表の持ち主にしない**(持ち主は RLS をすり抜ける)・`FORCE ROW LEVEL SECURITY` | `src/db/tenant.ts`・`drizzle/0001_rls.sql`・`db/init/001-roles.sql` |
| T-4 | **キャッシュ・検索・ファイル・キューにもテナント**。キャッシュのキーと検索の条件にテナント ID・S3 はテナントごとの置き場所+テナントで絞った一時的な権限・キューのメッセージにテナント ID を載せ、受け取った側で文脈を作り直す | 送信待ち(アウトボックス)の出来事に `tenantId` を載せ、受け取った側で `withTenant`(`src/outbox/`)。キャッシュ・検索・ファイルは、足すときにこの決まりで |
| T-5 | **鍵を分ける(必要な顧客だけ)**。専用の顧客はテナントごとの KMS の鍵。契約が終わったら鍵を消せば、バックアップの中のデータも読めなくなる(暗号による消去) | 要配慮個人情報だけ一部あり: 組織ごとのデータ鍵を KMS の鍵1本で包み、列ごとに暗号化(`apps/api/src/sensitive/`・[ADR 0029](adr/0029-sensitive-data-tier1.md))。テナントごとの KMS の鍵は未(大きな顧客が付いたら。[runbooks/sensitive-data-tiers.md](runbooks/sensitive-data-tiers.md) の 4・[guides/data-retention.md](guides/data-retention.md)) |
| T-6 | **1社の暴走を止める**: テナントごとの流量の上限・バッチの同時実行の上限・クエリの時間切れ(`statement_timeout`)。重すぎる会社は専用へ | `src/db/client.ts`(クエリ5秒・止まったトランザクション10秒)・WAF の IP ごとの上限。テナントごとの流量の上限は PMF の後 |
| T-7 | **社員のアクセスは「代理ログイン」だけ**: お客さんの許可・時間制限つき・全部の操作を記録・お客さんからも見える監査ログ。全社を一覧できる管理画面を作らない | [ADR 0014](adr/0014-support-access.md)・[runbooks/support-access.md](runbooks/support-access.md) |
| T-8 | **SSO はドメインを確かめてから**: 会社のドメインを DNS で確かめてから、その IdP を有効にする。招待はリンクの期限と1回きり | 招待: 済(期限7日・1回きり・取り消し・署名つきの札。`invitations.int.test.ts`・ADR 0040)/ SSO: 済(DNS の TXT でドメインを確かめてから IdP をつなぐ・1ドメイン1組織。`organization-domains.int.test.ts`・`sso-login.int.test.ts`・`sso-required.int.test.ts`・ADR 0067・[runbooks/sso.md](runbooks/sso.md)) |
| T-9 | **始まりと終わり**: テナントの作成は自動にして設定の漏れを無くす。解約のときのデータの書き出しと削除(バックアップの保存期間も含めて)を手順にし、契約と合わせる | [ADR 0015](adr/0015-offboarding.md)・[runbooks/offboarding.md](runbooks/offboarding.md)・`TENANT_TABLES` |

### 漏れていないことを確かめる(V-1〜V-5)

| 番号 | 決まり | このキットのどこ |
|---|---|---|
| V-1 | **テストは必ず2社で**。テストのデータは常に「自社」と「他社」を作る。権限の表の全 API に「他社: 404」の行を入れて、毎 PR で叩く | `tenant-isolation.int.test.ts`・`rls.int.test.ts`・`authz-matrix.int.test.ts`・E2E の `tenant-isolation.spec.ts` |
| V-2 | **本番に「おとり」を置く**: 実在しない「おとりのテナント」に目印のデータを入れ、他社の応答・ログ・書き出しに目印が出たら即警報 | 未(PMF の後。数千社の規模から) |
| V-3 | **検査のルール**: 「テナントの文脈を通さないクエリ」「テナントの無いキャッシュのキー」「テナントの無い S3 のパス」を Semgrep で止める | `.semgrep/rules.yml`(いまはクエリまで。キャッシュ・S3 は足すときに) |
| V-4 | **外部の診断でも必ず頼む**: 2社分のアカウントを渡して、テナントをまたぐ攻撃を重点的に見てもらう(D-6) | 下の「外部の診断を頼むときの渡し物」 |
| V-5 | **テナント分離の部品(文脈・RLS・キャッシュのキー)を変える PR は危険度「高」**。AI が絞り込みを書き忘れても T-3 と V-1 で漏れないが、部品そのものは人が持つ | `.claude/hooks/protected-paths.json`(`apps/api/src/db/**` ほか) |

### 規模で変わること

| 規模 | やること |
|---|---|
| 〜数十社 | 共有+RLS+2社のテスト+代理ログイン。これで十分(このキットの既定) |
| 〜数千社 | テナントごとの流量の上限(T-6)・おとりのテナント(V-2)・テナント単位の監視(どこが重いか) |
| 大企業の顧客あり | 専用 DB や専用の鍵(T-5)の上位プラン・データの置き場所の要件・SOC 2 や ISMS で分離の仕組みを説明できる資料 |

## ログイン(Cognito)

> 決めた理由は [ADR 0007](adr/0007-cognito-login-server-side.md)・[ADR 0009](adr/0009-own-login-screens.md)。困ったときは [runbooks/cognito-login.md](runbooks/cognito-login.md)。

画面は自前、パスワードの保管・照合・確認コード・二段階認証は Cognito。**トークンはサーバーの中だけ**: 画面 → API → Cognito の API で、API が ID トークンを確かめ、ブラウザには署名つきの HttpOnly Cookie だけを渡す。

| 守り | していること | 確かめているテスト |
|---|---|---|
| 登録の有無が分かる | ログインの失敗は全部同じ 401 と同じ文(パスワード違い・いない人・users にいない人)。登録・コードの再送・再設定は、いない人・登録済みの人にも同じ答え。Cognito も「いない」と言わない設定 | 結合「同じ 401 と同じ文」「同じ答え」・契約「同じ NotAuthorizedException」・E2E |
| パスワードの総当たり | Cognito が続けて間違えると止める・流量の上限(429 で返す) | 結合「続けて間違えると」・単体「429」 |
| 二段階認証を飛ばす | コードだけでは通らない(パスワードの後に出る札が要る)。札は HttpOnly・SameSite=Strict・3分・間違えたら1回で終わり | 結合「途中の札が無ければ 401」・契約「間違えた札では通らない」 |
| トークンを盗まれる | ブラウザの JS に出ない(本文にも Cookie にも storage にも無い) | 結合「本文にトークンが出ない」・E2E |
| 偽のトークン | 署名・発行元・宛先・種類(id)を確かめる | 単体「ID トークンの確かめ方」 |
| 他人の行に結びつく | 確認済みのメールだけ。結びつけは「まだ空の行」に1回だけ(DB の関数とポリシー)。Cognito はメールを変えても確認するまで古いまま。管理の操作で確認しただけの人は結びつかない | 結合「管理の操作で確認されただけの人」・契約「管理の確認ではメールは確認済みにならない」 |
| パスワード・コードが漏れる | ログに出さない(Cognito の失敗は例外の名前だけ残す) | 結合「ログの中に、パスワード・メール・確認コード・トークンが出ない」 |
| よそのサイトへ飛ばす | ログインの後の戻り先はアプリの中のパスだけ(`safeReturnTo`) | 単体「戻り先」 |
| 偽物の Cognito を本番で | 入口を変える設定(`COGNITO_ENDPOINT`)は local / test だけ | 単体(設定) |
| 共有の PC で前の人の画面が見える | 画面の HTML は `Cache-Control: no-store`(ブラウザにも途中にも残さない)。HSTS は1年(http に落とさせない)。使わないブラウザの機能(カメラ・マイク・位置など)は Permissions-Policy で止める | 単体(`apps/web/server/app.test.ts`) |
| 差し込まれたスクリプトが動く(XSS)・よそのサイトに枠で埋め込まれる | 画面の全部の応答に CSP。スクリプトとスタイルは自分の origin と、1リクエストごとの nonce の付いた埋め込みだけ(SSR が埋め込む物には TanStack が付ける)。`eval` の類・`object`・`base` を止め、枠への埋め込みは `frame-ancestors 'none'`。外へ送るのは Sentry の origin だけ。部品が描く style 属性だけは許す([設計書 0045](designs/0045-web-csp.md)) | 単体(`apps/web/server/app.test.ts`)・E2E `csp.spec.ts`(主な画面で違反が無い・nonce の無い埋め込みが止まる) |
| プレビュー・stg・ログインの後ろの画面が検索に載る | 画面のサーバーが全部の応答に `X-Robots-Tag: noindex, nofollow`(本番も既定は全部。外すのは本番で一覧に書いたパスだけ)。`robots.txt` は本番以外 `Disallow: /`。拡張子のあるパスの探り(`/wp-login.php` など)は SSR に回さずに 404 | 単体(`apps/web/server/app.test.ts`)・E2E `not-found.spec.ts` |
| 偽物が本物とずれる | 同じ契約テストを、偽物には PR ごと・stg の本物には手動で(有効にすると週1回)。落ちたら Issue | `cognito-contract.yml` |

- 済み: 二段階認証の設定の画面と、組織ごとに全員へ二段階認証を必須にする設定(仕様 0006・部品 `mfa-required`・`mfa-requirement.int.test.ts`)。
- 次の一歩: こちら側の流量の上限(IP ごと)・Cognito の不正対策(Plus)・パスキー。

## 毎回の検査(PR ごと・自動)

| 検査 | 実際にしていること | 見つけられないもの | どこ |
|---|---|---|---|
| 権限の表 ① | OpenAPI の全 API が `docs/authz/matrix.yaml` にあるか | 表そのものの誤り(人が見る) | `ci.yml` 単体 |
| 権限の表 ② | 表の全行を admin・member・viewer・他社・未ログインで実際に叩く | 表に無い組み合わせ(自分の物だけ、など) | `ci.yml` 結合 |
| 列の分類 | DB の全部の列(drizzle と本物の DB)に区分と目的があるか・要配慮(`sensitive`)がスキーマ `sensitive` の外に無いか・監査ログと出来事の中身に個人情報のキーが無いか(`apps/api/src/db/classification.ts`。ADR 0018) | 区分そのものの誤り(人が見る) | `ci.yml` 単体・結合 |
| ログの個人情報 | 全部の API を目印つきの値(名前・電話・病名に見立てた文・メール)で叩き、ログの全行に目印が無いか。送信待ちの失敗の文も(`personal-data-logs.int.test.ts`。ADR 0019) | 目印の形に無い個人情報・テストで通らない道すじ | `ci.yml` 結合 |
| RLS と2社 | 全テーブルの RLS・接続ユーザーが持ち主でないか・2社が混ざらないか | RLS の外(キャッシュ・ファイル・ログ) | `ci.yml` 結合 |
| Semgrep | 公開のルール+自社ルール(テナントの文脈・生の SQL・ログ・本文の検証・画面の色) | ルールに書いていない形の穴 | `ci.yml` |
| gitleaks | 全履歴から秘密の値らしいもの | 形の決まっていない秘密・暗号化された秘密 | `ci.yml` |
| Trivy | 依存とイメージの既知の脆弱性(HIGH 以上)・Dockerfile と Terraform の設定 | まだ知られていない脆弱性・自分のコードの穴・中以下・「うちに届くか」(→ 下の `/cve`) | `ci.yml`・`terraform.yml`・`vuln-scan.yml`(毎週月曜に最新の DB で。zizmor のオンライン版も。落ちたら Issue) |
| squawk | 移行の、本番を止める書き方 | 移行の中身の正しさ(データが合っているか) | `ci.yml` |
| axe | 画面のアクセシビリティ(色・ラベル・名前・押す所の大きさ。WCAG 2.2 AA まで)と、スマホの幅(320px)で横にはみ出さないか | キーボードだけで最後まで使えるか・iPhone(WebKit)での見え方 | `ci.yml` E2E |
| 委託先の台帳 | package.json の外のサービスの SDK・Terraform の提供者と AWS のサービス(資源の種類)・Actions の `uses:` が台帳(`docs/compliance/vendors.yaml`)にあるか・区分が列の分類表の言葉か・AI の会社に personal・sensitive が無いか(`pnpm vendors`。ADR 0030) | 台帳の名前の一覧に無い SDK・`fetch` で直接呼ぶ外の API・CI で使うコンテナのイメージ・台帳の中身の誤り(人が見る) | `ci.yml` |
| actionlint・zizmor | ワークフローの書き方と危ない設定(権限・資格情報・トリガー) | 動かしたときの中身 | `ci.yml` |

## 手で回す検査(いまは手動。お金と負荷があるため)

| 検査 | 実際にしていること | 見つけられないもの | 回し方 |
|---|---|---|---|
| Schemathesis | OpenAPI から全 API に変な入力を作って、ロールごとに叩く。500・書いていない答え・形の違う応答を見つける | 意味の上の穴(他社が見える等) | `pnpm security:fuzz`(手元)・`security-fuzz.yml` |
| ZAP ベースライン | プレビューの画面を外から受け身で見る(ヘッダー・Cookie の設定など) | ログインの後ろ・API の中身 | `preview.yml` |
| ZAP API スキャン | stg にログインして、OpenAPI の全 API に攻撃の型を送る | 複数の手順をまたぐ攻撃・業務の穴 | `zap-api-scan.yml` |
| `/security-review` | Claude Code がブランチの変更を読み、認可漏れ・注入などを探す | 仕様に依存する業務の穴は苦手 | 下の「危険度『高』の PR で」 |
| `/cve`・`pnpm vulns` | Dependabot の通知・Trivy・OSV・基盤と主な依存の発表を集め、関係あるかを6段で精査し、期限つきの直し方を決める。記録と通知の突き合わせ | まだ発表されていない脆弱性・自分のコードの穴 | [guides/vulnerabilities.md](guides/vulnerabilities.md)(記録は [security/vulns.md](security/vulns.md)) |

### 例: Schemathesis が見つけた穴を、テストとルールにした

1. **見つけた**: 本文の無い `POST /api/projects` などが 500 になる(本文の検証が「本文があるときだけ」だった)。
2. **直した**: 本文を必須にする部品 `jsonBody` を作り、全部の API をそれに置き換えた(`apps/api/src/http/common.ts`)。
3. **再現のテスト**: `apps/api/test/integration/input-validation.int.test.ts`(本文が無い → 400、JSON でない → 415)。
4. **同じ形を止めるルール**: Semgrep の `request-body-must-use-jsonbody`(`jsonBody` を使わずに本文を書いたら止まる)。

## 見張り(AWS の中・常に)

| もの | していること | 費用の目安 | どこ |
|---|---|---|---|
| WAF | CloudFront の前(置かない形では ALB の前)で型どおりの攻撃・悪い IP・1つの IP からの大量のリクエストを止める | 月 約1,500〜2,000円 | `infra/terraform/modules/waf` |
| アプリの前の CloudFront | ALB を CloudFront の送り元の一覧と秘密のヘッダーでしか受けない。いまの人の IP のヘッダーを偽れない(組織ごとの IP の制限) | 無料枠の中なら 0 円・Secrets Manager 月 $0.40 | `infra/terraform/modules/app-front`・[ADR 0070](adr/0070-cloudfront-in-front-of-alb.md) |
| GuardDuty | 怪しい動き(漏れた鍵の利用・不審な通信)を見つける | 月 数百〜千数百円 | `modules/security-baseline` |
| Security Hub | AWS の設定を決まりの一覧で採点する | 月 数百〜千数百円 | `modules/security-baseline` |
| CloudTrail | AWS の管理操作(誰が・いつ・どの API)を、ロックした S3(governance・400日。外す権限は方針で全員に拒否)と CloudWatch Logs に残す。root の利用・記録を止める操作・記録のバケットで消す/方針を変える操作で鳴らす | 月 数百円 | `modules/audit-trail`・[runbooks/audit-trail.md](runbooks/audit-trail.md) |

WAF は最初「数えるだけ(count)」で入れ、誤検知が無いのを確かめてから「止める(block)」にする。

## GitHub Actions から AWS へ(OIDC の役割)

PR のジョブは **PR の版のワークフロー**で動く(ブランチを作れる人や AI が書き換えられる)。だから「PR から引ける役割」で届くものは、PR を出せる人なら誰でも触れる、と考えて決める。

| 役割 | 引ける所 | 届くもの | 決めた理由 |
|---|---|---|---|
| prod の plan | **main だけ** | 本番の設定を読む・状態ファイル | 状態ファイルに本番の秘密の値が入る。PR から引けると本番の秘密が読める |
| stg の plan | PR と main | stg の設定を読む・状態ファイル | stg は試しのデータだけで、アカウントも別。PR の plan はここで見る |
| prod / stg のデプロイ | environment: prod / stg のジョブ | タスク定義の登録・サービスの更新 | prod は承認のあとだけ |
| プレビュー | PR と main(毎晩の掃除) | dev アカウントの `preview-pr-*` の物だけ | 名前で絞り、ECS Exec・タスクの起動・ほかの秘密は渡さない |

plan の役割は AWS の `ReadOnlyAccess` に、**中身を読む操作の明示の拒否**を重ねている(`modules/github-oidc` の `deny_data_reads`): ログの本文・S3 の物(状態ファイルのほか)・Cognito の利用者・DB のログ・イメージの中身・管理操作の記録(CloudTrail)など。設定(どんな資源がどう置かれているか)だけが読める。

## 深い診断の段取り(D-1〜D-6)

自動のスキャンで見つかるのは「型どおりの穴」まで。実際の事故が多い**他社・他人のデータが見える(IDOR・BOLA)・権限の昇格・手順の飛ばし・二重送信・桁外れの値**は見つからない。だから「何を確かめるか」を先に決めて、段を重ねる。**D-1 が無いと D-2〜D-6 は「何となく叩く」になる。**

| 段 | 何をする | このキットのどこ | いつ |
|---|---|---|---|
| D-1 脅威の洗い出し | 機能ごとに「誰が・どう悪用しうるか」を書く(STRIDE) | `docs/specs/_template.md` の「悪用のされ方」・`/new-feature` | 仕様の段 |
| D-2 権限の表の自動テスト | 全 API × 全ロール × 他社 | `docs/authz/matrix.yaml`・結合テスト | 毎 PR |
| D-3 自社専用の検査ルール | 見つけた穴の形を止める | `.semgrep/` | 毎 PR |
| D-4 複数ユーザーの動的診断 | ログインした状態で全 API を叩く | Schemathesis(ロールごと)・ZAP API スキャン | 週1〜毎晩(手動から) |
| D-5 AI の診断 | コードを読んで仮説を立てる | `/security-review`(下) | 危険度「高」の PR・月1 |
| D-6 人の専門家 | ソースと仕様を渡した診断 | 下の「外部の診断を頼むとき」 | 公開の前・年1回 |

## 危険度「高」の PR で: `/security-review` を手で回す

認証・認可・権限の表・移行・infra を変えた PR(ラベル `risk:high`)では、マージの前に1回。

1. その PR のブランチを手元に取る: `gh pr checkout <番号>`
2. Claude Code で `/security-review` と打つ(ブランチの変更を読んで、穴の候補を挙げる)。
3. 出てきた候補を1つずつ見る。本物なら PR で直し、**再現するテスト**を足す。誤検知なら理由を PR に書く。
4. 結果を PR の「人に判断してほしい所」に1〜3行で書く(「`/security-review`: 指摘なし」も書く)。

> 🤖 AI の診断は、コードから分かる問題(認可の漏れ・注入・秘密の扱い)は得意。**仕様に依存する業務の穴は苦手**。最後は人が見る。

## 外部の診断を頼むときの渡し物

| 渡すもの | 中身 |
|---|---|
| 仕様と権限の表 | `docs/specs/`・`docs/authz/matrix.yaml`・`docs/domain/` |
| 設計 | `docs/adr/`(特に 0001 テナント分離)・`docs/db/`(表の説明書) |
| API の定義 | `pnpm openapi` で作る `apps/api/openapi.json` |
| 診断用の環境 | stg か、診断専用の環境。**2社分**のアカウント(各ロール)を渡す。本物の個人データは入れない |
| 重点 | 「他社のデータが見えないか」「ロールを越えられないか」「手順を飛ばせないか」 |
| すでにしていること | このページの上の表(機械で見つかるものは先に潰してある、と伝える) |

診断の結果の穴は、上の「例」と同じく、テスト+ルールにしてから閉じる。
