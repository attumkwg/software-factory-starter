# 手順書: 1人が複数の組織に入る形を本番に出す(移行 0018 → 1週間 → 0019)

> 仕様は [specs/0055-multi-org-membership.md](../specs/0055-multi-org-membership.md)・設計書 0055 の 2 と U-3・[ADR 0066](../adr/0066-multi-org-membership.md)。
> 持ち主の決め(@attumkwg 2026-10-25): **本番では ①② を出して1週間見てから ③ の移行を流す。③ は戻せない**。
> 本番に出す・移行を流すのは人(deploy.yml)。AI は打たない。

## 0. なぜ2回に分けるか

| 段 | 移行 | 中身 | 戻せるか |
|---|---|---|---|
| ①② | `0018_multi_org_expand`・`concurrent/0018_multi_org_keys` | 組織ごとの一意の索引を足す・アプリが両方の形で動く(ログインは前回の組織・組織の切り替え) | 戻せる(前の版のアプリに戻すだけ。足しただけなので) |
| ③ | `0019_multi_org_contract`・`concurrent/0019_drop_global_user_keys` | **全体で一意のメールと sub を外す**。この後は、招待で2つ目の所属ができる | **戻せない**(2つ目の所属ができた後は、全体の一意を張り直せない) |

①② で問題(ログイン・切り替え・招待・メールの変更)が見つかれば、③ の前なら前の版に戻すだけで済む。③ の後に見つかった問題は、先へ直すしかない。

## 1. ①② を本番に出す

1. 0018 までで 0019 を含まない版を選ぶ(main の、移行 0019 が入る前のコミット)。タグを付けておく(例 `multi-org-expand`)。
2. deploy.yml を手で流す(Actions → deploy → Run workflow の「Use workflow from」でそのタグ)。stg → prod の順はいつもどおり。
3. 移行が通ったことを確かめる(表の持ち主で `select max(id) from drizzle.__drizzle_migrations`・`drizzle.concurrent_migrations` に 0018 の索引)。

**main がもう 0019 を含んでいる**(キットを後から取り込んだなど)なら、main をそのまま出さない。上の 1 のとおり 0019 の前のコミットを出す。

## 2. 1週間見る

毎日(点検の Issue のついでで足りる)、次を見る。どれかが崩れていれば ③ に進まない。

- ログインの失敗が増えていない(Sentry・ログの `ログインに失敗` の件数。名前・メールは見ない)
- 組織の切り替え(`auth.switch_in`・`auth.switch_out`)の監査ログが出ていて、エラーが増えていない
- 招待を受ける・メールを変えるの失敗が増えていない
- お客さんからの「入れない・違う組織が出る」の問い合わせが無い

## 3. ③ を流す(戻せない。2人で)

1. 2 の結果を2人で確かめ、作業の記録に「③ を流す」と残す。
2. 直前に DB のスナップショットを取る([db-restore.md](db-restore.md) の 1。③ は索引を消すだけで値は消さないが、念のため)。
3. 0019 を含む版を deploy.yml で出す(stg → prod)。
4. 確かめる: 全体の一意の索引 `users_email_key`・`users_external_id_key` が無く、組織ごとの `users_tenant_email_key`・`users_tenant_external_id_key` があること。
5. この後に問題が見つかったら、移行は戻さない([deploy-rollback.md](deploy-rollback.md) の 2.2。逆の移行は書けない)。アプリだけを前の版に戻すのはよい(②の版のアプリは ③ の形でも動く)。
