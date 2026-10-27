# 人が見ていない所で AI を回す(夜・長い作業・背景の AI)

> 決まりは [docs/security.md](../security.md) の AI-1〜AI-6(特に AI-2「外に出られる先を絞る」)。設計は [designs/0057](../designs/0057-ai-egress.md)・ADR [0068](../adr/0068-ai-egress-by-where-it-runs.md)・[0069](../adr/0069-background-ai-runs-integration-tests.md)。
> 人が見ているときは、道具の確認(フック・権限の確認)が止める([local-guards.md](local-guards.md))。**人が見ていないときは確認が止めないので、外へ送る手段そのものを持たせない所でだけ回す。**

## どこで回すか(この2つだけ)

| 場所 | 外への通信 | 結合テスト・E2E | 向いている作業 |
|---|---|---|---|
| ① **絞った devcontainer**(`.devcontainer/`) | 許可リストのプロキシだけ(npm・GitHub・モデルの API・コンテナの置き場など。`.devcontainer/egress/allowlist.txt`)。ほかは firewall が止める。中の Docker のコンテナから外へは出られない | 中の Docker で回る(結合・E2E・VRT) | 手元で長く任せる作業・夜の作業 |
| ② **背景の AI**(`.github/workflows/claude.yml`。Actions) | Web を読む・調べる道具(WebFetch・WebSearch)は持たない。MCP は GitHub の物だけ(このリポジトリだけ)。結合テストのコンテナは外へ出られない(`block-container-egress.sh`) | 結合テストは PR の前に自分で回す。E2E は CI | Issue から PR を出す作業 |

- **Windows・mac のそのままの手元(devcontainer を使わない)では、人が見ていない作業を回さない**。OS では絞っていない(設計書 0057 の U-1)。
- 調べ物(Web を読む)が要る作業は、人が見ている対話の AI か人がする。背景の AI は、PR に問いを書いて人に渡す。

## ① 絞った devcontainer で回す

1. VS Code の「Reopen in Container」(か devcontainer の CLI)で開く。最初の起動で `egress-up.sh` が絞りを入れ、`外への通信を絞りました(許可リスト: N 件…)` と出る。**出なければ回さない**。
2. 中では、開発の利用者(node)の `sudo` は使えない(使えるのは `sudo /usr/local/share/egress/egress-up.sh` だけ)。apt で物を足すなら `.devcontainer/Dockerfile` を直して作り直す(PR。危険度「高」)。
3. AI に任せる。終わったら、止めた宛先を見る:
   ```bash
   bash .devcontainer/egress/blocked.sh
   ```
4. 止まった宛先が仕事に要る物なら、`allowlist.txt` に足す PR を出す(危険度「高」。**足すかは人が決める**)。だれでも使える保存先(クラウドの保存先・ファイルの共有)は、なるべく足さない(作るときに入れる・手元で取ってくる、を先に考える)。

## ② 背景の AI で回す

1. Actions → Claude → Run workflow(main を選ぶ)。起動できるのはリポジトリの持ち主だけ(AI-3)。
   - 頼む文に Issue・PR の番号があると、前の段「AI に読ませる文章の書き手」が、その本文・コメント・レビューの書き手を確かめる。**書き込めない人(外の人)の文章が1つでもあれば動かない**。中身を人が読んで、自分の言葉で新しい Issue に書き直し、その番号で頼む(外の人の文章は貼らない)。
   - 最初に動かすときは、Actions のログで ① 「Run Claude Code Action」の環境に `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: 1` がある ② 「bubblewrap」の手順が通った ③ 後ろの段「AI が書いた文章の秘密」が通った、を見る(本物の鍵で試すのはこの時だけ。設計書 0060 の 8)。
2. AI は結合テストを通してから PR を出し、E2E は CI の結果を読む。直すのは2回まで(CLAUDE.md)。
3. 道具を足す(`--allowedTools`)・外す(`--disallowedTools`)のは `claude.yml` を直す PR(危険度「高」)。

## 回した後に見ること

- **PR の「🚪 外へ出した物」**(`pnpm outbound` が記録 `.claude/outbound.log` から表にする)。**「頼まれていたか」が「いいえ」の行**を1つずつ見る。要らない手段なら、次から持たせない(道具の一覧・許可リストを直す)。
- 止まった宛先(①の `blocked.sh`)。止まったこと自体は守りが効いた印。AI がそれを避ける道を探していないかを見る。
- AI が「消えた」「戻せない」と言っても信じない。データはバックアップや記録で人が確かめる([runbooks/db-restore.md](../runbooks/db-restore.md) など)。AI は本番に入れない(AI-1)。

## わざと残る穴(知っておくこと)

- ② の背景の AI で、テストを動かす Node(Actions のホスト)は外へ出られる(外の部品なしでは絞れない。ADR 0069)。
- ② の背景の AI で、GitHub のトークンは Bash から見える(`gh` とブランチへの送り出しに要る。ジョブの間だけ使え、権限は `claude.yml` の `permissions` まで)。頼まれていない番号の Issue・PR を AI が読むのは、頼む文で止めているだけ(設計書 0060)。
- ① の許可リストに、だれでも使える保存先の名前がある(Docker の置き場が使う R2)。名前だけでは区別できない。
- ① のプロキシは宛先の名前で決める(TLS の中は見ない)。中の Docker で `--network host` とプロキシと同じ利用者の番号を使えば、わざと抜けられる(うっかり送るのは止まる)。
