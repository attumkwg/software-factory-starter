// OpenAPI の定義をファイルに書き出す(pnpm openapi → apps/api/openapi.json)。
// DB にはつながない。ZAP の API スキャンや、画面側のクライアント生成に使う。
import { writeFileSync } from "node:fs";
import { buildOpenApiDocument } from "../test/helpers/openapi.ts";

const doc = buildOpenApiDocument("dev");
writeFileSync(new URL("../openapi.json", import.meta.url), `${JSON.stringify(doc, null, 2)}\n`);
console.log(`openapi.json: ${Object.keys(doc.paths ?? {}).length} paths`);
