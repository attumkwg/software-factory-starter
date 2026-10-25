// 公開のページの「/confirm/」を「/confirm/index.html」に読み替える(S3 の非公開のバケットは、フォルダの index.html を返さない)。
// 拡張子の無い「/confirm」は「/confirm/」へ転送する。中身はビルドで作った静的なファイルだけ。
// CloudFront Functions(cloudfront-js-2.0)が handler を呼ぶ
// biome-ignore lint/correctness/noUnusedVariables: CloudFront が名前で呼ぶ
function handler(event) {
  const request = event.request;
  const uri = request.uri;
  if (uri.endsWith("/")) {
    request.uri = `${uri}index.html`;
    return request;
  }
  const last = uri.split("/").pop();
  if (last.indexOf(".") === -1) {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: { location: { value: `${uri}/` } },
    };
  }
  return request;
}
