/** 二段階認証の鍵を、手で入れるとき読みやすいよう4文字ずつ空白で区切る(認証アプリは空白を無視する) */
export function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}
