# 確かめるための試作(プロトタイプ)を出す

> 解決策が伝わるか・流れで迷わないかを、**押せる画面だけ**で確かめる。裏(API・DB)は無く、データは偽物。捨てる前提。
> 対話で進めるときは `/prototype`。考え方の本体は [before-pmf.md](before-pmf.md)(作らずに確かめられるなら作らない)と [bets-and-assets.md](bets-and-assets.md)(賭け)。
> 置き場所の選び方は [ADR 0020](../adr/0020-prototypes-on-s3-cloudfront-passphrase.md)。

## いつ使うか

| 段階 | 出す物 | 使う? |
|---|---|---|
| 全体の ① 困りごと / 賭けの `cpf` | 話を聞くだけ | **使わない**(解決策を先に見せると、話がそちらに引っ張られる) |
| 全体の ② 解決策 / 賭けの `psf` | 押せる画面(3〜5枚)・偽のデータ | 使う |
| 全体の ③ お金 | 申し込みのページ(説明・値段・事前登録) | 使う。**メールを集めるなら、利用目的と同意を必ず付ける**(下の「申し込みのページ」) |
| 賭けの `rollout` 以降(PMF の後の機能) | 本物のアプリの中で一部の組織にだけ | 使わない(機能フラグで) |

- **試作は賭け1つに1つ**。`prototypes/<賭けの ID>-<英語の短い名前>/`(例: `prototypes/B-0002-morning-digest/`)。賭けが無ければ先に `/bet`。
- 見本: [prototypes/B-0002-morning-digest](../../prototypes/B-0002-morning-digest/)(賭けは [B-0002](../product/bets/B-0002-morning-digest.md)。中身は全部架空)。

## 作る

1. 見本のフォルダを写し、フォルダ名と `package.json` の `name`(`@prototype/<フォルダ名を小文字で>`)を変える。`base`(URL の頭)はフォルダ名から自動で決まる。
2. `pnpm install` → `pnpm prototype:dev B-NNNN` で手元に開く(http://localhost:5180/B-NNNN/)。
3. 画面は **`@app/ui`(デザインシステム)の部品だけ**で作る([design-system.md](../design-system.md))。本物と見た目がそろうので、「試作だから伝わらなかった」を減らせる。
4. データは `src/data.ts` に偽物を書く。**実在の人・会社・メールアドレスを入れない**(「サンプル商事(架空)」「担当A」のように)。
5. 画面の上に「これは試作です。何も保存・送信されません」と出す(見本の `App.tsx`)。
6. フォルダの `README.md` に台本(下の「話の聞き方」)を書く。

## 本物と混ぜない守り

| 守り | どこで | 破ると |
|---|---|---|
| 本物の API・DB・AWS・監視・秘密を読まない(`@app/*` は `@app/ui` だけ・`@aws-sdk/*`・`pg`・`drizzle-orm`・`@sentry/*`・`dotenv`・`apps/` や `packages/` の中を直接・`.env`・`import.meta.env.VITE_*`) | Biome(`biome.json` の `prototypes/**`)と `pnpm prototypes`(依存と相対パスも) | CI が落ちる |
| `.env` を読まない | `vite.config.ts` の `envDir: false`・`pnpm prototypes` | CI が落ちる |
| 検索に載せない | `index.html` の `<meta name="robots" content="noindex, nofollow">`(`pnpm prototypes` が確かめる)・応答ヘッダー `X-Robots-Tag`(手元の Vite と CloudFront) | CI が落ちる |
| 捨てる物として扱う | 複雑さ・長さの上限から外す(Biome)・テストとカバレッジは置かない(`test` を置くと落ちる)・画面の大きさの上限(`apps/web` の size)の外 | — |
| 賭けを閉じたら消す | 賭けが `dropped` / `adopted` / `retired` なのにフォルダが残っていたら、`pnpm prototypes` が 🧹 で知らせる(CI では PR の画面に警告。落とさない) | 知らせるだけ |
| 置き場所から消す | フォルダを消して main に入れると、`prototypes.yml` が S3 からも消す | — |

- 試作に**入れてよいのは偽のデータだけ**。本物の顧客のデータ・スクリーンショットを貼らない。
- 本物にする(作り込む)ときは、試作のコードを写さずに `/new-feature` で仕様から作る(試作はテストも権限の検査も無い)。

## 見せる

### AWS が無いとき(手元)

`pnpm prototype:dev B-NNNN` を開いた画面を、話を聞く場で**自分の画面を共有して**触ってもらう(相手に操作を渡せる会議の道具ならなおよい)。0円。

### AWS に置く(dev アカウント・合言葉つき)

`https://<CloudFront のドメイン>/<賭けの ID>/`。PR で試作を変えると、`prototypes.yml` がビルドして置き、PR に URL をコメントする。

1. 人が1回だけ: `infra/terraform/envs/preview/prototypes` を apply する(dev アカウント。`envs/preview/base` を先に立てたなら `create_oidc_provider = false`)。
2. 出てきた値を GitHub の変数(Settings → Secrets and variables → Actions → Variables)に入れる: `AWS_PROTOTYPES_ROLE_ARN`(github_role_arn)・`PROTOTYPES_BUCKET`(bucket)・`PROTOTYPES_URL`(url)。
3. 合言葉を入れる(下)。入れるまでは誰も開けない。

#### 合言葉を入れる・変える

合言葉は **CloudFront の KeyValueStore に人が CLI で入れる**。コード・リポジトリ・Terraform の状態・PR・チャットのログには書かない。

| 鍵 | 通る所 | 使い方 |
|---|---|---|
| `_all` | 全部の試作 | チームの中で使う |
| `B-NNNN` | その試作だけ | 話を聞く相手に渡す。終わったら消す |

値は `base64("名前:合言葉")`(名前は何でもよい。例: `guest`)。手元の端末で(dev アカウントの権限で):

```bash
ARN=$(terraform -chdir=infra/terraform/envs/preview/prototypes output -raw passphrases_kvs_arn)
ETAG=$(aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn "$ARN" --query ETag --output text)
read -rs -p "合言葉: " PASS && echo
aws cloudfront-keyvaluestore put-key --kvs-arn "$ARN" --if-match "$ETAG" --key B-0002 --value "$(printf 'guest:%s' "$PASS" | base64 | tr -d '\n')"
```

- 消すときは `delete-key --key B-0002`(同じく `--if-match`)。変えたら数秒〜数十秒で効く。
- 合言葉は**会う直前に、URL とは別の道で**渡す(URL はメール、合言葉は会議の場で口頭、など)。
- 合言葉は守りの1枚目にすぎない。**偽のデータだけを置く**のが本当の守り。

#### 費用の目安(東京・定価・1ドル=150円)

| 物 | 目安 |
|---|---|
| CloudFront(配る・関数・KeyValueStore) | ほぼ0円(無料枠: 月 1TB・1,000万リクエスト・関数 200万回。KeyValueStore は読み 100万回あたり 約4.5円) |
| S3(数 MB) | 1円未満 |
| 合わせて | **月 0〜数十円**。NAT・ALB が要らないので、プレビュー環境の土台(月 約1.2万円)を立てなくてよい |

WAF は付けていない(付けると 月 約1,000円〜)。合言葉と偽のデータで足りる、という判断([ADR 0020](../adr/0020-prototypes-on-s3-cloudfront-passphrase.md))。

## 話の聞き方(台本)

[before-pmf.md](before-pmf.md) の「話の聞き方」のまま。試作は**最後に**見せる。

1. **先に過去の行動を聞く**(試作を見せる前): 「最後に◯◯で困ったのはいつ・そのときどうしたか」。
2. **頼むこと(1つずつ)**: 「朝、メールでこれが届いたとします。最初に何をしますか」のように、**場面と目的だけ**を伝えて触ってもらう。押す場所は教えない。
3. **見ること**: どこで止まったか・迷ったか・声に出したこと・押そうとして押せなかった所。**言ったことより、したこと**。
4. **聞かないこと**: 「使いますか」「いくらなら払いますか」「良いと思いますか」。
5. **記録**: その日のうちに `docs/product/interviews/`(名前・連絡先・会社名は書かない)。結果は `/bet` で賭けに持ち帰る(合格の線と比べる)。

## 申し込みのページ(③ お金)

メールアドレスは個人情報。**集めるなら、必ず**:

- 送るボタンの近くに**利用目的の一文**(何に使うか・いつ消すか)。
- **同意のチェック**(付けるまで送れない)。
- 集めた先と、消す日を賭けのファイルの小石に書く。集めたアドレスはリポジトリに置かない。

試作のフォルダには送り先(裏)を作らない。本当に集めるときは、送り先(フォーム)の選び方と、利用規約・プライバシーポリシーの扱いを PR の「人に判断してほしい所」に書く(他チームとの契約や制約)。見本の `SignUp.tsx` は形だけで、どこにも送らない。

## 片付ける

- 賭けを `dropped`(やめた)・`adopted`(本物に入った)・`retired`(撤去)にしたら、同じ PR か直後の PR で試作のフォルダを消す(作業の種類は `撤去`)。
- main に入ると S3 からも消える。合言葉の `B-NNNN` の鍵も消す(上)。
