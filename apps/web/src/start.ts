import { createSerializationAdapter } from "@tanstack/react-router";
import { createStart } from "@tanstack/react-start";
import { HttpError, NetworkError } from "./api.ts";

// SSR で起きた失敗を、ブラウザへそのままの種類で渡す。
// これが無いと、ブラウザでは「ただの Error」になり、サーバーが描いた画面と文がずれる
// (例: サーバーは「止まっています」、ブラウザは「うまくいきませんでした」)。

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

export const startInstance = createStart(() => ({
  serializationAdapters: [httpErrorAdapter, networkErrorAdapter],
}));
