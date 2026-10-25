# 手順書: 基盤(Node.js・PostgreSQL・土台のイメージ)に重い穴が出た

> 依存のパッケージの穴は `/cve` と Renovate で上がる。**基盤の穴は、上げただけでは本番に届かない**(動いているイメージを作り直して出し直すまで残る)。この手順は、`/cve` で「基盤」と判定したあとに使う。考え方は [../guides/vulnerabilities.md](../guides/vulnerabilities.md)。
> 本番に出す・止めるのは人。AI は確かめたコマンドを渡すまで(`CLAUDE.md`)。

## 0. 最初の15分: どこに当たるかを見分ける

| どこ | このキットでの入り方 | 直った版が入るには |
|---|---|---|
| 画面と API のイメージの Node.js | `apps/*/Dockerfile` の `FROM node:<系列>-…`(作る段)と `gcr.io/distroless/nodejs<系列>-…`(動く段)。**版を固定しないタグ** | 土台のイメージが直った版で出直してから、イメージを作り直す |
| CI の Node.js | `.node-version` の系列(例 `24`)の最新を `setup-node` が入れる | 次の CI から自動で入る |
| 手元の Node.js | 人の端末(mise など)。**Renovate は見ない** | 人が上げる(下の 4) |
| PostgreSQL | Aurora の版(`infra/terraform/modules/aurora`)・手元とテストのイメージ | 版を上げる PR(危険度「高」)と、保守の時間 |

- 修正の前でも、外から届く穴なら **止める** ことを考える(WAF のルール・機能を止める。[../guides/vulnerabilities.md](../guides/vulnerabilities.md) の 5 の 4)。止めるのは人。

## 1. 土台のイメージが直ったかを確かめる

1. 公式の発表で、直った版の番号を確かめる(例: 24 系なら 24.x.y)。
2. 作る段のイメージ(`node:<系列>-…`)と、動く段の distroless の両方で、直った版が出たかを確かめる(distroless は少し遅れることがある)。まだなら、1 の止める手を先に。

## 2. 作り直す

1. main で CI の `image` を流し直す(または、Dockerfile に触らない空の PR で作り直す)。Trivy の image の検査が、穴が消えたことを確かめる。
2. 出来たイメージの中の版を確かめる(CI のログ・`docker run --rm <イメージ> --version` は distroless では動かないので、作る段のログで)。

## 3. 出し直す

1. `deploy.yml` で stg に出し、疎通を確かめる。
2. prod は Environment の承認(人)。ECS の blue/green で入れ替わる。
3. 出した日と、直った版を、精査の記録(`docs/security/vulns.md`)に1行。届く・まだ直していない穴の中身は書かない。

## 4. 手元の処理系も上げる

- 例(mise): `mise upgrade node` → `node -v` で確かめる。
- ⚠️ pnpm を corepack で入れていると、Node.js を上げたとき pnpm が見えなくなることがある(古い版の側にだけ入っていた)。`corepack enable` をやり直す → `pnpm -v`。
- ほかの古い Node.js(別のインストーラーで入れた物)が PATH の先にいないかも確かめる(`where node` / `which -a node`)。

## 5. 終わり方

- 本番・stg・CI・手元の4つで直った版になったことを、Issue か運営の記録に残す。
- 半年ごとの点検の「サポートの期限」と「大きい版の更新」も見る(点検の台帳)。
