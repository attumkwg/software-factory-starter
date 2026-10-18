// TanStack Start がビルドする SSR の入口(dist/server/server.js)。package.json の "imports" で "#ssr" に割り当てる。
declare module "#ssr" {
  const entry: { fetch: (request: Request) => Promise<Response> };
  export default entry;
}
