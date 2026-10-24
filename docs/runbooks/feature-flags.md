# 組織に機能を入れる・切る(機能フラグ)

> 仕様: [specs/0012](../specs/0012-feature-flags-and-usage.md)・仕組み: [guides/feature-flags.md](../guides/feature-flags.md)。
> **本番の DB に書く操作**(`platform.feature_flags` と監査ログに足す・消す)。人が打つ。AI は打たない。

## いつ

- 賭けの `psf` / `rollout` で、選んだ組織に機能を出すとき・外すとき。
- 機能の定義(`FEATURE_FLAGS`)が `rollout` で、その PR がデプロイされた後(定義に無い名前・`on` / `off` の機能は、コマンドが止める)。
- **全部の組織で止めたいとき(障害)は、このコマンドではない。** 定義の状態を `off` にする PR を出してデプロイする([incident.md](incident.md) の 2)。

## 手順

ECS の API のイメージで、移行と同じ接続(表の持ち主)を渡して流す(`legal-notify` と同じ)。

1. いまの状態を見る:
   ```bash
   node dist/cli.js feature-flag <組織の ID>
   ```
   `{"mode":"show","tenantId":"…","flags":[{"name":"morning-digest","state":"rollout","enabled":false},…]}`。組織が無ければ止まる。
2. 試し(何も変えない):
   ```bash
   node dist/cli.js feature-flag <組織の ID> morning-digest on
   ```
   `{"mode":"plan",…,"enabled":false,"next":true,"changed":true}`。もう入っていれば `"mode":"unchanged"`。
3. 組織の ID と機能の名前をもう一度確かめて、変える:
   ```bash
   node dist/cli.js feature-flag <組織の ID> morning-digest on --execute
   ```
   `{"mode":"changed",…}`。その組織の監査ログに「仕組み(自動)が 機能を入れた(morning-digest)」が残る。
4. 効いたかを見る: その組織の人が次に画面を開いたとき(`GET /api/me` の `features`)から出る。代理ログインで見て確かめてもよい。
5. 外すときは `on` を `off` にして同じ手順。

## 記録

- 何組織に出したかを、賭けの小石に数で書く(組織の名前・ID は書かない)。どの組織に出したかは、運営の記録(チケットなど)に残す。
- 誰がコマンドを打ったかは、ECS のタスクの記録(CloudTrail)に残る。
