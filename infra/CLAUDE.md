# infra のルール

> 全体のルールはルートの `CLAUDE.md`。ここは全部が危険度「高」(人の承認が要る)。

- `infra/terraform` … AWS(modules と envs)。**apply はしない**(人が CI で行う)。
- AWS のリソースにはタグ `Component`(provider の別名で付ける)と `Bet`(費用のページが読む。`docs/guides/cost-dashboard.md`)。
- **新しい種類の AWS の資源を足したら `docs/compliance/vendors.yaml` に1行**(無ければ CI が落ちる)。
- AWS の管理操作の記録は `modules/audit-trail`(手順は `docs/runbooks/audit-trail.md`)。
- 本番の AWS に書き込む操作(戻す・入れ替える・止める)を自分で打たない。手順書(`docs/runbooks/`)のコマンドを、確かめた形で人に渡す。
