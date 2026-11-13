import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { Button } from "./Button.tsx";

// 操作の結果を短く知らせる。読み上げにも届くよう aria-live の領域に出す。
// React Aria の Toast はまだ「不安定版」なので、安定するまではこの小さな自前の部品を使う(ADR 0002)。

/** トーストに付ける操作(「元に戻す」など)。押したらトーストは消える */
export type ToastAction = { label: string; onPress: () => void };
export type ToastOptions = { action?: ToastAction };

type Toast = { id: number; message: string; action?: ToastAction };
type ToastApi = { show: (message: string, options?: ToastOptions) => void };

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({
  children,
  durationMs = 4000,
  actionDurationMs = 8000,
}: {
  children: ReactNode;
  durationMs?: number;
  /** 操作つき(元に戻すなど)は、押す間があるように長く出す */
  actionDurationMs?: number;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = nextId++;
      setToasts((t) => [...t, { id, message, action: options.action }]);
      setTimeout(() => dismiss(id), options.action ? actionDurationMs : durationMs);
    },
    [durationMs, actionDurationMs, dismiss],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <section className="ui-toast-region" aria-live="polite" aria-label="お知らせ">
        {toasts.map((t) => (
          <div key={t.id} className="ui-toast" role="status">
            <span>{t.message}</span>
            {t.action && (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  dismiss(t.id);
                  t.action?.onPress();
                }}
              >
                {t.action.label}
              </Button>
            )}
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
