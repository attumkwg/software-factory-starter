// 領域どうしの「使ってよい」向き(ADR 0004)。ここに無い向きの import は CI が落とす
// (test/unit/domain-boundaries.test.ts)。輪(A → B → A)は作らない。
// 足す前に、本当にその向きか・逆にできないか・イベント(アウトボックス)で済まないかを考える。
export const DOMAIN_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  organizations: [],
  projects: ["organizations"],
  tasks: ["organizations", "projects"],
  // 規約と同意(docs/specs/0008-legal-consent.md)。同意する人・お知らせの宛先は組織の領域の人
  legal: ["organizations"],
};
