import { TaskMailSchema } from "@app/shared";
import { createRoute } from "@hono/zod-openapi";
import { scopeOf } from "../../db/scope.ts";
import { authErrors, createRouter, json } from "../../http/common.ts";
import { getTaskMail, setTaskMail } from "./task-mail.ts";

// 組織の「タスクが完了したメール」を止める・戻す(docs/specs/0093-task-mail-switch.md)。管理者だけ(policy.ts の task_mail:manage)。
// 二段階認証の必須と同じく、戻す・止めるを POST / DELETE に分けて、監査ログの名前で向きが分かるようにする。

const tags = ["organization"];
const changed = { 204: { description: "変えた(次に送る直前から効く)" } };

export const taskMailRoutes = createRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/organization/task-mail",
      tags,
      summary: "【管理者】この組織で「タスクが完了したメール」を送っているか",
      responses: { 200: json(TaskMailSchema, "状態"), ...authErrors },
    }),
    async (c) => c.json(await getTaskMail(scopeOf(c)), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/organization/task-mail",
      tags,
      summary: "【管理者】「タスクが完了したメール」を送るに戻す(止めていた間の分は送らない)",
      responses: { ...changed, ...authErrors },
    }),
    async (c) => {
      await setTaskMail(scopeOf(c), true);
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/organization/task-mail",
      tags,
      summary: "【管理者】「タスクが完了したメール」を止める(まだ送っていない分も送らない)",
      responses: { ...changed, ...authErrors },
    }),
    async (c) => {
      await setTaskMail(scopeOf(c), false);
      return c.body(null, 204);
    },
  );
