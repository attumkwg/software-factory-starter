import { createContext, type ReactNode, useCallback, useContext, useState } from "react";

// 操作の結果を短く知らせる。読み上げにも届くよう aria-live の領域に出す。
// React Aria の Toast はまだ「不安定版」なので、安定するまではこの小さな自前の部品を使う(ADR 0002)。

type Toast = { id: number; message: string };
type ToastApi = { show: (message: string) => void };

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({
  children,
  durationMs = 4000,
}: {
  children: ReactNode;
  durationMs?: number;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback(
    (message: string) => {
      const id = nextId++;
      setToasts((t) => [...t, { id, message }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), durationMs);
    },
    [durationMs],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <section className="ui-toast-region" aria-live="polite" aria-label="お知らせ">
        {toasts.map((t) => (
          <div key={t.id} className="ui-toast" role="status">
            {t.message}
          </div>
        ))}
      </section>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("ToastProvider の中で使ってください");
  return api;
}
