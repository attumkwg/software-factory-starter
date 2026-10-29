# 仕様: 領域を足す手順(add-domain)の食い違いを直す

> 状態: 完了(実装済み)
> 穴 G-113(`docs/scenarios/gaps.md`)。2026-10-29 の穴の棚卸し(`docs/kit/verdicts/2026-10-29-gap-triage.md`)で「矛盾直しだけ」に絞った。領域の手順の元は [仕様 0050](0050-domain-claude-md.md)・ADR 0004。

## 第1部 PdM が書く所(業務の要求・業務ルール)

### なぜ作るか

- ペルソナ: キットで作る AI と、それを見るエンジニア(想定の場面 18-5・7-3)
- 動かす KPI: (キットの物差し: AI が手順どおりに作った PR が、1回目で CI を通る割合)
- `.claude/skills/add-domain` の手順は、今のコードと食い違っていた。手順どおりに作ると移行が作れない・API が載らない・CI が落ちる所があり、逆に、守りがあると書いた所(解約で消す一覧の見張り)が新しい領域では効いていなかった。手順の「無ければ人に聞く」も、ルートの「人に聞くのは4つだけ」と矛盾していた。

### 業務の要求

- AI が add-domain の手順だけを読んで新しい領域を足すと、lint・typecheck・単体・結合・squawk・守りの点検が通る PR になる
- 手順が「CI が落ちる」と書いた所は、本当に落ちる

### 業務ルール

- 名前と向きは AI が決めて設計書に理由を書く。持ち主は、チームが分かれていれば「他チームとの契約や制約」として仮決めで残す — 人に聞くのは4つだけ(ルートの `CLAUDE.md`)
- 解約で消す一覧の見張りは、スキーマの名前を並べずに全部の表を見る — 領域が増えるたびに見張りを直すのを忘れると、解約した組織のデータが消し残る
- どの領域にも CLAUDE.md がある(無ければ単体テストが落ちる) — 手順に書いただけでは守られず、`growth` には無かった

### 受け入れ条件(業務の言葉で)

- [x] 一時的な領域(`memos`。表1つ・GET の API 1本)を手順どおりに足すと、`pnpm typecheck`・`pnpm --filter @app/api test`・`db:lint`・結合テスト(`rls`・`classification`・`offboarding`・`authz-matrix`・`tenant-isolation` を含む全部)・`pnpm guards` が通る(2026-10-29 に確かめ、コミットしていない)
- [x] 手順に、全部の表を集める所(`src/db/schema.ts`)・ルートの登録(`app.ts`)・個人情報の台帳とログで伏せる名前・`.tbls.yml` がある
- [x] 新しい領域の表を `TENANT_TABLES` に足し忘れると、`offboarding.int.test.ts` が落ちる(前は落ちなかった)
- [x] 領域のフォルダに CLAUDE.md が無いと、`domain-boundaries.test.ts` が落ちる。`growth` に CLAUDE.md がある
- [x] `add-domain` に「無ければ人に聞く」が無く、4つに当たる所(持ち主)だけ仮決めの道がある
- [x] `add-api-endpoint` の領域の一覧が今の領域と合う(`dependencies.ts` を指す)

### 要配慮個人情報

- 当たらない(手順とテストだけ。新しく持つ項目は無い)

### やらないこと

- 画面を足すスキル・仕様の無い依頼の入口(G-119 で1機能を PR まで通して、要ると分かってから)
- `add-api-endpoint` に機能フラグを足す(穴の行の案にあったが、手順は `apps/api/CLAUDE.md` の機能フラグの行にある。矛盾ではない)
- ルートの `CLAUDE.md`・`apps/api/CLAUDE.md` の書き換え(危険度「高」。`apps/api/CLAUDE.md` の「`{schema,repository,routes,index}.ts`」は、API の無い領域では `routes.ts` が無いと add-domain に書いた)

### 決めたこと

- 2026-10-29: 持ち主 @attumkwg が「一気にやりたい」で G-113 を「矛盾直しだけ」に絞った(穴の棚卸し)
- 手順を確かめるのに、一時的な領域を作って CI の点検を流した(読むだけでは、`src/db/schema.ts` が無いと移行が作れないこと・見張りが効いていないことは分からなかった)

## 第2部 AI が網羅して書き、エンジニアが見る所(システムの振る舞い)

### 見つけた食い違いと直し方

| # | 食い違い | どう分かったか | 直し方 |
|---|---|---|---|
| 1 | 「無ければ人に聞く」(名前・向き・持ち主)が「人に聞くのは4つだけ」と矛盾(場面 18-5) | 読んで | 名前と向きは AI が決める。持ち主はチームが分かれていれば仮決め |
| 2 | 手順に `src/db/schema.ts` の export が無い | `pnpm db:generate` が「変更なし」 | 作る物の 3 |
| 3 | 手順に `app.ts` のルートの登録が無い | 登録しないと OpenAPI に載らない | 作る物の 4。`add-api-endpoint` の 3 にも |
| 4 | 移行の見本が `0002_domain_schemas.sql`(表を移す移行。squawk の例外つき) | 新しい領域の移行は drizzle-kit が `CREATE SCHEMA` を書く | 見本を `0023_file_storage.sql` に。手で足す物(上限・GRANT・RLS)を並べた |
| 5 | 新しい `personal` の列の名前は `ALWAYS_REDACTED` にも要る(手順にも db-migration にも無い) | `classification.test.ts` が落ちた | 作る物の 6・db-migration の 1 |
| 6 | 解約で消す一覧の見張りが、スキーマ `organizations`・`projects`・`tasks`・`platform` だけを見ていた | `memos.memos` を一覧から外しても通った | 見張りを全部のスキーマの表に(`offboarding.int.test.ts`)。直した後は `memos.memos` だけが出た(今の main の表は全部一覧にある) |
| 7 | `TENANT_TABLES` の順(子から親)が手順に無い | 読んで | 作る物の 7 |
| 8 | 「4つのファイル」だが `growth` に `routes.ts` が無い | 実際のフォルダ | `routes.ts` は API があるときだけ |
| 9 | 領域ごとの CLAUDE.md が `growth` に無い。テストも無い | 実際のフォルダ | `growth/CLAUDE.md` を型から作り、`domain-boundaries` に1つ足した |
| 10 | `add-api-endpoint` の領域の一覧が organizations・projects・tasks のまま | 読んで | `dependencies.ts` を指す |
| 11 | 型の「いつも流すテスト」に `rls` が無い(実物の6つは全部 `rls` を書いている) | 読んで | 型に足した |
| 12 | 確かめる所に `db:lint` と `authz-coverage` が無い | 読んで | 足した |

### 状態 × 操作

- 該当なし(手順とテストだけ)

### 境界値

- 見張り(6)は `information_schema` の表(`BASE TABLE`)だけを見る。ビューは消す物ではないので外す。`pg_catalog`・`information_schema`・`drizzle`(移行の記録)は外す

### 権限の組み合わせ

- 該当なし(API を足していない)

### 悪用のされ方(STRIDE で1行ずつ)

| 観点 | どう悪用されうるか | どう防ぐか(テスト / ルール) |
|---|---|---|
| 情報漏えい(他社のデータ) | 解約した組織の行が、新しい領域の表に消し残る | `offboarding.int.test.ts` の見張りを全部のスキーマに |
| 改ざん | 見張りを緩める | 見張りのテストは危険度「高」(`.claude/hooks/protected-paths.json`)・`pnpm test-weakening` |
| なりすまし・否認・妨害・権限昇格 | 該当なし(振る舞いを変えていない) | — |
