// 領域どうしの「使ってよい」向き(ADR 0004)。ここに無い向きの import は CI が落とす
// (test/unit/domain-boundaries.test.ts)。輪(A → B → A)は作らない。
// 足す前に、本当にその向きか・逆にできないか・イベント(アウトボックス)で済まないかを考える。
export const DOMAIN_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  organizations: [],
  projects: ["organizations"],
  tasks: ["organizations", "projects"],
  // 規約と同意(docs/specs/0009-legal-consent.md)。同意する人・お知らせの宛先は組織の領域の人
  legal: ["organizations"],
  // 集客(公開の LP の事前登録。docs/specs/0025-public-landing-page.md)。表は運営の組織の持ち物(外部キーだけ)
  growth: ["organizations"],
  // 写真・ファイル(docs/specs/0072-file-storage.md)。付け先はタスク(題材を差し替えたら付け先を変える)
  files: ["organizations", "tasks"],
};
