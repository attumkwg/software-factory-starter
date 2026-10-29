# キットの新しい版を取り込む

> キットから作ったリポジトリに、キットの直し(穴・守り・手順)を届ける手引き。決まりは [仕様 0067](../specs/0067-kit-upstream.md)・[設計書 0067](../designs/0067-kit-upstream.md)。
> 版の付け方(どの数字が上がると手が要るか)は [maintenance.md](maintenance.md) の 4。変更の中身はキットの `CHANGELOG.md`。

## 0. いつ気づくか

- 🗓 **点検**: 月に1回、`/checkup` の項目 `kit-upstream` が、取り込んだ版([upstream.yaml](upstream.yaml) の `version`)とキットの最新の版(GitHub のリリース)を比べて、新しい版があれば知らせる。
- 🧰 **`pnpm setup:github`**: 最後の「人がやること」にも同じ文が出る(キットにまだ版が無い間は、作った後に更新があったかを日付で)。
- 🔒 **穴を直した版**は、キットのリポジトリの勧告(Security Advisories)にも出る。キットのリポジトリを Watch → Custom → Releases・Security alerts にしておくと、メールで届く。

## 1. 用意(1回だけ)

キットを clone して作ったなら、`kit` の remote が残っている(README の始め方の 2)。無ければ足す:

```bash
git remote add kit https://github.com/attumkwg/software-factory-starter
```

🔢 **番号の範囲**: キットの仕様・設計書・ADR は 0001〜4999 だけを使い、自分の記録は別の範囲(既定は 5000 から)で振る([docs/kit/numbering.yaml](numbering.yaml)・[仕様 0091](../specs/0091-own-number-range.md))。範囲が重ならないので、キットの新しい版を取り込んでも同じ番号はできない。始まりは使い始めるときの `pnpm checkup:adopt` が決める(`--numbers-from 6000` で変える)。先に adopt を済ませていて、`pnpm adr` が「キットの範囲 〜4999」と出すなら、取り込む前に一度だけ `pnpm adr --own-from 5000` を流して PR にする。範囲を決める前に自分で振った番号(キットの範囲の中)は、キットの次の版と重なりうるので、そのとき `pnpm adr` の「次の番号」に振り直す(docs・コードのコメント・カタログの参照も直す)。範囲が重なる設定・キットの範囲と自分の範囲の間の番号は、`pnpm adr` が CI で落とす。

## 2. 何が変わったかを読む

```bash
git fetch kit --tags
```

```bash
git tag -l "v*" --sort=-v:refname
```

```bash
git show v0.3.0:CHANGELOG.md
```

- 読むのは、いま([upstream.yaml](upstream.yaml) の `version`)より新しい版の節の **「取り込むときにすること」** と「セキュリティ」。
- **1版ずつ**取り込む(手が要る版 — 0. の間は2つ目の数字が上がった版 — を飛ばさない)。直しだけの版(3つ目の数字だけ)は、まとめてよい。

## 3. 取り込み方を選ぶ

| あなたのリポジトリ | 取り込み方 | 手間 |
|---|---|---|
| キットを clone して作り、`/tailor` で消した部品が少ない | **A. 版をまるごと merge** | 小 |
| 部品をたくさん消した・大きく書き換えた | **B. 版の差分を、要る場所だけ当てる** | 中 |
| 穴の直しだけを急いで入れたい | **C. 直しのコミットだけ cherry-pick** | 小 |
| clone せずにファイルを写して作った(履歴がつながっていない) | B(差分をファイルで当てる) | 中 |

### A. 版をまるごと merge

```bash
git switch -c kit/v0.3.0
```

```bash
git merge v0.3.0
```

- ぶつかったら:
  - 🗑 **自分で消した部品**(`docs/product/tailoring.md` で「消す」)のファイルが「deleted by us」で出る → 消したまま(`git rm <ファイル>`)。
  - ✏️ **自分で変えた所**(題材の領域・画面・`docs/product/`)→ 自分の方を残し、キットの直しの意図(CHANGELOG の行)だけを足す。
  - 📋 **点検の台帳** `docs/checkup/todo.yaml` → 項目の `status`・`history`・`owners`・`started_on` は自分の方を残し、新しい項目と文はキットの方を取る。
- merge すると [upstream.yaml](upstream.yaml) の `version` もキットの版に変わる(自分で直さなくてよい)。
- PR は **squash** でマージする(ルールセットが直線の履歴を求めるので、merge のコミットは squash でまとめる)。

### B. 版の差分を、要る場所だけ当てる

```bash
git switch -c kit/v0.3.0
```

```bash
git diff v0.2.0 v0.3.0 -- . ':!apps/api/src/domains' ':!docs/product' > kit.patch
```

```bash
git apply --3way kit.patch
```

- `-- .` の後ろに、当てない場所を `':!<パス>'` で並べる(自分で消した部品・題材の領域・`docs/product/`)。
- 当たらなかった所は `--3way` がぶつかりの印を付ける。A と同じ考えで解く。
- 最後に [upstream.yaml](upstream.yaml) の `version` を `v0.3.0` に直す。`kit.patch` はコミットしない。

### C. 直しのコミットだけ cherry-pick

```bash
git cherry-pick -x <キットのコミット>
```

- コミットは CHANGELOG の「セキュリティ」の行の PR から。`-x` で、どのキットのコミットかが残る。
- 版をまるごと取り込んだことにはならないので、`version` は**直さない**(点検は次の版を知らせ続ける)。

## 4. 確かめて PR にする

- 「取り込むときにすること」を全部やる(移行・`pnpm setup:github --apply` の流し直しは、マージの後に人が)。
- `pnpm install` → `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm guards` → `pnpm setup:check`。
- PR の題を「キットの v0.3.0 を取り込む」にし、本文に取り込んだ版の CHANGELOG の節へのリンク。守るパス(`.claude/hooks`・CI・`CLAUDE.md`)が変わるので**危険度は「高」**になる(人が見る)。
- 🤖 Claude Code に頼むなら: 「`docs/kit/upgrade.md` の手順で、キットの v0.3.0 を取り込んで。消した部品は `docs/product/tailoring.md`」。ぶつかりの解き方に迷った所は PR の「人に判断してほしい所」に書かせる。

## 5. 取り込まないと決めたとき

- その版の点検の知らせを止めたいときは、[upstream.yaml](upstream.yaml) の `version` を新しい版にして、PR の本文に「取り込まなかった理由」を書く(後で読み返せるように)。穴の直しは、取り込まない理由が無い限り入れる。
