# ADR 0008: メールはアウトボックスから Postfix に SMTP で渡し、Postfix が SES に中継する

- 状態: 採用
- 日付: 2026-10-18
- 決めた人: @attumkwg

## 背景

知らせ・招待・確認コードなど、メールは必ず要る。決めることは3つあった。

1. アプリは何を通して送るか
2. 送れなかったメールを、どこで持っておくか(「必ず送る」)
3. Cognito が送るメール(確認コード・パスワードの再設定)の道

## 選択肢

### 1. アプリの送り方

| 案 | 良い所 | 弱い所 |
|---|---|---|
| A. SMTP で Postfix に渡す(Postfix が SES へ) | 手元と本番で同じ道(渡す先が Mailpit か SES かだけ)。SES がつまずいても Postfix が溜めてやり直す | Postfix を1つ動かす(月 約1,700円) |
| B. SES に直接 SMTP | 部品が少ない | SES の一時的な失敗・流量の上限は、アプリ側で持つ |
| C. SES の SDK | 細かい機能(テンプレートなど)が使える | 手元では AWS のまね(LocalStack)が要る。SES に縛られる |

### 2. Postfix の送り待ち

| 案 | 良い所 | 弱い所 |
|---|---|---|
| A. EFS | Postfix が入れ替わっても残る。Terraform 60行ほど・月数十円 | ディスクを1つ持つ |
| B. S3 | — | **使えない**。Postfix は送り待ちのファイルの名前の付け替えとロックが要り、S3 にはどちらも無い |
| C. 残さない | 一番小さい | SES が止まっている間に Postfix が入れ替わると、溜まっていたメールが消える |

### 3. Cognito のメール

| 案 | 良い所 | 弱い所 |
|---|---|---|
| A. Cognito → SES に直接 | 設定だけ。同じドメイン・同じ DKIM | Postfix を通らない(道が2つ) |
| B. Cognito の「送る前の Lambda」→ Postfix | 道が1つ | Lambda・KMS・VPC の設定が増える |

## 決めたこと

**1 は A・2 は A・3 は A**(作者 @attumkwg の選択。2 は作者「EFS は重いので S3 にできないか」→ S3 では Postfix が動かないので EFS)。

- アプリ: `apps/api/src/mail/`(nodemailer で SMTP)。送るのはアウトボックスの受け手だけ。
- Postfix: `docker/postfix`(Debian の Postfix・読み取り専用のファイルシステムで動く・決めたドメインの送り元だけ受け取る)。本番は ECS で1台だけ(同じ送り待ちを2台が触らない)。
- SES: ドメイン・DKIM・SPF(MAIL FROM)・DMARC(p=none から)を Terraform で(`modules/ses-domain`)。Postfix の資格情報は、このドメインからしか送れない IAM ユーザーのもの。
- 手元: Postfix → Mailpit。E2E と結合テストが、届くところまで確かめる。

## 結果として起きること

- 良くなること: メールは「積んだら必ず届く」(アプリ → Postfix はアウトボックスがやり直し、Postfix → SES は Postfix がやり直す)。手元で全部のメールが見える。
- 我慢すること: Postfix を入れ替える数十秒は、アプリが渡せずに待つ(遅れるだけ)。SES の SMTP には IAM ユーザーのアクセスキーが要る(役割では使えない)。
- 見直す合図: メールが月に数十万通を超える(Postfix を2台に・SES の専用 IP)。Postfix の入れ替えの遅れが困るようになる。
