// URL から読む物(来た所の UTM・確認と取り消しのリンクの token)。Cookie にも端末にも残さない。

export type Source = { utmSource?: string; utmMedium?: string; utmCampaign?: string };

/** ?utm_source=…&utm_medium=…&utm_campaign=…(整えるのは API。ここでは長さだけ切る) */
export function sourceFromSearch(search: string): Source {
  const params = new URLSearchParams(search);
  const take = (key: string) => params.get(key)?.slice(0, 200) || undefined;
  return {
    utmSource: take("utm_source"),
    utmMedium: take("utm_medium"),
    utmCampaign: take("utm_campaign"),
  };
}

/** メールのリンクの #t=<token>(# の後ろはサーバーに届かない) */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("t");
  return token && token.length <= 300 ? token : null;
}
