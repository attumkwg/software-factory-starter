import { useToast } from "@app/ui";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { HttpError } from "./api.ts";
import { type Described, describeError, errorText } from "./errors.ts";

/**
 * 書き込み(作る・直す・消す)を1か所で受け止める。**画面から API に書き込むときは必ずこれを通す**。
 *
 *   成功 → 画面のデータを読み直す(router.invalidate)→ success の文をトーストで
 *   401  → ログインが切れたので、ログイン画面へ
 *   失敗 → 何をすればよいかの文を返す(フォームはその下に出す・それ以外はトースト)。
 *          404 / 409 のように「読み直せば直る」ものは、画面のデータも読み直す
 *   実行中 → pending が true。同じ操作を重ねて送らない(ボタンを押せなくする)
 */
export function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Described | null>(null);
  // 連打の間に state の更新が間に合わないので、ref でも止める
  const running = useRef(false);

  const run = useCallback(
    async (
      action: () => Promise<unknown>,
      opts: { success?: string; showErrorAs?: "toast" | "inline" } = {},
    ): Promise<boolean> => {
      if (running.current) return false;
      running.current = true;
      setPending(true);
      setError(null);
      try {
        await action();
        await router.invalidate();
        if (opts.success) toast.show(opts.success);
        return true;
      } catch (e) {
        const show =
          (opts.showErrorAs ?? "toast") === "toast"
            ? (d: Described) => toast.show(errorText(d))
            : setError;
        await handleFailure(e, router, show);
        return false;
      } finally {
        running.current = false;
        setPending(false);
      }
    },
    [router, toast],
  );

  return { run, pending, error, errorMessage: error ? errorText(error) : undefined };
}

type FailureRouter = Pick<ReturnType<typeof useRouter>, "clearCache" | "navigate" | "invalidate">;

/**
 * 書き込みの失敗を受け止める。401 はログイン画面へ。それ以外は利用者向けの文にして show に渡す
 * (404 / 409 のように読み直せば直るものは、先に画面のデータを読み直す)。
 */
export async function handleFailure(
  e: unknown,
  router: FailureRouter,
  show: (described: Described) => void,
): Promise<void> {
  if (e instanceof HttpError && e.code === "unauthorized") {
    router.clearCache();
    await router.navigate({ to: "/login" });
    return;
  }
  // 同意し直しが要る規約の版に、まだ同意していない → 同意の画面へ(docs/specs/0009-legal-consent.md)
  if (e instanceof HttpError && e.code === "terms_acceptance_required") {
    await router.navigate({ to: "/legal/accept" });
    return;
  }
  // 組織が二段階認証を必須にしていて、まだ設定していない → 設定の画面へ(docs/specs/0006-account-security.md)
  if (e instanceof HttpError && e.code === "mfa_setup_required") {
    await router.navigate({ to: "/account" });
    return;
  }
  const described = describeError(e);
  if (described.shouldReload) await router.invalidate();
  show(described);
}
