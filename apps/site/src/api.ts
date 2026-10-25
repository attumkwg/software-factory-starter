// API の公開の入口(/api/public/*)へ送る。Cookie は送らない(credentials: "omit")。CORS は API がこのページの origin だけに開く。

export type PostResult = "ok" | "bad_request" | "failed";

export async function postPublic(appUrl: string, path: string, body: unknown): Promise<PostResult> {
  try {
    const res = await fetch(`${appUrl}/api/public/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      keepalive: true,
    });
    if (res.ok) return "ok";
    return res.status === 400 ? "bad_request" : "failed";
  } catch {
    return "failed";
  }
}
