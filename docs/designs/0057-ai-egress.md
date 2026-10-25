# 設計: AI の環境から外への通信を絞る(結合テストを回せる形で)

> **AI 用の設計書。省略せずに網羅的に書く(正はこちら)。** 人はこれを開かず、PR の本文の「人向けのまとめ」を見る([guides/human-review.md](../guides/human-review.md))。
> 仕様: [docs/specs/0057-ai-egress.md](../specs/0057-ai-egress.md)・ADR: [0068](../adr/0068-ai-egress-by-where-it-runs.md)(②は [0069](../adr/0069-background-ai-runs-integration-tests.md) で置き換え)
> 状態: 完了(承認した人: @attumkwg 2026-10-25。会話で回答。段1〜5 を出した)
> 観点の順は [review-viewpoints.md](../review-viewpoints.md)。当てはまらない節も消さずに「該当なし(理由)」と書く。

## 0. 全体像

外へ送る**手段**を棚卸しし、手段ごとに止める。そのうえで「AI が書いたコードを動かす所」を2つに限る: ① 外への通信を許可リストのプロキシに通した devcontainer(中の Docker で結合テストと E2E が回る)、② GitHub Actions の背景の AI(Web を読む道具と GitHub 以外の MCP を持たず、結合テストは自分で回す。テストのコンテナは外へ出られない)。人が見ていない作業はこの2つでだけ回す。外へ向けた操作は記録し、PR に「外へ出した物」として並べる。

```mermaid
flowchart LR
  subgraph D[① 絞った devcontainer]
    AI1[Claude Code] --> SH[Bash・テスト]
    SH --> DIND[中の Docker\nDB・画面・ブラウザ]
    SH -->|HTTP(S)_PROXY| PX[許可リストのプロキシ]
    DIND -->|イメージの取得| PX
    FW[firewall: プロキシ・localhost・中の Docker の網 だけ通す]
  end
  PX -->|許可リストの宛先だけ| NET[(外)]
  subgraph G[② Actions の背景の AI]
    AI2[claude-code-action\nWeb の道具なし・GitHub の MCP だけ] --> IT[結合テスト\nコンテナは外へ出られない]
    AI2 -->|push| CI[CI: E2E ほか]
    CI -->|結果| AI2
  end
```

## 作業の前に読んだ物(ガイド)

- `docs/security.md` の AI-1〜AI-6: 本番に入れない・外に出られる先を絞る(未)・Issue の文はデータ・CI とハーネスを変えさせない・本番の個人データを渡さない。
- `docs/guides/local-guards.md`: 守りの3層(手元の Claude Code・GitHub・人)。管理者の設定(managed settings)で全社に配る話。確認を飛ばすモードの禁止(ADR 0047)。
- `.devcontainer/devcontainer.json`: Docker の中の Docker(docker-in-docker)・Claude Code。末尾の「次の一歩: 外に出られる先を絞る」。
- `.github/workflows/claude.yml`: 背景の AI。起動は持ち主だけ・鍵は main だけの Environment・`--allowedTools` で Bash を決まったコマンドだけ(`curl` などは無い)。WebFetch・WebSearch・MCP は止めていない。
- `.claude/settings.json`: `deny`(`aws`・`terraform apply`・`.env` を読む・強制 push など)・フック。sandbox は使っていない。
- Claude Code の sandbox(公式の手引き。2026-10-25 に読んだ): Bash を OS の仕組みで囲み、外へはプロキシの許可リストだけ(`sandbox.network.allowedDomains`)。**Docker は sandbox と合わず、`excludedCommands` で外に出すと何でもできる権限で動く**。Docker の口(`docker.sock`)を渡すとホストに届く。**ネイティブの Windows では動かない**(WSL2 が要る)。WebFetch・MCP・フックは sandbox の外(権限の決まりで止める)。

## 1. 設計方針

- **手段の側で止める**。「送ってはいけない物」を書き並べるのではなく、送る道具・通信・鍵を、要る物だけにする。
- **AI が書いたコードを動かす所で絞る**。対話の AI の道具の確認(人が見ている)と、コードの通信の絞り(人が見ていない)を分けて考える。
- **結合テストと E2E を回せることを、絞りの受け入れ条件にする**(前回の見送りの理由をつぶす)。
- 絞りは段に分けて入れる(下の 7)。この PR は設計だけ。

## 2. 外へ送る手段の棚卸し

| 手段 | 何が送れるか | 対話の AI(人が見ている) | 背景の AI(② Actions) | ① 絞った devcontainer |
|---|---|---|---|---|
| MCP の道具(メール・チャット・カレンダー・フォーム・ブラウザ) | **いちばん「送る」**。文を作って外の人に届く | リポジトリに `.mcp.json` を置かない。使う人の手元の物は、使う人の判断(管理者の設定で配る) | **GitHub の MCP だけ**(このリポジトリへのコメント・CI の結果・ファイルの操作。action が足す物)。ほかは渡さない(`mcp_config` を足さない) | 置かない |
| ブラウザの操作(Playwright・ブラウザの拡張) | フォームの送信・ログインした先での操作 | 確認で止める(各道具の決まり) | 持たない | E2E のブラウザは中の Docker の網の中だけ(外のページへはプロキシで止まる) |
| WebFetch・WebSearch | 読むだけでも、URL の問い合わせに載せて送れる | 宛先ごとに確認(既定) | 持たない(`--disallowedTools WebFetch,WebSearch`) | 宛先の許可リスト(下の 3) |
| Bash の通信(`curl`・`node` の `fetch`・テストのコード・`npm` の install のスクリプト) | 何でも | 確認で止める(フック・既定の確認)。OS では絞らない(U-1) | `--allowedTools` に無い物は動かない。テストのコードは動かさない(CI へ) | プロキシの許可リストだけ。firewall で直の通信は止まる |
| `gh`・`git push` | PR・コメント・ブランチ | このリポジトリだけ(トークンの範囲)。main への push・強制 push・マージ・承認は `deny` | 同じ(`GITHUB_TOKEN` はこのリポジトリだけ) | 同じ |
| アプリのメール(アウトボックス) | 利用者へのメール | 手元は Mailpit に届くだけ。本番の鍵は無い(AI-1) | 同じ | 同じ |
| 鍵 | 外のサービスに本人として送る | 本番・AWS・メール・チャットの鍵を置かない(AI-1)。`.env` を読まない(`deny`) | Environment「claude」には Claude の鍵だけ | 置かない(`devcontainer.json` はマウントしない) |

## 3. 許可リスト(① と、② で絞る場合)

| 宛先 | なぜ |
|---|---|
| `registry.npmjs.org` | パッケージの取得(`pnpm install`) |
| `github.com`・`api.github.com`・`codeload.github.com`・`objects.githubusercontent.com` | git・`gh`・Actions の部品 |
| `api.anthropic.com`(と Claude Code が使う宛先) | モデルの API |
| `registry-1.docker.io`・`auth.docker.io`・`production.cloudflare.docker.com`・`mcr.microsoft.com`・`ghcr.io` と、その置き場 | 結合テストの DB・E2E のブラウザ・画面のイメージ |
| `localhost`・中の Docker の網 | アプリ・DB・Mailpit・ブラウザ(プロキシを通さない) |

- 足すのは PR で(絞りの設定は危険度「高」。下の 5)。
- 止まった宛先はプロキシの記録に残り、`外へ出した物` に「止まった」として並ぶ(下の 6)。

## 4. 案の比べ

| 案 | 結合テスト・E2E | 絞りの強さ | 手元の OS | 足す物・手間 | 判定 |
|---|---|---|---|---|---|
| A. devcontainer の firewall だけ(宛先の IP を許す。前回の形) | 中の Docker を通せば回る。前回は中の Docker の網(転送)と、イメージの取得先を止めて壊れた | IP で決めるので、置き場の IP が変わると落ちる | Docker があればどれも | iptables・`NET_ADMIN` | **B と組む**(firewall はプロキシと localhost と中の網だけを通す役に) |
| B. 許可リストのプロキシ(宛先の名前で決める)+ firewall で直の通信を止める | 回る(中の Docker の取得も、プロキシ経由にする) | 名前で決める・記録が残る。プロキシを無視する道具は firewall で止まる | Docker があればどれも | プロキシ1つ(コンテナの中)・設定 | **採る(①)** |
| C. Claude Code の sandbox(Bash を OS で囲み、許可リストのプロキシ) | **回らない**。Docker は sandbox の外に出すしかなく、出すと何でもできる。Docker の口を渡すとホストに届く | Bash は強い。WebFetch・MCP は権限の決まりで別に止める | mac・Linux・WSL2 だけ(ネイティブの Windows は不可) | 設定だけ | 結合テストを回さない作業(調べ物・文書・単体)の手元の層として**任意**で勧める |
| D. テストを別の所(CI・別のホスト)で流し、AI の環境には Docker を置かない | 回る(CI が回す)。1回の往復が数分 | AI の環境は強く絞れる。CI の中のテストのコードは別の話(下の U-2) | どれでも | 往復の時間・Actions の分数 | **採らない**(2026-10-25 に作り直し。往復の手戻りが増える。13) |
| D'. 背景の AI が Actions の中の Docker で結合テストを自分で回し、テストのコンテナから外への新しい通信を止める(U-2 の形) | 回る(PR の前に) | テストのコンテナは外へ出られない。テストを動かす Node は外へ出られる(Actions の中は外の部品なしでは絞れない) | — | 止める台本1つ | **② の背景の AI で採る** |
| E. 背景の AI だけ絞る(対話の AI は今のまま) | — | 人が見ていない所だけ絞る | — | 設定だけ | **方針として採る**(U-1) |

結論: **E の方針で、① = A+B の devcontainer、② = D' の背景の AI**。C は手元の任意の層。

## 5. 作り(段ごとの PR で作る物。この PR では作らない)

### ① 絞った devcontainer

- `.devcontainer/` に許可リストのプロキシ(コンテナの中で動く小さな転送用のプロキシ。宛先の名前で許す・記録を残す)と、起動のときの firewall(`OUTPUT` はプロキシ・localhost・中の Docker の網だけ。`FORWARD` は中の Docker の網どうしを通す)。
- 中の Docker(`dockerd`)にもプロキシを渡す(イメージの取得がプロキシを通る)。
- `HTTP_PROXY`・`HTTPS_PROXY`・`NO_PROXY=localhost,127.0.0.1,<中の網>`。
- 絞りの設定は root の持ち物にし、開発の利用者(AI)は書けない。キットの一覧(`.claude/hooks/protected-paths.json`)に `.devcontainer/**` を足す(危険度「高」)。
- 受け入れ: 中で `pnpm test:integration`・`pnpm test:e2e`・`pnpm vrt` が通る。`curl https://example.com` が止まり、記録に残る。

**作った形と確かめたこと(段3・2026-10-25)**:

- 作り: `.devcontainer/Dockerfile`(元のイメージ+tinyproxy+iptables。E2E のブラウザと OS の部品は作るときに入れる)・`egress/allowlist.txt`・`egress/tinyproxy.conf`・`egress/egress-up.sh`(root。プロキシを起動・中の Docker の取得とビルドにプロキシを渡す・firewall・node のふつうの sudo を取り上げる)・`egress/blocked.sh`(止めた宛先を数える)。node が sudo で動かせるのは `egress-up.sh` だけ。
- 中の Docker のコンテナから外へは `DOCKER-USER` で止める。イメージを作るときの `pnpm install` は、プロキシを通す(`~/.docker/config.json` の宛先は起動のたびに中の網の IP で書く。`NODE_USE_ENV_PROXY` を `docker-compose.yml` の `build.args` から `apps/*/Dockerfile` の `ARG` に渡す。外では空なので何も変わらない)。
- 手元(Windows の Docker Desktop)で、この形のコンテナを立てて確かめた: npm・GitHub は通る/`example.com` はプロキシでも直でも止まり、`blocked.sh` に出る/node の `sudo` は使えない/**結合テスト 31 ファイル・358件が通る/`docker compose up --build` で画面・API が立つ/E2E 37件が通る(4件は既定で飛ばす物)/VRT 18件が基準と一致**。
- 許可リストは、止まった宛先を見て足した: Docker Hub の置き場(`production.cloudfront.docker.com`)・distroless(`gcr.io`)・RDS の証明書(`truststore.pki.rds.amazonaws.com`)・メールの中継の apt(`deb.debian.org`)。`telemetry.vercel.com`(turbo の利用の知らせ)は止めたまま(`TURBO_TELEMETRY_DISABLED=1`)。
- 元のイメージのタグ `1-24-bookworm` は置き場に無かった(devcontainer が立たなかった)。`24-bookworm` に直した。

**わざと残る穴(人が知っておくこと)**:

- 許可リストに、だれでも使える保存先の名前がある(Docker の置き場が使う `*.r2.cloudflarestorage.com`)。名前だけでは、自分たちの物と他人の物を区別できない。ブラウザの置き場(`storage.googleapis.com`)は、作るときに入れることで許可しないで済ませた。
- プロキシは宛先の名前で決める(TLS の中は見ない)。名前を偽る形(domain fronting)は止められない。
- 中の Docker で `--network host` と、プロキシと同じ利用者の番号で動くコンテナを作れば、firewall の外へ出られる。うっかり送る形(この設計が止めたい物)ではなく、わざと抜ける形なので、残す。

### ② 背景の AI(`claude.yml`)

- `--disallowedTools` に `WebFetch`・`WebSearch` を足す。MCP は action が足す GitHub の物だけ(このリポジトリだけに届く)で、ほかの MCP(`mcp_config`)は渡さない。
- **PR を出す前に `pnpm test:integration` を自分で回す**(手戻りを減らす)。その前の手順で `.github/scripts/block-container-egress.sh` を流し、Actions の中の Docker のコンテナから外への新しい通信を止める(イメージの取得は Docker 本体なので通る。U-2 と同じ形で、段4の CI も同じ台本を使う)。
- `pnpm turbo run:*`(影響範囲の型と単体・結合)は戻す。E2E と `pnpm docs:db` は回さない(画面のイメージを作るときの `pnpm install` が外へ出るので、止めると動かない。E2E は CI、表の説明書は人が `pnpm docs:db`)。
- CI の結果は `gh pr checks`・`gh run view` か GitHub の MCP で読む(CLAUDE.md の「CI が落ちたら直すのは2回まで」のまま)。

### 外へ出した物の記録

- `.claude/hooks/` に、外向きの操作(`git push`・`gh pr create`・`gh pr comment`・`gh issue comment`・WebFetch・`mcp__*`)を1行ずつ書くフック(PostToolUse)を足す。書くのは時刻・手段・宛先(リポジトリ・ホスト)だけ。
- ① では、プロキシの記録(許した・止めた宛先)も同じ所に写す。
- 終わる前(Stop のフック `verify.mjs` の隣)に、PR の本文の「🚪 外へ出した物」の欄を作る材料を出す。PR テンプレートに欄を足す(危険度「高」)。

## 6. 頼まれていない外向きの行動の報告の型

PR の本文(と背景の AI の最後の報告)に、次の表を必ず付ける。**空でも「なし」と書く**。

| 時刻 | 手段 | 宛先 | 頼まれていたか | 何のため(一言) |
|---|---|---|---|---|
| 10:02 | git push | このリポジトリ・ブランチ | はい(依頼の「PR にして」) | 変更を出す |
| 10:05 | WebFetch | code.claude.com | **いいえ** | sandbox の仕様を確かめる |
| 10:07 | (止まった)https | example.com | **いいえ** | テストのコードが読もうとした |

- 「頼まれていたか」は、依頼の文のどこに当たるかを書く。当たらなければ **いいえ** にし、PR の「人に判断してほしい所」にも1行写す(人が見て、要らない手段なら次から取り上げる)。
- 中身・個人データは書かない(AI-6)。宛先と手段だけ。
- AI が「戻せない」「消えた」と言っても信じず、人がバックアップや記録で確かめる(この表は、何をしたかの事実だけを並べる)。

## 7. 段の順(作る PR)

| 段 | 何を | 危険度 | 前に要る物 |
|---|---|---|---|
| 1 | ② 背景の AI の道具を絞る(`claude.yml` の `--disallowedTools`・結合テストは自分で回し、コンテナは外へ出られない) | 高(CI) | U-1・U-3 |
| 2 | 外へ出した物の記録のフックと PR テンプレートの欄 | 高(ハーネス・CI) | 6 の型 |
| 3 | ① 絞った devcontainer(プロキシ・firewall・中の Docker の取得)と、中で結合テスト・E2E・VRT が通ることの確かめ | 高(ハーネス) | U-1 |
| 4 | CI の結合テスト・E2E のテストのコードの通信を絞る(`ci.yml` の結合テストの前と、E2E のイメージを作った後に `block-container-egress.sh`。偽物の Cognito のイメージも止める前に作る。テストを動かす Node は絞れない) | 高(CI) | U-2 |
| 5 | `docs/security.md` の AI-2 を「あり」に・`docs/guides/local-guards.md` に層を足す | 中 | 1〜3 |

## 8. 非機能

- 速さ: ① はプロキシを通る分だけ取得が少し遅い。② は結合テストを PR の前に自分で回すので、CI との往復の手戻りが減る。E2E だけ CI を待つ。
- 運用: 許可リストに足すのは PR(止まった宛先の記録を見て決める)。
- 費用: ② の結合テストは背景の AI の中で回る(Actions の分数は、これまでと同じ)。
- 手元の OS: ① は Docker があれば Windows・mac・Linux で動く。ネイティブの Windows のそのままの手元(devcontainer を使わない)では OS の絞りは無い(U-1)。

## 9. このプロダクト特有

| 観点 | この変更では |
|---|---|
| テナント分離・権限の表・監査ログ・解約で消す一覧・サポートの代理ログイン・列の分類・画面の部品 | 該当なし(アプリを変えない) |
| ログの個人情報 | 外へ出した物の記録は宛先と手段だけ(中身を書かない) |
| ハーネス(危険度「高」) | 段 1〜4 は全部ハーネスか CI。`.devcontainer/**` を一覧に足す |

## 10. 観点ごとの扱い

| 観点 | 扱い | 理由 |
|---|---|---|
| 設計方針 | 最重要 | 手段の側で止める・動かす所で絞る・テストが回ることを条件に |
| 非機能(セキュリティ) | 最重要 | 人が見ていない AI の外への通信 |
| システム間連携 | 採用 | 許可リストの宛先・CI との往復 |
| 業務ルール | 採用 | 報告の型(6) |
| データモデル・API・状態遷移 | 低優先 | アプリを変えない |

## 11. 決めたこと(AI が決めた。人に聞かなかった)

- **Claude Code の sandbox を①の代わりにしない** — Docker を sandbox の外に出すと何でもできる権限で動き、Docker の口を渡すとホストに届く(公式の手引き)。結合テストを回すと、絞りに穴が開く。結合テストを回さない作業の任意の層として勧めるだけにする。
- **①は宛先の名前で決めるプロキシ+firewall** — IP だけの許可(前回の形)は置き場の IP が変わると落ち、記録も読みにくい。firewall はプロキシを無視する道具を止める役に絞る。
- **中の Docker の網どうしの転送を通す** — 前回、結合テストが壊れた原因(中の Docker の網の転送と、イメージの取得先を止めた)。
- **WebFetch も「送る手段」に数える** — 読むだけでも、URL の問い合わせに載せて送れる。
- **報告は宛先と手段だけ・空でも「なし」** — 中身を書くと個人データが混ざる(AI-6)。「なし」と書かせないと、書き忘れと区別できない。

## 12. 未確定事項(AI の仮決め。人の承認と分けて追う)

> 4つに当たる判断だけ。状態の書き方は [guides/human-review.md](../guides/human-review.md) の 2。`pnpm decisions` がここを読む。**`仮決め` が残る PR はマージしない。**

| 番号 | 工程 | 種類 | 仮決め(設計した事実) | なぜそうしたか | 人が判断する問い | 状態 |
|---|---|---|---|---|---|---|
| U-1 | 設計 | 戻せないリスク | **人が見ていない AI の作業(長い作業・夜)は、① 絞った devcontainer か ② Actions の背景の AI でだけ回す**。Windows・mac のそのままの手元(devcontainer を使わない)では、人が見ている対話だけにする(OS では絞らない。今の確認で止める) | 手元の OS ごとに絞り方が違い、ネイティブの Windows では Claude Code の sandbox も動かない。人が見ているなら確認が止める | この線引き(人が見ていない作業は①か②だけ)でよいか。手元のそのままでも夜に回したいなら、別の手(WSL2+sandbox など)を足す | 承認(@attumkwg 2026-10-25。会話で回答。親のセッションから) |
| U-2 | 設計 | 他チームとの契約や制約 | CI の結合テスト・E2E の中で動くテストのコードの外への通信は、**外の会社の部品を足さずに**、テストのコンテナを外へ出られない Docker の網(`internal`)に置く形で絞る(段 4) | 外の部品(Actions の通信を止める部品)は委託先の台帳に1件増え、CI の全部に入る。キットの中で済む形を先に試す | 外の会社の部品で CI の通信を止める案を、使わない方向でよいか | 承認(@attumkwg 2026-10-25。会話で回答。親のセッションから) |
| U-3 | 設計 | 事業判断 | **背景の AI からは、Web を読む・調べる道具と MCP を取り上げる**(調べ物は人か対話の AI) | 人が見ていない所で、URL に載せて送る道・MCP で外の人に届く道を無くす | 背景の AI が調べ物をできなくなってよいか(要るなら、宛先を決めた読み取りだけ許す) | 変更(@attumkwg 2026-10-25: GitHub の MCP は残す。結合テストは背景の AI が自分で回す。会話で回答。親のセッションから) |

## 13. 作り直しの記録

| 日付 | きっかけ | 入った工程 | 直した物 | 作り直した下流 |
|---|---|---|---|---|
| 2026-10-25 | #87 への持ち主の答え(U-3 の変更): 「GitHub MCP を取り上げるのは微妙」「結合テストを自分で回してからやってくれた方が、変な手戻りとかないですみませんかね」 | 要求(仕様 0057 の受け入れ条件が「MCP を持たない」「結合テストを回さず CI」と言っていた) | 仕様の受け入れ条件2つ・STRIDE の1行 | 設計書の 0・2・4(D を採らず D' を採る)・5 ②・7 の段1・8・U-3・ADR 0069(0068 の②を置き換え)・`claude.yml`・`.github/scripts/block-container-egress.sh` |
