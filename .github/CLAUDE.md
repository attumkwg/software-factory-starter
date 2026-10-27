# .github のルール

> 全体のルールはルートの `CLAUDE.md`。ここは全部が危険度「高」(人の承認が要る)。

- `.github/setup.yml`・`.github/labels.yml` … GitHub の設定とラベルの正(ADR 0027)。**ラベルを使う物を足したら `labels.yml` に1件(意味・誰が・いつ・付いたらどうするか)・ジョブの名前を変えたら `required_checks` も**(無ければ CI が落ちる。`pnpm setup:check`)。ラベルの手引き `docs/guides/labels.md` は `pnpm setup:labels` で作り直す。
- PR に「マージの後に人がやる設定」を書かず、設定ファイルを直す(マージの後に人が `pnpm setup:github --apply`。**AI は試しまで**)。`docs/guides/github-setup.md`。
- 定期で動くワークフローは `vars.KIT_ROLE == 'product'` のときだけ(ひな形では運用を回さない)。例外は `setup.yml` の `template_schedules`。
- Actions を足したら `docs/compliance/vendors.yaml` に1行(無ければ CI が落ちる)。Action は SHA で固定する。
- 危険度「高」の場所の一覧(`.claude/hooks/protected-paths.json`)を変えたら、`labeler.yml` の `risk:high` と `CODEOWNERS` にも足す(`pnpm guards`)。
