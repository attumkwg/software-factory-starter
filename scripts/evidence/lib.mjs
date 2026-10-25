// 証跡(evidence.yml)と費用(cost.yml)が共有する部品: AWS CLI の呼び出し・束ね方(JSON と目録)・書き出し。
// 読むのは落とさない(scripts/checkup/gh.mjs と同じ型)。読めない物は { ok: false, message } にして、ほかを続ける。
// 公開のリポジトリの Actions のログに出るので、表に出す文はアカウントの番号と ARN を伏せる(mask)。設計: docs/designs/0019-evidence-soa-and-cost.md
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const firstLine = (s) =>
  String(s ?? "")
    .trim()
    .split("\n")[0];

/** ログや目録に出す文から、アカウントの番号(12桁)と ARN を伏せる */
export const mask = (text) =>
  String(text ?? "")
    .replace(/arn:aws[a-z-]*:[^\s"']+/g, "<ARN>")
    .replace(/\b\d{12}\b/g, "<アカウント>");

/**
 * aws <args> --output json を呼び、JSON を返す。
 * 戻り値: { ok: true, data } か { ok: false, message }(aws が無い・権限が無い・サービスが有効でない)
 */
export function awsCli(args) {
  try {
    const out = execFileSync("aws", [...args, "--output", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, data: out.trim() ? JSON.parse(out) : null };
  } catch (e) {
    if (e.code === "ENOENT") return { ok: false, message: "aws が入っていない" };
    return { ok: false, message: mask(firstLine(e.stderr || e.message)) };
  }
}

/** 日本時間の年月(YYYY-MM)。today は YYYY-MM-DD */
export const monthOf = (today) => String(today).slice(0, 7);

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** 集めた物の大きさ(一覧なら件数・物なら項目の数)。ログには中身ではなくこれだけを出す */
export const sizeOf = (data) => {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") return Object.keys(data).length;
  return data === undefined || data === null ? 0 : 1;
};

/**
 * 集めた物(entries: [{ name, about, ok, data?, reason? }])を、1件1ファイルの JSON と目録に束ねる。
 * 戻り値: Map<ファイル名, 中身の文字列>(manifest.json を含む)
 */
export function makeBundle({ kind, month, collectedAt, repo, commit, entries }) {
  const files = new Map();
  const listed = [];
  for (const e of entries) {
    const file = `${e.name}.json`;
    const body = `${JSON.stringify(
      {
        name: e.name,
        about: e.about,
        month,
        collected_at: collectedAt,
        repo,
        ok: e.ok,
        ...(e.ok ? { data: e.data } : { reason: e.reason }),
      },
      null,
      2,
    )}\n`;
    files.set(file, body);
    listed.push({
      name: e.name,
      file,
      ok: e.ok,
      ...(e.ok ? { size: sizeOf(e.data) } : { reason: e.reason }),
      sha256: sha256(body),
      bytes: Buffer.byteLength(body),
    });
  }
  const manifest = { kind, month, collected_at: collectedAt, repo, commit, files: listed };
  files.set("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return files;
}

/** 何回かに分けて書いた物(Map<ファイル名, 中身>)の目録。費用(scripts/cost)のように、最後にまとめて作るとき */
export const manifestOf = (meta, files) => ({
  ...meta,
  files: [...files]
    .filter(([file]) => file !== "manifest.json")
    .map(([file, body]) => ({ file, sha256: sha256(body), bytes: Buffer.byteLength(body) })),
});

export function writeBundle(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of files) writeFileSync(join(dir, name), body);
}

/** 集め先を1つずつ流す。投げても落とさず ok: false にする(1つが読めなくても、ほかは集める) */
export async function collectAll(sources, ctx) {
  const entries = [];
  for (const s of sources) {
    try {
      const r = await s.collect(ctx);
      entries.push(
        r.ok
          ? { name: s.name, about: s.about, ok: true, data: r.data }
          : { name: s.name, about: s.about, ok: false, reason: mask(r.message) },
      );
    } catch (e) {
      entries.push({
        name: s.name,
        about: s.about,
        ok: false,
        reason: mask(firstLine(e?.message)),
      });
    }
  }
  return entries;
}

/** ログ(公開されうる)に出す1行。中身は出さず、名前と件数か、読めなかった理由だけ */
export const logLine = (e) =>
  e.ok ? `✅ ${e.name}(${sizeOf(e.data)}件)` : `⚠️ ${e.name}: 読めなかった(${e.reason})`;
