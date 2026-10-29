// 確かめる PR の番号を出す(G-135・仕様 0095)。依存は要らない(node の標準だけ)。
//   CI: PR_NUMBER=${{ github.event.pull_request.number }} QUEUE_REF=${{ github.event.merge_group.head_ref }} node .github/scripts/queue-pr.mjs
// 番号を1行で出す。読めなければ 1 で終わる(チェックは落ちる = キューから外れる。黙って通さない)
import { prNumberOf } from "./queue-pr-lib.mjs";

const n = prNumberOf({ prNumber: process.env.PR_NUMBER, queueRef: process.env.QUEUE_REF });
if (n === undefined) {
  process.stderr.write(
    `::error::確かめる PR の番号が分からない(PR_NUMBER も、キューの枝の名前 QUEUE_REF=${process.env.QUEUE_REF ?? ""} も読めない)\n`,
  );
  process.exit(1);
}
process.stdout.write(`${n}\n`);
