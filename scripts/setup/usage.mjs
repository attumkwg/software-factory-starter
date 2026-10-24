// コードの中の「使われ方」を拾う(ラベル・ジョブの名前・Environment・定期の実行)。GitHub は読まない。
// 拾う形は docs/designs/0014-setup-before-use.md の 3.「pnpm setup:check が見ること」。
import { parse } from "yaml";

// ラベルに使える文字(ここで切る。日本語の句読点やバッククォートは名前に含めない)
const NAME_CHAR = /[A-Za-z0-9:_./-]/;
// 書きかけの名前(risk:<high|low>・${{ … }} など)は拾わない
const PLACEHOLDER = ["<", "$", "{"];

/** pos から名前を1つ読む。続きが書きかけの印なら undefined */
function readName(text, pos) {
  let end = pos;
  while (end < text.length && NAME_CHAR.test(text[end])) end += 1;
  if (end === pos || PLACEHOLDER.includes(text[end])) return undefined;
  return text.slice(pos, end).replace(/[.:/-]+$/, "");
}

/** `--label a,b`・`--add-label a`・`--remove-label=a` */
function flagLabels(text) {
  const found = [];
  for (const m of text.matchAll(/--(?:add-|remove-)?label(?:=|[ \t]+)["']?/g)) {
    let pos = m.index + m[0].length;
    for (;;) {
      const name = readName(text, pos);
      if (!name) break;
      found.push(name);
      pos += name.length;
      if (text[pos] !== ",") break;
      pos += 1;
    }
  }
  return found;
}

const QUOTED = [
  /label\.name\s*==\s*['"]([^'"]+)['"]/g, // github.event.label.name == 'x'
  /labels\.\*\.name\s*,\s*['"]([^'"]+)['"]/g, // contains(…labels.*.name, 'x')
  /\b[A-Z_]*LABEL\s*=\s*["']([^"']+)["']/g, // export const LABEL = "x"
];

/** ワークフロー・スクリプト・スキルの文から、使っているラベルを拾う */
export function labelsInText(text) {
  const found = flagLabels(text);
  for (const re of QUOTED) for (const m of text.matchAll(re)) found.push(m[1]);
  return found;
}

/** labeler.yml の一番上の鍵 */
export const labelsInLabeler = (text) => Object.keys(parse(text) ?? {});

/** Issue のテンプレートの labels: */
export const labelsInIssueTemplate = (text) => parse(text)?.labels ?? [];

/** renovate.json の labels・addLabels(どの深さでも) */
export function labelsInRenovate(value) {
  if (Array.isArray(value)) return value.flatMap(labelsInRenovate);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) =>
    (k === "labels" || k === "addLabels") && Array.isArray(v)
      ? v.filter((x) => typeof x === "string")
      : labelsInRenovate(v),
  );
}

const triggersOf = (wf) => {
  const on = wf?.on;
  if (typeof on === "string") return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((t) => [t, null]));
  return on ?? {};
};

const MATRIX_REF = /\$\{\{\s*matrix\.([\w-]+)\s*\}\}/;

/** 名前の中の ${{ matrix.x }} を、matrix の値で広げる(include も見る) */
function expandMatrix(name, matrix) {
  const m = name.match(MATRIX_REF);
  if (!m) return [name];
  const key = m[1];
  const values = [
    ...(Array.isArray(matrix?.[key]) ? matrix[key] : []),
    ...(matrix?.include ?? []).map((x) => x?.[key]).filter((v) => v !== undefined),
  ];
  return [...new Set(values)].flatMap((v) => expandMatrix(name.replace(m[0], String(v)), matrix));
}

/** ワークフロー1つを読む: PR で動くか・定期があるか・ジョブ(名前・Environment・if・needs) */
export function readWorkflow(text) {
  const wf = parse(text) ?? {};
  const on = triggersOf(wf);
  const jobs = Object.entries(wf.jobs ?? {}).map(([id, job]) => {
    const env = typeof job?.environment === "string" ? job.environment : job?.environment?.name;
    return {
      id,
      names: expandMatrix(String(job?.name ?? id), job?.strategy?.matrix),
      environment: env && !env.includes("${{") ? env : undefined,
      if: String(job?.if ?? ""),
      needs: job?.needs,
    };
  });
  return {
    pullRequest: "pull_request" in on || "pull_request_target" in on,
    scheduled: Array.isArray(on.schedule) && on.schedule.length > 0,
    jobs,
  };
}

/** 定期の運用の見分け(この形が if に無いジョブは、ひな形でも定期で動いてしまう) */
export const ROLE_GATE = "vars.KIT_ROLE == 'product'";
