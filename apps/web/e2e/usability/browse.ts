// 初見の利用者テストの操作の道具(仕様 0100・/usability-test)。利用者役の AI はこれだけで画面を触る。
//   pnpm ux:browse serve [mobile|desktop]   ブラウザを持ち続ける(既定はスマホ)。/usability-test を回す側が裏で動かす(終わるまで戻らない)。
//                                           先に Docker の中の Chromium を: docker compose -f docker-compose.vrt.yml up -d --wait
//   pnpm ux:browse look                     今の画面(役割と名前の木・画像の場所)
//   pnpm ux:browse tap <役割> <名前>         押す(役割: ボタン・リンク・チェック・欄・選択・タブ・メニュー)
//   pnpm ux:browse fill <ラベル> <文字>       入れる
//   pnpm ux:browse select <ラベル> <選ぶ物>   選ぶ
//   pnpm ux:browse press <キー>              キー(Enter など)
//   pnpm ux:browse goto <道> / back          移る(このアプリの中だけ)/ 戻る
//   pnpm ux:browse report                    手数・うまくいかなかった手・見た画面
//   pnpm ux:browse stop                      終える
// 記録は一時フォルダ(UX_DIR。既定は OS の一時フォルダの ux-browse)の steps.jsonl(1手1行)と画像。
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCommand, type Step, summarize } from "./browse-lib.ts";

const dir = process.env.UX_DIR ?? join(tmpdir(), "ux-browse");
const { action, args } = parseCommand(process.argv.slice(2));

if (action === "serve") {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.UX_DIR = dir;
  process.env.UX_DEVICE = args[0] ?? "mobile";
  console.log(`ブラウザを持ち続けます(${process.env.UX_DEVICE})。記録: ${dir}`);
  await import("./server.ts");
} else if (action === "report") {
  const path = join(dir, "steps.jsonl");
  const steps: Step[] = existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
  console.log(JSON.stringify(summarize(steps), null, 2));
} else if (action === "help") {
  console.log(readFileSync(import.meta.filename, "utf8").split("\nimport")[0]);
} else {
  const state = join(dir, "server.json");
  if (!existsSync(state)) {
    console.log("ブラウザが立っていません(先に pnpm ux:browse serve を裏で動かす)");
    process.exit(1);
  }
  const { port } = JSON.parse(readFileSync(state, "utf8")) as { port: number };
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    body: JSON.stringify({ action, args }),
  });
  console.log(await res.text());
  process.exit(res.ok ? 0 : 1);
}
