import { describe, expect, it } from "vitest";
import { PUBLIC, ROUTE_RULES } from "../../src/authz/policy.ts";
import { loadMatrix } from "../helpers/matrix.ts";
import { listOperations } from "../helpers/openapi.ts";

// 権限の表の ① : OpenAPI の全 API が docs/authz/matrix.yaml にあるか。
// AI が API を足しても、表に1行足さない限りここで落ちる(= 人が「誰に許すか」を判断する場所を通る)。

const matrix = loadMatrix();
const matrixRoutes = new Set(matrix.map((r) => r.route));
// 認証の方式で生える API が違うので、両方の形で組み立てて合わせる
const operations = [...new Set([...listOperations("dev"), ...listOperations("cognito")])].sort();

describe("権限の表(matrix.yaml)の網羅", () => {
  it("OpenAPI の全 API が表にある", () => {
    const missing = operations.filter((op) => !matrixRoutes.has(op));
    expect(missing, "matrix.yaml に行を足してください(.claude/skills/add-api-endpoint)").toEqual(
      [],
    );
  });

  it("表に、もう無い API が残っていない", () => {
    const stale = [...matrixRoutes].filter((r) => !operations.includes(r));
    expect(stale, "matrix.yaml から消してください").toEqual([]);
  });

  it("表の permission と、コードの決まり(policy.ts)が同じ", () => {
    const diff = matrix
      .filter((row) => ROUTE_RULES[row.route] !== row.permission)
      .map(
        (row) =>
          `${row.route}: 表=${row.permission} コード=${ROUTE_RULES[row.route] ?? "(なし=拒否)"}`,
      );
    expect(diff).toEqual([]);
  });

  it("ログインが要らない API は、表で public と明示したものだけ", () => {
    const publicInCode = Object.entries(ROUTE_RULES)
      .filter(([route, rule]) => rule === PUBLIC && operations.includes(route))
      .map(([route]) => route)
      .sort();
    const publicInMatrix = matrix
      .filter((r) => r.permission === PUBLIC)
      .map((r) => r.route)
      .sort();
    expect(publicInCode).toEqual(publicInMatrix);
  });
});
