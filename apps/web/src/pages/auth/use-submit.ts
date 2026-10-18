import { useRef, useState } from "react";
import { describeError, errorText } from "../../errors.ts";

/**
 * ログイン・登録の画面の送信。結果(次にすること)を返し、失敗したら文を error に入れる。
 * 書き込みの useAction と違い、画面のデータは読み直さない(まだログインしていない)。
 * 文は messages.ts の固定の文だけ(どこが違ったかを言わない)。
 */
export function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  async function submit<T>(fn: () => Promise<T>): Promise<T | null> {
    if (running.current) return null;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorText(describeError(e)));
      return null;
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return { submit, pending, error };
}
