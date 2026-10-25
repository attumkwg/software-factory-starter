// 証跡の集め先の一覧(名前は点検の台帳の evidence 欄と SoA が指す。変えない)。
import { AWS_SOURCES } from "./sources-aws.mjs";
import { GITHUB_SOURCES } from "./sources-github.mjs";
import { REPO_SOURCES } from "./sources-repo.mjs";

export const SOURCES = [...GITHUB_SOURCES, ...AWS_SOURCES, ...REPO_SOURCES];
export const EVIDENCE_NAMES = SOURCES.map((s) => s.name);

const GROUPS = { github: GITHUB_SOURCES, aws: AWS_SOURCES, repo: REPO_SOURCES };

/** --only github,aws,repo の絞り込み(集め先の組で。知らない組の名前は無視する) */
export const pick = (only) => {
  if (!only) return SOURCES;
  const kinds = new Set(only.split(",").map((s) => s.trim()));
  return SOURCES.filter((s) => [...kinds].some((k) => GROUPS[k]?.includes(s)));
};
