# 考え方(このキットが何を前提に作られているか)

> このキットの作りの「なぜ」の本体。ADR・仕様・設計書・コードのコメントが根拠として引くのは、ここと [../security.md](../security.md) の決まり。
> 書いてあるのは **2026-10 時点の意見**。AI エージェントまわりは動きが速いので、変わったら直す(ここは「いまの正」)。

## いまの結論

- **段階で作り込みを変える**: PMF の前は「雑でいい所は雑に、取り返せない所だけ固く」。PMF の後にラインを全部そろえ、規模が大きくなったら領域ごとに分ける。→ [stages.md](stages.md)
- **取り返せない所はどの段階でも固く**: テナント分離(全テーブルにテナント ID+RLS)・認証は製品に任せる・秘密情報と OIDC・バックアップと戻せることの確認・領域の境界。→ [stages.md の「雑にしてはいけない所」](stages.md#pmf-の前-雑でいい所と雑にしてはいけない所)・[../security.md](../security.md)
- **技術の既定**: TypeScript 一本のモノレポ / AWS は ECS Fargate+Aurora PostgreSQL / Terraform / GitHub Actions(OIDC)/ Claude Code。→ [line.md の 3](line.md#3-技術の既定)
- **流れは7工程、人が必ず止まるのは仕様の承認と危険度「中・高」のレビュー**。ハーネス(AI を動かす仕組み)は3層で育て、いきなり自前の工場を作らない。→ [line.md](line.md)
- **人はラインと取り返せない判断を持ち、AI はラインの上を流れる物を作る**。任せる範囲は数字を見て1段ずつ広げる。→ [people-and-ai.md](people-and-ai.md)
- **どれだけ回せるかは、AI ではなく人のレビューと仕様の量で決まる**。だから危険度で人の出番を絞る。→ [line.md の 6](line.md#6-どれだけ回せるか)
- **作るより持つほうが長い**。落ちても戻る作り・ログ・点検表で長く回す。→ [running.md](running.md)

## 地図

| ファイル | 中身 | 読むとき |
|---|---|---|
| [line.md](line.md) | ラインの作り: 5つの原則・7工程・技術の既定・ハーネス3層・危険度で分けるレビュー・どれだけ回せるか・体制・測るもの・やらないこと | 最初に |
| [stages.md](stages.md) | 段階(PMF の前 → 後 → 規模拡大)・雑でいい所と、いけない所・最初の日に決めておく8つ・規模の段階表・段階ごとの月の費用 | 何をどこまで作るか迷ったとき・費用を見積もるとき |
| [people-and-ai.md](people-and-ai.md) | 人と AI の分担: 4段の分け方・立ち上げ時点の分担表・AI にやらせないこと・任せる範囲を広げる条件 | 体制を決めるとき・任せる範囲を変えるとき |
| [running.md](running.md) | 長く回す: 落ちても戻る作り・ログの残し方と種類・監視の型・プレビュー環境の安全・E2E の厚さ・Terraform を選んだ理由・点検表 | 本番を出す前に |
| [../security.md](../security.md) | セキュリティの決まり(AI ならではの守り・認可・テナント分離)と、何を確かめていて何を確かめていないか | 設計と公開の前に |

## このキットのどこに当たるか

工程・危険度・ハーネス・テナント分離・権限の表・プレビュー環境・検査が、このキットのどのファイルで実現されているかの対応表は、[reference の「🧭 考え方とこの雛形の対応」](../reference.md#-考え方とこの雛形の対応)。

## 下敷きにした公開の事例

各社が公開している話を下敷きにしている(どれも 2025〜2026 年の公開記事)。

- Stripe: AI エージェントが週に千件を超える PR を出す仕組み(決まった手順は仕組みで、考える所だけ AI)・影響範囲だけ回すテスト。[Minions](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2)・[選んで回すテスト](https://stripe.dev/blog/selective-test-execution-at-stripe-fast-ci-for-a-50m-line-ruby-monorepo)
- Ramp: AI が本物と同じ環境で自分で確かめる・PR は頼んだ人の名前で作る・「見える使い方」で広める。
- freee: 仕様駆動(1 Issue = 1 PR)・人に見せるのは判断すべき所だけ・AI エージェントによる脆弱性診断。[数字で振り返る AI 駆動開発](https://developers.freee.co.jp/entry/ai-driven-development-2025-report)・[脆弱性診断 with AI エージェント](https://developers.freee.co.jp/entry/we-have-started-AI-agent-security-test)・[AI agent を活用した開発プロセスと人間の認知限界](https://developers.freee.co.jp/entry/ai-dev-and-cogsci)
- AWS: [SaaS Lens(テナント分離の考え方)](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/saas-lens.html)
