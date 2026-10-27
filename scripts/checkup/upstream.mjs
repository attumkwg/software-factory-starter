// キットのどの版まで取り込んだか(docs/kit/upstream.yaml)と、キットの最新の版(GitHub のリリース)を比べる。
// pnpm setup:github の「人がやること」と、点検の kit-upstream が同じ文で知らせる。
// 決まり: docs/designs/0067-kit-upstream.md・版の付け方は docs/kit/maintenance.md の 4
import { parse } from "yaml";

export const UPSTREAM_FILE = "docs/kit/upstream.yaml";
export const UPGRADE_GUIDE = "docs/kit/upgrade.md";

/** "v0.2.1" → [0, 2, 1]。形が違えば undefined */
export function parseVersion(tag) {
  const m = String(tag ?? "")
    .trim()
    .match(/^v(\d+)\.(\d+)\.(\d+)$/);
  return m ? m.slice(1).map(Number) : undefined;
}

/** 取り込んだ版の記録。{ repository, version } か、ファイルが無ければ undefined */
export function readUpstream(text) {
  if (!text) return undefined;
  const y = parse(text) ?? {};
  return { repository: y.repository ?? undefined, version: y.version ?? undefined };
}

/**
 * いまの版と最新の版を比べる。
 * 戻り値: { state: "latest" | "behind" | "unknown", hands }
 *   hands … 取り込むときに手が要る版をまたぐか(0. の間は2つ目の数字、1 から後は1つ目の数字が上がった)
 *   いまの版の記録が無い(版の前に作った・ファイルを消した)ときは behind で hands
 */
export function compareUpstream(current, latest) {
  const last = parseVersion(latest);
  if (!last) return { state: "unknown" };
  const now = parseVersion(current);
  if (!now) return { state: "behind", hands: true };
  for (let i = 0; i < 3; i += 1) {
    if (last[i] === now[i]) continue;
    if (last[i] < now[i]) return { state: "latest" };
    return { state: "behind", hands: now[0] === 0 && last[0] === 0 ? i <= 1 : i === 0 };
  }
  return { state: "latest" };
}

/** 知らせの文(人がやること・点検で同じ) */
export function upstreamMessage({ repository, current, latest, hands }) {
  const kind = hands
    ? "取り込むときに手が要る版をまたぐ"
    : "直しだけの版(取り込むときに手は要らないはず)";
  return `キットの新しい版 ${latest} が出ている(取り込んだのは ${current ?? "記録なし"}。${kind})。https://github.com/${repository}/blob/main/CHANGELOG.md の「取り込むときにすること」を読み、${UPGRADE_GUIDE} の手順で取り込む`;
}

/**
 * キットの最新の版(GitHub のリリースの latest)。getPath(path) → { ok, status, data }
 * 戻り値: { ok: true, tag(まだ版が無ければ undefined) } か、読めなければ getPath の失敗をそのまま
 */
export function latestRelease(getPath, repository) {
  const res = getPath(`repos/${repository}/releases/latest`);
  if (res.ok) return { ok: true, tag: res.data?.tag_name };
  if (res.status === 404) return { ok: true, tag: undefined };
  return res;
}
