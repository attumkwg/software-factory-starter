// テストや検査を弱めた PR に印を付ける(G-60・仕様 0062)。AI は「CI を緑にする」を目標にすると、
// テストの側を変えて通すことがある(skip を付ける・確かめを外す・下限を下げる・検査を黙らせる)。
// 止めるのではなく見つけて、ラベル tests:weakened で人の目に出す。正規表現を使わずに読む(Semgrep の regex_dos)。

/** テストのファイルか(*.test.*・*.spec.*) */
export const isTestFile = (name) => {
  const base = name.split("/").pop() ?? "";
  return base.includes(".test.") || base.includes(".spec.");
};

/** カバレッジの下限を書く設定か(vitest.config.*) */
export const isCoverageConfig = (name) =>
  (name.split("/").pop() ?? "").startsWith("vitest.config.");

// テストを飛ばす・1つだけ流す書き方(空白を詰めてから探す)
export const SKIP_TOKENS = [
  ".skip(",
  ".only(",
  ".todo(",
  ".fixme(",
  ".skipIf(",
  ".runIf(",
  "xit(",
  "xtest(",
  "xdescribe(",
  "fit(",
  "fdescribe(",
];
// 確かめの書き方(vitest・Playwright の expect と node:test の assert)
export const ASSERT_TOKENS = ["expect(", "expect.", "assert(", "assert."];
// 検査を黙らせる注釈(テストに限らず、どのファイルでも)
export const SILENCE_TOKENS = [
  "biome-ignore",
  "@ts-ignore",
  "@ts-expect-error",
  "@ts-nocheck",
  "nosemgrep",
  "eslint-disable",
  "squawk-ignore",
  "gitleaks:allow",
];
// カバレッジの下限の名前
const THRESHOLD_KEYS = ["lines", "functions", "branches", "statements"];

const squeeze = (line) => [...line].filter((c) => c !== " " && c !== "\t").join("");
const count = (text, token) => {
  let n = 0;
  for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + token.length)) n += 1;
  return n;
};

/** 差分(patch)の足した行・消した行(頭の +・- を外す) */
export const patchLines = (patch) => {
  const added = [];
  const removed = [];
  for (const line of String(patch ?? "").split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
  }
  return { added, removed };
};

/** 行の中の「名前: 数」(下限)。無ければ undefined */
const thresholdOf = (line) => {
  const s = squeeze(line);
  for (const key of THRESHOLD_KEYS) {
    if (!s.startsWith(`${key}:`)) continue;
    const digits = [...s.slice(key.length + 1)].filter((c) => (c >= "0" && c <= "9") || c === ".");
    const value = Number(digits.join(""));
    return digits.length > 0 && Number.isFinite(value) ? { key, value } : undefined;
  }
  return undefined;
};

const tokensDelta = (added, removed, tokens) => {
  const a = added.map(squeeze).join("\n");
  const r = removed.map(squeeze).join("\n");
  return tokens
    .map((t) => ({ token: t, delta: count(a, t) - count(r, t) }))
    .filter((x) => x.delta > 0);
};

// 種類ごとの見つけ方。どれも { file, kind, detail } の並びを返す
const one = (file, kind, detail) => ({ file, kind, detail });

function deletedTests(f) {
  if (f.status === "removed" && isTestFile(f.filename))
    return [one(f.filename, "消したテスト", "テストのファイルを消した")];
  const wasTest = f.previous_filename && isTestFile(f.previous_filename);
  if (f.status === "renamed" && wasTest && !isTestFile(f.filename))
    return [one(f.filename, "消したテスト", `${f.previous_filename} をテストでない名前にした`)];
  return [];
}

function weakerTests(f, added, removed) {
  if (!isTestFile(f.filename)) return [];
  const found = tokensDelta(added, removed, SKIP_TOKENS).map(({ token, delta }) =>
    one(f.filename, "飛ばす書き方", `${token} が ${delta} 個増えた`),
  );
  const asserts = (lines) => {
    const text = lines.map(squeeze).join("\n");
    return ASSERT_TOKENS.reduce((n, t) => n + count(text, t), 0);
  };
  const lost = asserts(removed) - asserts(added);
  if (lost > 0) found.push(one(f.filename, "確かめが減った", `expect・assert が ${lost} 個減った`));
  return found;
}

const thresholds = (lines) =>
  new Map(
    lines
      .map(thresholdOf)
      .filter(Boolean)
      .map((t) => [t.key, t.value]),
  );

function lowerThresholds(f, added, removed) {
  if (!isCoverageConfig(f.filename)) return [];
  const now = thresholds(added);
  return [...thresholds(removed)]
    .filter(([key, value]) => !now.has(key) || now.get(key) < value)
    .map(([key, value]) =>
      one(
        f.filename,
        "下限を下げた",
        now.has(key)
          ? `${key} の下限を ${value} → ${now.get(key)} にした`
          : `${key} の下限(${value})を外した`,
      ),
    );
}

const silenced = (f, added, removed) =>
  tokensDelta(added, removed, SILENCE_TOKENS).map(({ token, delta }) =>
    one(f.filename, "検査を黙らせる", `${token} が ${delta} 個増えた`),
  );

const unreadable = (f) =>
  f.patch === undefined &&
  f.status !== "removed" &&
  (isTestFile(f.filename) || isCoverageConfig(f.filename))
    ? [one(f.filename, "読めない差分", "差分が大きくて読めない。人が見る")]
    : [];

/**
 * PR の変えたファイル(GitHub の pulls/{n}/files の形)から、弱めた所を並べる。
 * 戻り値: [{ file, kind, detail }]。kind は 消したテスト / 飛ばす書き方 / 確かめが減った / 下限を下げた / 検査を黙らせる / 読めない差分
 */
export function findWeakening(files) {
  return files.flatMap((f) => {
    const deleted = deletedTests(f);
    if (f.status === "removed") return deleted;
    const { added, removed } = patchLines(f.patch);
    return [
      ...deleted,
      ...weakerTests(f, added, removed),
      ...lowerThresholds(f, added, removed),
      ...silenced(f, added, removed),
      ...unreadable(f),
    ];
  });
}

/** 人に出す行(ジョブの要約・PR のコメント) */
export function summarize(found) {
  if (found.length === 0) return ["✅ テストと検査を弱めた所は見つからない"];
  return [
    `⚠️ テストか検査を弱めたかもしれない所が ${found.length} か所(ラベル tests:weakened)。理由が PR の本文にあるかを人が確かめる`,
    ...found.map((x) => `- ${x.kind}: \`${x.file}\` … ${x.detail}`),
  ];
}
