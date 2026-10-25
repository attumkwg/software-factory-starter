// 委託先の台帳(docs/compliance/vendors.yaml)とコードを照らし合わせる中身。入口は vendors.mjs、テストは vendors.test.mjs。
// 決まりは docs/designs/0017-vendors-ai-data-audit-trail.md。Semgrep の regex_dos に当たらないよう、正規表現を使わずに読む。

export const RELATIONS = ["委託", "第三者提供", "渡さない"];
export const DPA_STATES = ["約款に含む", "未確認", "不要"];
export const STATUSES = ["active", "ended"];
// AI の会社と「渡さない」の会社に書けない区分(docs/security.md の AI-6)
const PERSONAL = ["personal", "sensitive"];

const isDigits = (s) => s.length > 0 && [...s].every((c) => c >= "0" && c <= "9");
export const isDate = (s) => {
  const [y, m, d, rest] = String(s).split("-");
  return rest === undefined && y?.length === 4 && m?.length === 2 && d?.length === 2
    ? isDigits(y) && isDigits(m) && isDigits(d)
    : false;
};
const asList = (v) => (Array.isArray(v) ? v : []);

/** `*` を「何文字でも」として name が pattern に当たるか(`@aws-sdk/*`・`aws_lb_*`・`aws_lb`) */
export const matches = (pattern, name) => {
  const parts = String(pattern).split("*");
  if (parts.length === 1) return pattern === name;
  const first = parts[0];
  const last = parts.at(-1);
  if (!name.startsWith(first) || name.length < first.length + last.length) return false;
  let at = first.length;
  for (const part of parts.slice(1, -1)) {
    const found = name.indexOf(part, at);
    if (found < 0) return false;
    at = found + part.length;
  }
  return name.endsWith(last) && name.length - last.length >= at;
};
const matchesAny = (patterns, name) => asList(patterns).some((p) => matches(p, name));

/** classification.ts の `DATA_CLASSES = ["public", …] as const` から区分を読む */
export const dataClassesFrom = (classificationTs) => {
  const at = classificationTs.indexOf("DATA_CLASSES = [");
  if (at < 0) return [];
  const start = classificationTs.indexOf("[", at) + 1;
  const end = classificationTs.indexOf("]", start);
  return classificationTs
    .slice(start, end)
    .split(",")
    .map((s) => s.trim().replaceAll('"', ""))
    .filter((s) => s !== "");
};

const contractProblems = (v, where) => {
  const dpa = String(v.contract?.dpa ?? "");
  const ok = DPA_STATES.includes(dpa) || (dpa.startsWith("結んだ(") && isDate(dpa.slice(4, 14)));
  const out = [];
  if (!ok)
    out.push(
      `${where} contract.dpa「${dpa}」は 結んだ(YYYY-MM-DD)/ ${DPA_STATES.join(" / ")} のどれか`,
    );
  if (!v.contract?.link) out.push(`${where} contract.link(相手の約款・DPA の URL)が無い`);
  if (v.relation === "委託" && dpa === "不要")
    out.push(`${where} 委託なのに contract.dpa が「不要」`);
  return out;
};

const dataProblems = (v, where, dataClasses) => {
  const out = [];
  const data = asList(v.data);
  for (const c of data) {
    if (!dataClasses.includes(c))
      out.push(`${where} data の「${c}」は区分(${dataClasses.join("・")})に無い`);
  }
  const personal = data.filter((c) => PERSONAL.includes(c));
  if (v.ai === true && personal.length > 0) {
    out.push(
      `${where} AI の会社に ${personal.join("・")} を渡さない(docs/security.md の AI-6。渡すのは ID と集計まで)`,
    );
  }
  if (v.relation === "渡さない" && personal.length > 0) {
    out.push(`${where} 「渡さない」なのに data に ${personal.join("・")} がある(委託にする)`);
  }
  for (const s of asList(v.services)) {
    for (const c of asList(s.data)) {
      if (!data.includes(c))
        out.push(`${where} services「${s.name}」の data の「${c}」が、会社の data に無い`);
    }
  }
  return out;
};

const requiredProblems = (v, where) => {
  const out = [];
  for (const key of ["name", "what", "country", "deletion"]) {
    if (!v[key]) out.push(`${where} ${key} が無い`);
  }
  if (!STATUSES.includes(v.status)) out.push(`${where} status は ${STATUSES.join(" / ")} のどれか`);
  if (v.status === "ended" && !isDate(v.ended_on ?? ""))
    out.push(`${where} ended に ended_on(YYYY-MM-DD)が無い`);
  if (!RELATIONS.includes(v.relation))
    out.push(`${where} relation は ${RELATIONS.join(" / ")} のどれか`);
  if (!Array.isArray(v.data)) out.push(`${where} data(区分の一覧。渡さないなら [])が無い`);
  if (!isDate(v.checked_on ?? ""))
    out.push(`${where} checked_on(公開の約款と認証を確かめた日)が無い`);
  if (!v.deletion?.when_we_leave || !v.deletion?.when_tenant_leaves) {
    out.push(`${where} deletion に when_we_leave と when_tenant_leaves の両方が要る`);
  }
  return out;
};

/** 台帳そのものの書き方の問題 */
export const checkLedger = (ledger, { dataClasses }) => {
  const vendors = asList(ledger?.vendors);
  if (vendors.length === 0) return ["vendors が空"];
  const out = [];
  const ids = new Set();
  for (const v of vendors) {
    const where = `vendors.yaml の ${v.id ?? "(id なし)"}:`;
    if (!v.id) out.push(`${where} id が無い`);
    if (ids.has(v.id)) out.push(`${where} id が重なっている`);
    ids.add(v.id);
    out.push(
      ...requiredProblems(v, where),
      ...contractProblems(v, where),
      ...dataProblems(v, where, dataClasses),
    );
  }
  return out;
};

// ── コードの中から、外の会社を使っている所を集める ──────────────────────────────

/** package.json([{ path, json }])の依存の名前 */
export const packagesIn = (files) => {
  const out = [];
  const keys = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  for (const { path, json } of files) {
    for (const key of keys) {
      for (const name of Object.keys(json[key] ?? {})) out.push({ name, where: path });
    }
  }
  return out;
};

const unquote = (s) => {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
    ? t.slice(1, -1)
    : t;
};

// 1行の `uses: owner/repo/path@ref` から `owner/repo`。uses の行でない・手元の `./` なら undefined
const actionOf = (raw) => {
  let line = raw.trim();
  if (line.startsWith("- ")) line = line.slice(2).trim();
  if (!line.startsWith("uses:")) return undefined;
  const ref = unquote(line.slice(5).split(" #")[0]);
  if (ref.startsWith("./") || ref === "") return undefined;
  return ref.startsWith("docker://")
    ? ref.split("@")[0]
    : ref.split("@")[0].split("/").slice(0, 2).join("/");
};

/** ワークフローの `uses:` から `owner/repo`(手元の `./` は除く。`docker://` はそのまま) */
export const actionsIn = (files) => {
  const out = [];
  for (const { path, text } of files) {
    for (const [i, raw] of text.split("\n").entries()) {
      const name = actionOf(raw);
      if (name) out.push({ name, where: `${path}:${i + 1}` });
    }
  }
  return out;
};

const typeOf = (line) => {
  const head = ['resource "', 'data "'].find((h) => line.startsWith(h));
  return head ? line.slice(head.length).split('"')[0] : undefined;
};

const isNamePart = (c) =>
  c !== undefined &&
  (c === "_" ||
    c === "-" ||
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    (c >= "0" && c <= "9"));

// 行の中の `source = "…"`(`aws = { source = "hashicorp/aws" }` の形も)。手元のモジュール(./ ../)は除く
const sourceOf = (line) => {
  let at = line.indexOf("source");
  while (at >= 0) {
    const rest = line.slice(at + 6).trimStart();
    if (!isNamePart(line[at - 1]) && rest.startsWith("=")) {
      const value = rest.slice(1).trimStart();
      const quoted = value.startsWith('"') ? value.slice(1).split('"')[0] : "";
      return quoted.includes("/") && !quoted.startsWith(".") ? quoted : undefined;
    }
    at = line.indexOf("source", at + 6);
  }
  return undefined;
};

/** Terraform の資源と data の種類(`resource "aws_s3_bucket" "x"`)と、提供者・モジュールの source */
export const terraformIn = (files) => {
  const types = [];
  const sources = [];
  for (const { path, text } of files) {
    for (const [i, raw] of text.split("\n").entries()) {
      const line = raw.trim();
      const where = `${path}:${i + 1}`;
      const type = typeOf(line);
      if (type) types.push({ name: type, where });
      const source = sourceOf(line);
      if (source) sources.push({ name: source, where });
    }
  }
  return { types, sources };
};

// ── 照らし合わせ ───────────────────────────────────────────────────────────

const active = (ledger) => asList(ledger.vendors).filter((v) => v.status === "active");
const vendorOf = (ledger, key, name) =>
  active(ledger).find((v) => matchesAny(v.match?.[key], name));

const packageProblems = (ledger, packages) => {
  const sdk = [
    ...asList(ledger.service_packages),
    ...active(ledger).flatMap((v) => asList(v.match?.packages)),
  ];
  const out = [];
  for (const p of packages) {
    if (matchesAny(sdk, p.name) && !vendorOf(ledger, "packages", p.name)) {
      out.push(
        `${p.where}: 外のサービスの SDK「${p.name}」が台帳に無い(vendors.yaml の match.packages)`,
      );
    }
  }
  return out;
};

const actionProblems = (ledger, actions) =>
  actions
    .filter((a) => !vendorOf(ledger, "actions", a.name))
    .map((a) => `${a.where}: Actions の「${a.name}」が台帳に無い(vendors.yaml の match.actions)`);

// 資源の種類の頭(aws_s3_bucket → aws)を、提供者の source の最後(hashicorp/aws → aws)で会社に結ぶ
const typeProblem = (ledger, t) => {
  const head = t.name.split("_")[0];
  const vendor = active(ledger).find((v) =>
    asList(v.match?.terraform_sources).some((s) => s.split("/").at(-1) === head),
  );
  if (!vendor)
    return `${t.where}: 資源の種類「${t.name}」の提供者(${head})が台帳に無い(match.terraform_sources)`;
  const services = asList(vendor.services);
  if (services.length === 0 || services.some((s) => matchesAny(s.terraform, t.name)))
    return undefined;
  return `${t.where}: ${vendor.name} の「${t.name}」が、どのサービスにも無い(vendors.yaml の services に足し、扱うデータの区分を書く)`;
};

/** コードで使っているのに台帳に無い物 */
export const checkUsage = (ledger, { packages, actions, terraform }) => {
  const out = [...packageProblems(ledger, packages), ...actionProblems(ledger, actions)];
  for (const s of terraform.sources) {
    if (!vendorOf(ledger, "terraform_sources", s.name)) {
      out.push(
        `${s.where}: Terraform の「${s.name}」が台帳に無い(vendors.yaml の match.terraform_sources)`,
      );
    }
  }
  for (const t of terraform.types) {
    const p = typeProblem(ledger, t);
    if (p) out.push(p);
  }
  return [...new Set(out)];
};

/** 会社ごとに、コードで当たった名前(重なりなし・並べて) */
export const usageByVendor = (ledger, { packages, actions }) => {
  const out = {};
  for (const v of active(ledger)) {
    const names = (key, list) =>
      [
        ...new Set(list.filter((x) => matchesAny(v.match?.[key], x.name)).map((x) => x.name)),
      ].sort();
    out[v.id] = { packages: names("packages", packages), actions: names("actions", actions) };
  }
  return out;
};
