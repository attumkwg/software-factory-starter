import type { TaskMail } from "@app/shared";
import { Badge, Button, Card, Heading, Inline, Muted, Stack } from "@app/ui";
import { api } from "../../api.ts";
import { useAction } from "../../use-action.ts";

// 組織の「タスクが完了したメール」を止める・戻す(管理者だけ。docs/specs/0093-task-mail-switch.md)。
// 止めると、まだ送っていない分も送らない。戻しても、止めていた間の分は後から送らない。

export function TaskMailCard({ state }: { state: TaskMail }) {
  const action = useAction();
  return (
    <Card>
      <Stack gap={2}>
        <Inline gap={2} align="center">
          <Heading level={2}>タスクが完了したメール</Heading>
          <Badge tone={state.enabled ? "success" : "neutral"}>
            {state.enabled ? "送る" : "止めている"}
          </Badge>
        </Inline>
        <Muted>
          タスクが完了したら、そのプロジェクトを作った人にメールで知らせます。止めると、この組織の全員に届かなくなります。戻しても、止めていた間に完了した分は届きません。
        </Muted>
        <div>
          {state.enabled ? (
            <Button
              variant="secondary"
              isDisabled={action.pending}
              onPress={() => action.run(() => api.disableTaskMail(), { success: "止めました" })}
            >
              止める
            </Button>
          ) : (
            <Button
              variant="primary"
              isDisabled={action.pending}
              onPress={() =>
                action.run(() => api.enableTaskMail(), { success: "送るに戻しました" })
              }
            >
              送るに戻す
            </Button>
          )}
        </div>
      </Stack>
    </Card>
  );
}
