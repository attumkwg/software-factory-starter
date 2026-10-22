// eol: Node・PostgreSQL の使っている版のサポート期限が、半年より先か。
// 期限の表は公式の発表から(Node: github.com/nodejs/Release、PostgreSQL: postgresql.org/support/versioning)。
// Aurora の期限は AWS が別に決める(たいてい PostgreSQL より後)。表は /checkup-refresh で見直す。
import { daysBetween } from "../phase.mjs";
import { digitsAt } from "../text.mjs";

export const EOL = {
  node: { 20: "2026-04-30", 22: "2027-04-30", 24: "2028-04-30", 26: "2029-04-30" },
  postgres: {
    14: "2026-11-12",
    15: "2027-11-11",
    16: "2028-11-09",
    17: "2029-11-08",
    18: "2030-11-14",
  },
};
export const WARN_DAYS = 182;

/** text の中の、marker の直後の数字(「node:24-…」の 24)を全部 */
export function majorsAfter(text, marker) {
  const found = new Set();
  const s = String(text ?? "");
  for (let at = s.indexOf(marker); at >= 0; at = s.indexOf(marker, at + 1)) {
    const n = digitsAt(s, at + marker.length);
    if (n) found.add(Number(n));
  }
  return [...found];
}

/** 使っている版: Node は Dockerfile、PostgreSQL は docker-compose.yml と Terraform の engine_version */
function versionsIn(ctx) {
  const dockerfiles = ["apps/api/Dockerfile", "apps/web/Dockerfile"].map((f) => ctx.read(f));
  const tf = ctx.files("infra/terraform").filter((f) => f.endsWith(".tf") || f.endsWith(".tfvars"));
  return {
    node: dockerfiles.flatMap((t) => majorsAfter(t, "FROM node:")),
    postgres: [
      ...majorsAfter(ctx.read("docker-compose.yml"), "image: postgres:"),
      ...tf.flatMap((f) => majorsAfter(ctx.read(f), 'engine_version = "')),
    ],
  };
}

export async function check(ctx) {
  const used = versionsIn(ctx);
  const near = [];
  const unknown = [];
  for (const [name, majors] of Object.entries(used)) {
    for (const v of new Set(majors)) {
      const end = EOL[name][v];
      if (!end) unknown.push(`${name} ${v}`);
      else if (daysBetween(ctx.today, end) <= WARN_DAYS) near.push(`${name} ${v}(${end} まで)`);
    }
  }
  if (near.length > 0)
    return { result: "fail", note: `サポート期限が半年以内: ${near.join("・")}` };
  if (unknown.length > 0 || used.node.length + used.postgres.length === 0)
    return {
      result: "unknown",
      note: `期限の表に無い・見つからない版がある: ${unknown.join("・") || "版が見つからない"}`,
    };
  const all = Object.entries(used).flatMap(([n, vs]) => [...new Set(vs)].map((v) => `${n} ${v}`));
  return { result: "pass", note: `期限が半年より先: ${all.join("・")}` };
}
