# 手順書: Sentry に失敗が来た

> Sentry には **手がかり**(どの API・誰・どの版・スタック・requestId)だけを送っている。**中身(そのリクエストで何が起きたか)は自分の AWS のログで見る**(ADR 0011)。
> Sentry の1件 → ログ → 会社と人 → 直す、の順に進める。

## 1. Sentry の画面で見るもの(1分)

| 見る所 | 分かること |
|---|---|
| タイトル(種類と文) | 何が起きたか。文の値は `[…]` `[email]` に伏せてある |
| タグ `route` | **どの API か**(例 `POST /api/projects/:projectId/tasks`)。ブラウザの失敗はタグ `service=browser` と URL(`?` 以降なし)で、どの画面か |
| タグ `code` | API の失敗の種類。`internal` = こちらのバグ / `service_unavailable` = DB などが一時的に使えない([alarms.md](alarms.md) へ) |
| 「Users」の数 | **何人が困ったか**(users の ID で数えている) |
| `release` | どの版から出始めたか(git の SHA)。「First seen」の版と、直前の版を比べる |
| スタック | どのファイルの何行目か(API と画面のサーバーはソースマップで元の TS の行) |
| 件数のグラフ・`environment` | 1件だけか、増え続けているか。stg か prod か |

- **増え続けている・prod・人数が多い** → まず戻すか決める([alarms.md](alarms.md) の「最初の3分」)。原因はそのあと。
- **1件だけ・stg** → 急がない。Issue にして AI に渡してもよい(requestId・タグ・スタックを貼る。ログの中身・「User」の欄の写しは貼らない。[compliance/ai-data.md](../compliance/ai-data.md))。

## 2. そのリクエストのログを全部見る(3分)

Sentry の1件の「Contexts」→ **logs** の「Logs Insights(このリクエストの全部の行)」を開く。前後15分・API と画面のサーバーの両方のロググループで、その requestId の行が時刻順に並ぶ。

リンクが無いとき(ブラウザの失敗・リンクの設定が無い環境)は、Logs Insights で `/ecs/<名前>` と `/ecs/<名前>-web` を選んで:

```
fields @timestamp, service, level, message, method, route, path, status, durationMs, err.type, err.message
| filter requestId = "<タグの requestId>"
| sort @timestamp asc
```

読み方:

| 行 | 分かること |
|---|---|
| `service=web` の `request` | 利用者が開いた画面(path)・画面のサーバーの status |
| `service=api` の `request` | API の受け付け(route・path・status・かかった時間) |
| `level=error` の `失敗しました` | 失敗の中身(`err.type`・`err.message`。SQL は `$1` のままで値は無い) |
| `level=warn` | その前に起きていたこと(DB の接続が切れた等) |

- 同じ失敗がほかのリクエストでも起きているか: `filter route = "<タグの route>" and level = "error" | stats count() by bin(5m)`
- ブラウザの失敗には requestId が無い。画面(URL)と時刻から、`service=web` の行を探す。

## 3. 誰の・どの会社のことか(必要なときだけ)

タグの `tenantId` と Sentry の User の ID(users の ID)を、表の持ち主で引く:

```sql
SELECT t.name AS organization, u.name, u.email
FROM organizations.users u JOIN organizations.tenants t ON t.tenant_id = u.tenant_id
WHERE u.id = '<User の ID>';
```

- 調べるのに必要なときだけ。結果をチャット・Issue・PR に貼らない(他社の情報)。
- お客さんに連絡するなら、問い合わせ番号(requestId)を伝える。

## 4. 直す

| 原因 | どうするか |
|---|---|
| 直前の版から出始めた | 前の版に戻す → 直してから出し直す。`git log <前の版>..<その版>` で入った変更を見る |
| 特定の会社・データのときだけ | ログの route と path から、どのデータで起きるかを再現する(手元の種データで) |
| DB・外の仕組み(`service_unavailable`) | Sentry ではなく [alarms.md](alarms.md) の DB・RDS のイベントへ |
| ブラウザだけ(`service=browser`) | URL の画面を手元で開いて再現する |

直したら:
- 同じ失敗を止めるテストを足す(CLAUDE.md の「AI が同じ失敗をした所 → テスト・lint」)。
- Sentry の1件を「Resolved in next release」にする(次の版で再び出たら、自動で開き直る)。

## 5. Sentry に何を送っていないか

本文・Cookie・ヘッダー・URL の `?` 以降・メールアドレス・IP・パンくず。だから **Sentry だけでは原因まで分からないことが多い**のは仕様。2. のログで補う。送る項目を足したくなったら [guides/monitoring.md](../guides/monitoring.md) の「Sentry」と `packages/error-reporting/src/scrub.ts` を一緒に直す(値になる物は足さない)。
