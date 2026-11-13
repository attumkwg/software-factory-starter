// 初見の利用者テストの操作の道具の、中身の判定(仕様 0100)。サーバーは server.ts、呼び口は browse.ts。
// 利用者役の AI が画面で見える物(役割と名前)だけで操作し、1手ずつ記録に残す。

/** 記録の1行(1手) */
export type Step = {
  at: string;
  action: string;
  args: string[];
  ok: boolean;
  url: string;
  error?: string;
};

/** 手数に数える操作(見るだけ・始める・終えるは数えない) */
export const MOVES = new Set(["tap", "fill", "select", "press", "goto", "back"]);

/** 行き先が試す先(既定 http://localhost:8080)の中か。外のサイトへは行かせない */
export function sameOrigin(base: string, target: string): string | null {
  const b = new URL(base);
  const t = new URL(target, b);
  return t.origin === b.origin ? t.toString() : null;
}

/** 記録から、手数と迷いの数をまとめる */
export function summarize(steps: Step[]) {
  const moves = steps.filter((s) => MOVES.has(s.action));
  const misses = moves.filter((s) => !s.ok);
  const backs = moves.filter((s) => s.action === "back");
  const pages = [...new Set(steps.map((s) => new URL(s.url).pathname))];
  return {
    moves: moves.length,
    misses: misses.length,
    backs: backs.length,
    pages,
    lastUrl: steps.at(-1)?.url ?? "",
    missed: misses.map((s) => `${s.action} ${s.args.join(" ")}: ${s.error ?? ""}`),
  };
}

/** 呼び口の引数を読む(tap ボタン 足す → { action: "tap", args: ["ボタン", "足す"] }) */
export function parseCommand(argv: string[]): { action: string; args: string[] } {
  const [action = "help", ...args] = argv;
  return { action, args };
}

/** 画面の言葉の役割 → Playwright の役割(利用者役は日本語で言ってよい) */
const ROLES: Record<string, string> = {
  ボタン: "button",
  リンク: "link",
  チェック: "checkbox",
  欄: "textbox",
  選択: "combobox",
  タブ: "tab",
  メニュー: "menuitem",
};

export function roleOf(word: string): string {
  return ROLES[word] ?? word;
}
