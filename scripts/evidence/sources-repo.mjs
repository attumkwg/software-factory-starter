// 証跡の集め先(リポジトリの中)。点検の台帳の状態と、規程・SoA の版。
// 台帳と規程の本文は git の履歴にもあるが、「その月にどうなっていたか」を消せない場所に写しておく。
import { loadPolicies, POLICIES_DIR, SOA_FILE } from "../compliance/lib.mjs";
import { sha256 } from "./lib.mjs";

const toText = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

async function ledger(ctx) {
  const l = ctx.ledger;
  if (!l) return { ok: false, message: "点検の台帳を読めなかった" };
  return {
    ok: true,
    data: {
      started_on: toText(l.started_on),
      owners: l.owners,
      compliance: l.compliance ?? false,
      refreshed_on: toText(l.refreshed_on) ?? null,
      items: (l.items ?? []).map((i) => {
        const last = (i.history ?? []).at(-1);
        return {
          id: i.id,
          status: i.status,
          area: i.area ?? null,
          controls: i.controls ?? [],
          last: last ? { on: toText(last.on), by: last.by, result: last.result } : null,
        };
      }),
    },
  };
}

async function complianceDocs(ctx) {
  const soa = ctx.read(SOA_FILE);
  const policies = loadPolicies(
    ctx.files(POLICIES_DIR).map((f) => ({ file: f, text: ctx.read(f) })),
  );
  return {
    ok: true,
    data: {
      soa: soa ? { file: SOA_FILE, sha256: sha256(soa) } : null,
      policies: policies.map(({ file, meta }) => ({
        file,
        title: meta.title,
        version: meta.version,
        owner: meta.owner,
        established: toText(meta.established),
        last_reviewed: toText(meta.last_reviewed),
        next_review: toText(meta.next_review),
      })),
    },
  };
}

export const REPO_SOURCES = [
  {
    name: "checkup-ledger",
    about: "点検の台帳の状態(項目ごとの状態と最後の記録)",
    collect: ledger,
  },
  {
    name: "compliance-docs",
    about: "規程の版と見直しの日・適用宣言書(SoA)の SHA-256",
    collect: complianceDocs,
  },
];
