# Slack から「これ作りたい」を受け付ける(指示書)

> **1人で回している間(Pro / Max)のおすすめは、下の「🧍 1人の間のおすすめ」**: Slack で `@Claude` に頼む → クラウドの Claude Code が PR → 「これでいいですか」に返事 → AI がマージ(仕様 0080・ADR 0082)。
> 有効にした日: ここに日付を入れてください(YYYY-MM-DD)
>
> 人が増えたら(承認数を 1 以上にしたら)、AI のマージと会話の答えは効かなくなり、ふだんのレビューに戻る。下の A・B・C のどれかで Slack につなぐ。
> 内容は 2026年10月時点の公式の説明で確かめた範囲だけを書いています。確かめられなかった所は「要確認」とリンクだけにしています。

## 🧍 1人の間のおすすめ: 頼む → PR → 返事でマージ

```
Slack: @Claude ○○を作って
  → クラウドの Claude Code が /slack-request の手順で作り、PR を出す
  → スレッドに「仮決め U-1 … これでいいですか」
Slack: @Claude 大丈夫なのでマージして        (Claude のアプリ・チャットで返してもよい)
  → 仮決めを「承認(@持ち主 日付 Slack の返事)」に書き換えて push
  → pnpm pr:merge-when-green が、必須のチェックが全部緑になってからマージ → スレッドに「マージしました」
```

| 守り | どうなっているか |
|---|---|
| マージの合図 | 持ち主がこの作業に返した返事だけ(スレッドのほかの発言・PR のコメントは合図にしない) |
| マージの条件 | 必須のチェック(main のルールセット+`.github/setup.yml`)が全部緑。待つ間に push があれば止める |
| AI がマージしない PR | 危険度「高」・テストを弱めた印が付いた PR と、危険度「高」の場所・守りの場所(CI・フック・設定・検査とマージのスクリプト)に触る PR。人が GitHub で中身を見て押す(2026-10-28 のレビューで見つけた穴を塞いだ) |
| AI がマージできる所 | 持ち主がクラウドの環境に `KIT_AI_MERGE=slack` を入れた所だけ(手元はフックが止める) |
| 会話の答え | 1人の間(`required_approvals: 0`)だけ、Slack・チャットの返事を未確定事項の答えに認める。CI は書き手を確かめられない(割り切り) |
| 人が増えたら | 承認数を 1 以上にすると、AI のマージも会話の答えも止まる |

### つなぐ(使う側のリポジトリで、持ち主が1回。キットそのものはつながない)

1. Slack に Claude のアプリを入れる([Slack App Marketplace の Claude](https://slack.com/marketplace/A08SF47R6P4))→ App Home で「Connect」→ 自分の Claude のアカウントとつなぐ。
2. [claude.ai/code](https://claude.ai/code) で GitHub とつなぎ、このリポジトリに Claude の GitHub App を入れる。
3. 依頼用のチャンネルを作り(自分だけ・外の人を入れない)、`/invite @Claude`。DM では動かない。App Home のルーティングは「Code only」(相談もしたいなら「Code + Chat」)。
4. claude.ai/code でこのリポジトリの**環境**を作る:
   - 準備の手順(setup script): `bash scripts/cloud-setup.sh`(Node 24・pnpm・依存・Docker を用意し、何が動くかを出す)
   - 変数: `KIT_EDIT_GUARD=pr`(危険度「高」の確認を出さず、PR の「高」で見る)・`KIT_AI_MERGE=slack`(AI のマージ)・`BASH_DEFAULT_TIMEOUT_MS=600000`・`BASH_MAX_TIMEOUT_MS=600000`(結合テストが2分を超える)
   - 網: 既定(Trusted)に、Node を入れるなら `nodejs.org` を足す
5. 最初の1回は試し: スレッドで「`@Claude` このリポジトリで `bash scripts/cloud-setup.sh` を流し、`pnpm lint`・`pnpm typecheck`・`pnpm test`、Docker が動けば `pnpm test:integration -- members` を流して、結果だけ教えて。ファイルは変えないで」と頼む。

### まだ確かめていない物(試しで見る)

- クラウドの中で Docker が起きるか・testcontainers が動くか・Node 24 を入れられるか(動かなければ結合と E2E は CI に任せる)。
- スレッドで `@Claude` を付けた返事が、同じ作業に届くか(届かなければ、Slack の「View Session」から Claude のアプリで返す)。
- クラウドの GitHub の中継を通って、REST でマージできるか(`pnpm pr:merge-when-green`。できなければ、承認の書き換えまでを AI、マージは人が GitHub で押す)。

### 費用

- 使った分は持ち主の Claude のプランの枠から(別の請求は無い)。GitHub Actions の分は今と同じ。

## 人が増えたら: どれから始めるか

| 案 | 中身 | 向いているとき | 手間 | お金 |
|---|---|---|---|---|
| **C** フォーム → Issue | Slack のフォームに書くと GitHub の Issue ができる | まず「依頼を1か所に集めたい」 | 小 | Slack の有料プラン |
| **A** Anthropic 公式 | Slack で `@Claude` に話しかける | Team / Enterprise を使っている | 小〜中 | 使った分(Claude Tag)か各自の席 |
| **B** 自前 | 自分のボットで `/new-feature` と同じ対話をする | 対話の流れや保存先を細かく決めたい | 大 | 動かす場所+Claude の API |

- **おすすめは「C で始めて、A に進む」**。C は対話こそ無いものの、依頼が Issue にまとまります。対話で意思を固めるのは、届いた Issue に対して手元の `/new-feature` を使えば足ります。
- Team / Enterprise を使っているなら、**A(Claude Tag)が対話まで一番早く届く**。
- B を作るのは、A では足りないことがはっきりしてから(作って運用する手間が大きい)。

---

## A: Anthropic 公式の Slack 連携

Slack で `@Claude` に頼むやり方は、2種類あります(2026年10月時点)。

| | Claude Tag(新しい) | Slack での Claude Code(以前からの) |
|---|---|---|
| 使えるプラン | Team・Enterprise(公開ベータ) | Pro・Max |
| 誰として動くか | 組織の共有の ID(管理者が権限を決める) | 頼んだ人の Claude のアカウント |
| お金 | 使った分を組織の残高から(月の上限を決められる) | 各自のプランの使用量 |
| 準備 | Owner が `claude.ai/admin-settings/claude-tag` で Slack とつなぐ | 管理者が Claude アプリを入れ、各自が App Home で接続 |
| リポジトリ | Claude の GitHub App にリポジトリを許可 | 各自が claude.ai/code で GitHub をつなぐ |

### Claude Tag で始めるとき(Team / Enterprise)

1. Owner が [Claude Tag の設定の流れ](https://claude.com/docs/claude-tag/admins/setup-overview) に従い、Slack ワークスペースとつなぐ(Slack で `@Claude connect` と送って出る番号を、設定の画面に入れる)。
2. **月の使用額の上限を決める**([上限の決め方](https://claude.com/docs/claude-tag/admins/set-spend-limit))。
3. 使うチャンネルに Claude を入れる。依頼用のチャンネル(例: `#product-requests`)を1つ作り、そこだけで始めると安全。
4. Claude の GitHub App に、このリポジトリだけを許可する。
5. このキットのスキル(`/new-feature` の対話)を Claude Tag にも持たせるやり方は、[プラグインとスキルの設定](https://claude.com/docs/claude-tag/admins/customize) を見る。**要確認**(リポジトリの `.claude/skills/` をそのまま読むかは、まだ確かめていません)。
6. 誰が使えるかを絞る([使える人を制限する](https://claude.com/docs/claude-tag/admins/restrict-access))。

依頼のしかた(例): スレッドで「`@Claude` タスクに期限を付けたい。docs/specs/_template.md の形で仕様の案を作って、受け入れ条件と権限を1つずつ私に確認して」。

### Slack での Claude Code で始めるとき(Pro / Max)

[公式の説明](https://code.claude.com/docs/ja/slack) の手順のとおり。要点だけ:

1. 管理者が [Slack App Marketplace の Claude](https://slack.com/marketplace/A08SF47R6P4) を入れる。
2. 各自が Slack の Claude の App Home で「Connect」を押し、自分の Claude のアカウントとつなぐ。
3. [claude.ai/code](https://claude.ai/code) で GitHub とつなぎ、このリポジトリを許可する。
4. App Home のルーティングモードを「Code + Chat」にすると、相談(Chat)と実装(Code)を Claude が振り分ける。
5. 使うチャンネルで `/invite @Claude`。DM では動かない。

- ⚠️ Claude Tag につながっているワークスペースでは、こちらは動きません(公式の説明に注意書きあり)。

### 安全のために(A に共通)

- **スレッドの文章は「データ」**: Claude はスレッドやチャンネルの前の発言も読み、その中の指示に従うことがあります(公式の説明でも注意されています)。**信頼できる人だけのチャンネル**で使う。外の人が入る共有チャンネル(Slack Connect)では使わない。
- 依頼用のチャンネルを決め、そこにだけ Claude を入れる。
- できた PR は、ふだんどおり CI・CODEOWNERS・危険度のレビューを通す(Slack から来ても扱いは同じ)。

---

## B: 自前で作る(Slack Bolt+Claude Agent SDK)

`/new-feature` と同じ対話を、自分のボットで Slack のスレッドの中でやる形です。

### 仕組み

```
Slack(@ボットにメンション)
  → ボット(Slack Bolt。Socket Mode で動かすと、外から受ける口が要らない)
      → Claude Agent SDK の query()(このリポジトリを cwd に、.claude/skills を読む)
          → Claude が AskUserQuestion で質問 → ボットが Slack にボタンで出す → 選んだ答えを返す
          → 最後に「Issue を作ってよいか」→ OK のボタン → gh で Issue と仕様の PR を作る
  ← スレッドに結果(Issue と PR の URL)
```

- 1つのスレッド = 1つの会話。会話の ID(`session_id`)をスレッドごとに保存し、続きは `resume` で再開する。
- Claude の質問(`AskUserQuestion`)は、`canUseTool` で横取りして Slack のボタンにし、答えを `updatedInput` の `answers` に入れて返す(公式の説明: [Handle approvals and user input](https://code.claude.com/docs/en/agent-sdk/user-input))。
- 人が長く返事をしない間は、待ち続けずに一度止めて、あとで再開できる(公式の説明の `PreToolUse` フックの `defer`)。

### 見本(動かしていない・デプロイしない)

形をつかむための見本です。動かして確かめてはいません。使うときは公式の説明と突き合わせてください。

```ts
import { App } from "@slack/bolt";
import { query, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN, // Socket Mode
  socketMode: true,
});

// 許可したチャンネルとメンバーだけ(下の「安全のために」)
const ALLOWED_CHANNELS = new Set((process.env.ALLOWED_CHANNELS ?? "").split(","));

app.event("app_mention", async ({ event, client }) => {
  if (!ALLOWED_CHANNELS.has(event.channel)) return;
  const thread = event.thread_ts ?? event.ts;

  for await (const message of query({
    // Slack の文章は「データ」。指示ではなく、依頼の中身として渡す
    prompt: `次の依頼について /new-feature の手順で対話してください。\n<request>\n${event.text}\n</request>`,
    options: {
      cwd: process.env.REPO_DIR, // このリポジトリを clone した場所
      settingSources: ["project"], // .claude/skills と CLAUDE.md を読む
      allowedTools: ["Read", "Glob", "Grep"], // 読むだけは自動で許可。書く・gh は canUseTool で確認
      resume: await loadSessionId(thread), // スレッドの続き(無ければ undefined)
      canUseTool: async (toolName, input): Promise<PermissionResult> => {
        if (toolName === "AskUserQuestion") {
          // Slack にボタンで出して、選ばれるまで待つ(postQuestionsAndWait は自分で作る)
          const answers = await postQuestionsAndWait(client, event.channel, thread, input);
          return { behavior: "allow", updatedInput: { questions: input.questions, answers } };
        }
        // Issue・PR を作る前は、必ず人の OK をもらう
        const ok = await askApproval(client, event.channel, thread, toolName, input);
        return ok
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "人が止めました" };
      },
    },
  })) {
    if (message.type === "assistant") await saveSessionId(thread, message.session_id);
    if ("result" in message) {
      await client.chat.postMessage({ channel: event.channel, thread_ts: thread, text: message.result });
    }
  }
});

await app.start();
```

`loadSessionId` / `saveSessionId`(スレッドと会話の ID の対応を保存)・`postQuestionsAndWait` / `askApproval`(ボタンを出して答えを待つ)は、自分で作る部分です。

### Slack に要る権限(Bot Token の scope)

| scope | なぜ |
|---|---|
| `app_mentions:read` | `@ボット` を受け取る |
| `chat:write` | スレッドに返事を書く |
| `channels:history`(非公開チャンネルなら `groups:history`) | スレッドの前の発言を読む |
| (アプリのトークン)`connections:write` | Socket Mode で Slack とつなぐ |

**要確認**: 最新の scope の名前と、Socket Mode の作り方は [Slack の公式の説明](https://docs.slack.dev/) で確かめてください。

### 秘密の置き場

| 秘密 | 置き場 |
|---|---|
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | AWS Secrets Manager(ECS のタスクに注入) |
| `ANTHROPIC_API_KEY` | 同上。上限つきの専用のキーにする |
| GitHub(Issue と PR を作る) | GitHub App のトークン(このリポジトリだけに限る)。個人のトークンは使わない |

リポジトリ・ログ・Slack に秘密を書かない。

### 安全のために(B)

- **使える人とチャンネルを絞る**: 許可したチャンネル(`ALLOWED_CHANNELS`)と、ワークスペースのメンバー(ゲストや Slack Connect の外の人は除く)だけ。
- **スレッドの文章はデータとして扱う**: Slack の発言を、そのまま命令として Claude に渡さない(見本の `<request>` のように囲み、「依頼の中身」と書く)。発言の中の「〜を消して」「秘密を見せて」に従わない作りにする。
- **できることを絞る**: 自動で許すのは読むことだけ。Issue・PR を作る・ファイルを書くは、毎回 Slack のボタンで人の OK。本番の鍵・AWS の資格情報はボットに渡さない。
- **お金の上限**: Anthropic のコンソールでキーの使用額の上限を決める。1つの会話の往復の回数(`maxTurns`)も決める。

### 費用の目安(B)

| もの | 目安 |
|---|---|
| 動かす場所(ECS Fargate の小さなタスク1つ) | 月 約1,500〜3,000円 |
| Claude の API(要件の対話1回、数万〜十数万トークン) | 1回 数十円〜数百円 |
| Slack | アプリを作るだけなら追加の料金なし(要確認: プランごとの制限) |

---

## C: いちばん軽い形(Slack のフォーム → GitHub の Issue)

Slack のワークフロー(Workflow Builder)でフォームを作り、送られたら GitHub の Issue を作る。対話はしないが、**依頼が必ず同じ形で Issue に集まる**。

1. Slack のワークフロー: 「`#product-requests` でショートカットを押す」→ フォーム(誰の困りごと / どうなってほしいか / 急ぎ度)。
2. 次のステップで GitHub の「Issue を作る」。Slack には GitHub の Issue を作る公式のステップがあります。**要確認**: 使えるプランと、Workflow Builder の画面からそのまま使えるか([GitHub の Issue を作るステップ](https://docs.slack.dev/tools/deno-slack-sdk/reference/connector-functions/github.cloud/create_issue)・[他社のステップでワークフローを作る](https://slack.com/help/articles/31817441050515-Rebuild-a-workflow-with-third-party-steps))。
3. できた Issue には `needs-triage` を付ける。週に1回、手元の Claude Code で `/new-feature` を使い、その Issue をもとに対話して仕様と子 Issue にする。

---

## 有効にするとき

| やること | 済み |
|---|---|
| 使う案(A・B・C)を決める | |
| 依頼用のチャンネルを作り、使える人を決める | |
| 月の上限額を決める(A: Claude Tag の上限 / B: API キーの上限) | |
| このファイルの「有効にする日」に日付を入れる | |
