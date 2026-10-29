// マージキューの中(merge_group)で、確かめている PR の番号を引く(G-135・仕様 0095)。
// キューは PR ごとに一時の枝 gh-readonly-queue/<土台>/pr-<番号>-<版> を作り、その上で必須のチェックを流す。
// PR の本文・承認・未確定事項の答えを見るチェックは、この番号で PR を読み直す(キューに並べた後の書き換えも見る)。

/** キューの枝の名前(refs/heads/gh-readonly-queue/main/pr-123-<sha>)から PR の番号。読めなければ undefined */
export function prNumberFromQueueRef(ref) {
  const parts = String(ref ?? "")
    .replace(/^refs\/heads\//, "")
    .split("/");
  if (parts.length < 3 || parts[0] !== "gh-readonly-queue") return undefined;
  const m = parts.at(-1).match(/^pr-(\d{1,9})-[0-9a-f]{7,40}$/);
  return m ? Number(m[1]) : undefined;
}

/** PR の番号: pull_request ならその番号、キューの中なら枝の名前から */
export function prNumberOf({ prNumber, queueRef }) {
  const n = Number(prNumber);
  if (Number.isInteger(n) && n > 0) return n;
  return prNumberFromQueueRef(queueRef);
}
