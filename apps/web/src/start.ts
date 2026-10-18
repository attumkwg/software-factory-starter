import { createSerializationAdapter } from "@tanstack/react-router";
import { createIsomorphicFn, createStart } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { HttpError, NetworkError } from "./api.ts";

// SSR で起きた失敗を、ブラウザへ渡すときの形。
//
// 1. 自分たちの失敗(HttpError / NetworkError)は、そのままの種類で渡す。
//    渡さないと、ブラウザでは「ただの Error」になり、サーバーが描いた画面と文がずれる。
// 2. **それ以外の失敗は、中身(message)を捨てて渡す**。TanStack Start は SSR の失敗を HTML に埋め込んで
//    ブラウザへ送るので、何もしないとライブラリやバグの文(内部の URL・ファイルの場所・値)が
//    ページのソースに出る。元の失敗は画面のサーバーのログにだけ残す。

const httpErrorAdapter = createSerializationAdapter({
  key: "app-http-error",
  test: (value): value is HttpError => value instanceof HttpError,
  toSerializable: (e) => ({ status: e.status, body: e.body }),
  fromSerializable: ({ status, body }) => new HttpError(status, body),
});

const networkErrorAdapter = createSerializationAdapter({
  key: "app-network-error",
  test: (value): value is NetworkError => value instanceof NetworkError,
  toSerializable: (e) => ({ reason: e.reason, side: e.side }),
  fromSerializable: ({ reason, side }) => new NetworkError(reason, side),
});

/** ブラウザへ送らなかった失敗を、画面のサーバーのログに残す(JSON 1行。server/index.ts と同じ形)。 */
const logHidden = createIsomorphicFn()
  .server((e: Error) => {
    process.stdout.write(
      `${JSON.stringify({
        level: "error",
        time: new Date().toISOString(),
        service: "web",
        requestId: getRequest().headers.get("x-request-id"),
        err: { type: e.constructor.name, message: e.message, stack: e.stack },
        message: "SSR で想定外の失敗(ブラウザには中身を送っていない)",
      })}\n`,
    );
  })
  .client(() => {});

/** 上の2つ以外の Error。test は「Error だが自分たちの失敗ではない」。 */
export const hiddenErrorAdapter = createSerializationAdapter({
  key: "app-hidden-error",
  test: (value): value is Error =>
    value instanceof Error && !(value instanceof HttpError) && !(value instanceof NetworkError),
  toSerializable: (e) => {
    logHidden(e);
    return {};
  },
  fromSerializable: () => new Error("想定外の失敗"),
});

export const startInstance = createStart(() => ({
  // 順に試される。自分たちの失敗を先に
  serializationAdapters: [httpErrorAdapter, networkErrorAdapter, hiddenErrorAdapter],
}));
