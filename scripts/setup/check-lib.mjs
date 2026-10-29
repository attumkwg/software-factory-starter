// pnpm setup:check の中身。GitHub を読まずに、.github/setup.yml・labels.yml とコードのずれを見る。
// ファイルは引数の src(list・read)で受け取る(テストで差し替えるため)。決まり: docs/designs/0014-setup-before-use.md の 3.
import { validateLabels, validateSetup } from "./config.mjs";
import { LABELS_GUIDE, renderLabelsGuide } from "./labels-doc.mjs";
import {
  labelsInIssueTemplate,
  labelsInLabeler,
  labelsInRenovate,
  labelsInText,
  ROLE_GATE,
  readWorkflow,
} from "./usage.mjs";

const isTest = (f) => /\.test\.(mjs|ts)$/.test(f);

/** 使われているラベル: Map<名前, 使っているファイルの並び> */
export function usedLabels(src) {
  const used = new Map();
  const add = (file, names) => {
    for (const n of names) used.set(n, [...(used.get(n) ?? []), file]);
  };
  const labeler = ".github/labeler.yml";
  if (src.read(labeler)) add(labeler, labelsInLabeler(src.read(labeler)));
  for (const f of src.list(".github/ISSUE_TEMPLATE").filter((f) => /\.ya?ml$/.test(f)))
    add(f, labelsInIssueTemplate(src.read(f)));
  if (src.read("renovate.json"))
    add("renovate.json", labelsInRenovate(JSON.parse(src.read("renovate.json"))));
  const texts = [
    ...src.list(".github/workflows").filter((f) => /\.ya?ml$/.test(f)),
    ...src.list(".github/scripts"),
    // scripts/setup はこの確かめそのもの(コメントの例を拾わない)
    ...src
      .list("scripts")
      .filter((f) => f.endsWith(".mjs") && !isTest(f) && !f.startsWith("scripts/setup/")),
    ...src.list(".claude/skills").filter((f) => f.endsWith(".md")),
  ];
  for (const f of texts) add(f, labelsInText(src.read(f)));
  return used;
}

function checkLabels(labels, src) {
  const known = new Set(labels.map((l) => String(l.name).toLowerCase()));
  const used = usedLabels(src);
  const problems = [];
  for (const [name, files] of used)
    if (!known.has(name.toLowerCase()))
      problems.push(
        `ラベル ${name} が .github/labels.yml に無い(使っている所: ${[...new Set(files)].join("・")})`,
      );
  const usedNames = new Set([...used.keys()].map((n) => n.toLowerCase()));
  const unused = labels.map((l) => l.name).filter((n) => !usedNames.has(n.toLowerCase()));
  return { problems, unused };
}

const readWorkflows = (src) =>
  src
    .list(".github/workflows")
    .filter((f) => /\.ya?ml$/.test(f))
    .map((file) => ({ file, ...readWorkflow(src.read(file)) }));

const jobNames = (workflows) => new Set(workflows.flatMap((w) => w.jobs.flatMap((j) => j.names)));

function checkRequired(setup, workflows) {
  const names = jobNames(workflows.filter((w) => w.pullRequest));
  // マージキューの中(merge_group)で流れない必須のチェックがあると、キューは返事を待って PR を外し続ける。
  // キューを入れる前から見ておく(入れる日に必須を外して守りを弱めないため。仕様 0095)
  const queuedJobs = workflows.filter((w) => w.mergeGroup).flatMap((w) => w.jobs);
  const queued = new Set(queuedJobs.flatMap((j) => j.names));
  // キューの中で if に飛ばされたジョブは「成功」を返すので、確かめずに入る
  const skipped = new Set(
    queuedJobs
      .filter((j) => PR_ONLY_IF.test(j.if) && !/merge_group/.test(j.if))
      .flatMap((j) => j.names),
  );
  return setup.ruleset.required_checks.flatMap((c) => {
    if (!names.has(c))
      return [`必須のチェック「${c}」が、PR で動くジョブの name に無い(名前を変えた・消した?)`];
    if (!queued.has(c))
      return [
        `必須のチェック「${c}」のワークフローに merge_group が無い(マージキューの中で流れず、キューが止まる。docs/runbooks/move-to-org.md の 3)`,
      ];
    if (skipped.has(c))
      return [
        `必須のチェック「${c}」の if が pull_request だけ(キューの中では飛ばされて成功になり、確かめずに入る)`,
      ];
    return [];
  });
}

const PR_ONLY_IF = /event_name\s*==\s*'pull_request'/;

function checkEnvironments(setup, workflows, checkupEnvironments) {
  const declared = new Set((setup.environments ?? []).map((e) => e.name));
  const problems = [];
  for (const w of workflows)
    for (const j of w.jobs)
      if (j.environment && !declared.has(j.environment))
        problems.push(
          `${w.file} の ${j.id} が使う Environment ${j.environment} が .github/setup.yml に無い`,
        );
  for (const name of checkupEnvironments)
    if (!declared.has(name))
      problems.push(`点検(gh-envs)が見る Environment ${name} が .github/setup.yml に無い`);
  return problems;
}

function checkSchedules(setup, workflows) {
  const allowed = new Set((setup.template_schedules ?? []).map((s) => s.file));
  const problems = [];
  for (const w of workflows.filter((w) => w.scheduled)) {
    const base = w.file.split("/").pop();
    if (allowed.has(base) || allowed.has(w.file)) continue;
    for (const j of w.jobs.filter((j) => !j.needs && !j.if.includes(ROLE_GATE)))
      problems.push(
        `${w.file} は定期で動くのに、${j.id} の if に ${ROLE_GATE} が無い(ひな形でも動いてしまう。ひな形でも回すなら template_schedules に)`,
      );
  }
  return problems;
}

/**
 * 全部を見る。戻り値: { problems: 落とす物, unused: 一覧にあって使われていないラベル(表示だけ) }
 * checkupEnvironments … 点検の gh-envs が見る Environment(scripts/checkup/checks/github-environments.mjs)
 */
export function checkAll({ setup, labels, src, checkupEnvironments = [] }) {
  const problems = [...validateSetup(setup), ...validateLabels(labels)];
  if (problems.length > 0) return { problems, unused: [] };
  const workflows = readWorkflows(src);
  const l = checkLabels(labels, src);
  return {
    problems: [
      ...l.problems,
      ...checkRequired(setup, workflows),
      ...checkEnvironments(setup, workflows, checkupEnvironments),
      ...checkSchedules(setup, workflows),
    ],
    unused: l.unused,
  };
}

/** ラベルの手引き(docs/guides/labels.md)が一覧から作り直されているか */
export const checkGuide = (labels, src) =>
  src.read(LABELS_GUIDE) === renderLabelsGuide(labels)
    ? []
    : [`${LABELS_GUIDE} が .github/labels.yml と合っていない(pnpm setup:labels で作り直す)`];
