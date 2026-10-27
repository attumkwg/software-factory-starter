import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createWebApp, originOf, reportOriginOf, type SsrHandler } from "./app.ts";

function setup(
  ssr: SsrHandler = () => new Response("<html></html>"),
  env: {
    appEnv?: string;
    indexablePaths?: string[];
    sentryDsn?: string;
    filesOrigin?: string;
  } = {},
) {
  const clientDir = mkdtempSync(join(tmpdir(), "web-client-"));
  mkdirSync(join(clientDir, "assets"));
  writeFileSync(join(clientDir, "assets", "app-abc123.js"), "console.log(1)");
  writeFileSync(join(clientDir, "assets", "app-abc123.js.br"), "br-bytes");
  writeFileSync(join(clientDir, "assets", "app-abc123.js.gz"), "gz-bytes");
  // public/ に置いた物(ビルドで dist/client の直下に並ぶ)
  writeFileSync(join(clientDir, "favicon.svg"), "<svg></svg>");
  const lifecycle = { shuttingDown: false };
  const app = createWebApp({
    ssr,
    clientDir,
    logger: pino({ level: "silent" }),
    lifecycle,
    ...env,
  });
  return { app, lifecycle };
}

describe("画面のサーバー", () => {
  it("止めている間は /readyz が 503(ALB に外してもらう)", async () => {
    const { app, lifecycle } = setup();
    expect((await app.request("/readyz")).status).toBe(200);
    lifecycle.shuttingDown = true;
    expect((await app.request("/readyz")).status).toBe(503);
    expect((await app.request("/healthz")).status).toBe(200);
  });

  it("ビルド済みの JS は1年キャッシュ", async () => {
    const { app } = setup();
    const res = await app.request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("ビルドのときに圧縮しておいた JS を、ブラウザが受け取れる方で返す(ALB は圧縮しない)", async () => {
    const { app } = setup();
    const br = await app.request("/assets/app-abc123.js", {
      headers: { "accept-encoding": "gzip, br" },
    });
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(br.headers.get("content-type")).toContain("javascript");
    expect(br.headers.get("vary")).toContain("Accept-Encoding");
    expect(await br.text()).toBe("br-bytes");
    const gz = await app.request("/assets/app-abc123.js", {
      headers: { "accept-encoding": "gzip" },
    });
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    const plain = await app.request("/assets/app-abc123.js");
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await plain.text()).toBe("console.log(1)");
  });

  it("SSR の HTML はその場で圧縮する", async () => {
    const { app } = setup(
      () => new Response("<p>x</p>".repeat(500), { headers: { "content-type": "text/html" } }),
    );
    const res = await app.request("/", { headers: { "accept-encoding": "br" } });
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("守りのヘッダー: HSTS は1年・使わない機能は Permissions-Policy で止める", async () => {
    const { app } = setup();
    const res = await app.request("/");
    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    const policy = res.headers.get("permissions-policy") ?? "";
    expect(policy).toContain("camera=()");
    expect(policy).toContain("geolocation=()");
    expect(policy).toContain("microphone=()");
  });

  it("SSR の HTML は残させない(no-store)。画面の側で決めたものと、ビルド済みの JS はそのまま", async () => {
    const { app } = setup();
    expect((await app.request("/projects")).headers.get("cache-control")).toBe("no-store");
    const redirect = setup(() => Response.redirect("http://web/login", 302)).app;
    const r = await redirect.request("/projects");
    expect(r.status).toBe(302);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const own = setup(
      () => new Response("ok", { headers: { "cache-control": "public, max-age=60" } }),
    ).app;
    expect((await own.request("/about")).headers.get("cache-control")).toBe("public, max-age=60");
    expect((await app.request("/assets/app-abc123.js")).headers.get("cache-control")).toContain(
      "immutable",
    );
  });

  it("SSR に request ID を渡し、応答にも付ける(上から来た ID は引き継ぐ)", async () => {
    let seen: string | null = null;
    const { app } = setup((req) => {
      seen = req.headers.get("x-request-id");
      return new Response("ok");
    });
    const res = await app.request("/projects/1", { headers: { "x-request-id": "abcdef12-3456" } });
    expect(seen).toBe("abcdef12-3456");
    expect(res.headers.get("x-request-id")).toBe("abcdef12-3456");
  });

  it("書き込み(POST など)は受けない。書き込みはブラウザから API へ", async () => {
    let called = false;
    const { app } = setup(() => {
      called = true;
      return new Response("ok");
    });
    const res = await app.request("/", { method: "POST", body: "x" });
    expect(res.status).toBe(405);
    expect(called).toBe(false);
  });

  it("SSR が投げても、中身を出さずに 500", async () => {
    const { app } = setup(() => {
      throw new Error("db password is hunter2");
    });
    const res = await app.request("/");
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("hunter2");
  });
});

describe("CSP(Content-Security-Policy)", () => {
  const cspOf = (res: Response) => res.headers.get("content-security-policy") ?? "";
  const nonceOf = (csp: string) => csp.split("'nonce-")[1]?.split("'")[0];

  it("読み込むのは自分の origin と nonce の付いた埋め込みだけ。枠への埋め込み・object・base を止める", async () => {
    const { app } = setup();
    const csp = cspOf(await app.request("/"));
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{20,}'/);
    expect(csp).toMatch(/style-src 'self' 'nonce-/);
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // スクリプトを、属性や埋め込みの文字だけで許す抜け道が無い
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp.split("script-src")[1]?.split(";")[0]).not.toContain("'unsafe-inline'");
  });

  it("nonce は1リクエストごとに変わり、同じ値を SSR に渡す(ブラウザから来た値は捨てる)", async () => {
    const seen: (string | null)[] = [];
    const { app } = setup((req) => {
      seen.push(req.headers.get("x-csp-nonce"));
      return new Response("<html></html>");
    });
    const first = await app.request("/projects", { headers: { "x-csp-nonce": "attacker" } });
    const second = await app.request("/projects");
    const n1 = nonceOf(cspOf(first));
    const n2 = nonceOf(cspOf(second));
    expect(n1).toBeTruthy();
    expect(n1).not.toBe(n2);
    expect(seen).toEqual([n1, n2]);
  });

  it("Sentry の DSN があれば、送る先の origin だけを connect-src に足す", async () => {
    const { app } = setup(undefined, { sentryDsn: "https://key@o1.ingest.sentry.io/123" });
    expect(cspOf(await app.request("/"))).toContain(
      "connect-src 'self' https://o1.ingest.sentry.io;",
    );
    expect(reportOriginOf(undefined)).toBeUndefined();
    expect(reportOriginOf("not a url")).toBeUndefined();
  });

  it("写真・ファイルの置き場の origin を connect-src(PUT)と img-src(表示)に足す(docs/specs/0072-file-storage.md)", async () => {
    const { app } = setup(undefined, {
      sentryDsn: "https://key@o1.ingest.sentry.io/123",
      filesOrigin: "https://app-prod-files-123.s3.ap-northeast-1.amazonaws.com/some/path?x=1",
    });
    const csp = cspOf(await app.request("/"));
    const files = "https://app-prod-files-123.s3.ap-northeast-1.amazonaws.com";
    expect(csp).toContain(`connect-src 'self' https://o1.ingest.sentry.io ${files};`);
    expect(csp).toContain(`img-src 'self' data: ${files};`);
    // 置き場が無ければ足さない・http(s) 以外は入れない
    expect(cspOf(await setup().app.request("/"))).toContain("img-src 'self' data:;");
    expect(originOf("javascript:alert(1)")).toBeUndefined();
    expect(originOf("http://localhost:9000")).toBe("http://localhost:9000");
  });

  it("転送(302)・失敗(500)・ビルド済みの JS にも付く", async () => {
    const redirect = setup(() => Response.redirect("http://web/login", 302)).app;
    expect(cspOf(await redirect.request("/projects"))).toContain("default-src 'self'");
    const failing = setup(() => {
      throw new Error("x");
    }).app;
    expect(cspOf(await failing.request("/"))).toContain("default-src 'self'");
    expect(cspOf(await failing.request("/assets/app-abc123.js"))).toContain("default-src 'self'");
  });
});

describe("検索に載せない", () => {
  it.each([undefined, "local", "preview", "stg"])(
    "本番以外(%s)は、公開してよいページの一覧に関わらず全部に noindex",
    async (appEnv) => {
      const { app } = setup(undefined, { appEnv, indexablePaths: ["/login"] });
      for (const path of ["/login", "/projects", "/assets/app-abc123.js", "/favicon.svg"]) {
        expect((await app.request(path)).headers.get("x-robots-tag"), path).toBe(
          "noindex, nofollow",
        );
      }
    },
  );

  it("本番も既定は全部に noindex(ログイン後の画面を含む)", async () => {
    const { app } = setup(undefined, { appEnv: "prod" });
    for (const path of ["/", "/login", "/projects/1", "/audit"]) {
      expect((await app.request(path)).headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
    }
  });

  it("本番で一覧に書いたページだけは外す(ほかは付いたまま)", async () => {
    const { app } = setup(undefined, { appEnv: "prod", indexablePaths: ["/login"] });
    expect((await app.request("/login")).headers.get("x-robots-tag")).toBeNull();
    expect((await app.request("/projects")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("SSR の転送(302)と失敗(500)にも付く", async () => {
    const redirect = setup(() => Response.redirect("http://web/login", 302)).app;
    expect((await redirect.request("/projects")).headers.get("x-robots-tag")).toBe(
      "noindex, nofollow",
    );
    const broken = setup(() => {
      throw new Error("x");
    }).app;
    expect((await broken.request("/")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("robots.txt: 本番以外は全部お断り・本番は API だけお断り", async () => {
    for (const appEnv of [undefined, "local", "preview", "stg"]) {
      const res = await setup(undefined, { appEnv }).app.request("/robots.txt");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(await res.text()).toBe("User-agent: *\nDisallow: /\n");
    }
    const prod = await setup(undefined, { appEnv: "prod" }).app.request("/robots.txt");
    expect(await prod.text()).toBe("User-agent: *\nDisallow: /api/\n");
  });
});

describe("public/ の物", () => {
  it("favicon は SSR に回さずに返す。無い物は SSR に回さずに 404", async () => {
    let called = 0;
    const { app } = setup(() => {
      called += 1;
      return new Response("<html></html>");
    });
    const icon = await app.request("/favicon.svg");
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toContain("image/svg+xml");
    expect(icon.headers.get("cache-control")).toBe("public, max-age=86400");
    for (const path of ["/favicon.ico", "/apple-touch-icon.png", "/wp-login.php"]) {
      expect((await app.request(path)).status, path).toBe(404);
    }
    expect(called).toBe(0);
    // 拡張子の無いパスは、これまでどおり SSR が描く(存在しない画面の 404 も SSR が決める)
    await app.request("/no-such");
    expect(called).toBe(1);
  });
});
