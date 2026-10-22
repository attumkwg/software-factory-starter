// coverage-total: API のカバレッジを、単体だけでなく結合も合わせて測っているか。
// いまは apps/api の test:coverage が「--project unit」だけを流している(docs/guides/ci-limits.md)。
export const PACKAGE = "apps/api/package.json";

export async function check(ctx) {
  const text = ctx.read(PACKAGE);
  if (text === undefined) return { result: "unknown", note: `${PACKAGE} が無い` };
  const script = JSON.parse(text).scripts?.["test:coverage"] ?? "";
  if (!script) return { result: "fail", note: `${PACKAGE} に test:coverage が無い` };
  return script.includes("--project unit")
    ? { result: "fail", note: "API のカバレッジは単体だけで測っている(結合の分が入っていない)" }
    : { result: "pass", note: "API のカバレッジは単体と結合を合わせて測っている" };
}
