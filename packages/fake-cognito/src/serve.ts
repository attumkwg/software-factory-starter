import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** 偽物の Cognito を HTTP で立てる(docker compose と、AWS の SDK でつなぐ契約テストが使う)。port 0 なら空いている番号 */
export function serve(
  handle: (req: Request) => Promise<Response>,
  port: number,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    const request = new Request(new URL(req.url ?? "/", "http://fake-cognito"), {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([k, v]) =>
        v === undefined ? [] : [[k, Array.isArray(v) ? v.join(", ") : v] as [string, string]],
      ),
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const response = await handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  return new Promise((resolve) => {
    server.listen(port, "0.0.0.0", () => {
      const { port: actual } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${actual}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
