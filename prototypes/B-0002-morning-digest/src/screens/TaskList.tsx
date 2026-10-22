import { Badge, type BadgeTone, Button, Heading, Inline, Muted, Stack, Table } from "@app/ui";
import { type DueTask, tasks } from "../data.ts";

const tone: Record<DueTask["due"], BadgeTone> = { 過ぎた: "danger", 今日: "warning", 明日: "info" };

// ② まとめから開いた先。「誰に催促するか」を、ここで決められるかを観る画面
export function TaskList({ next }: { next: () => void }) {
  return (
    <Stack gap={4}>
      <Heading level={1}>期限が近いタスク</Heading>
      <Muted>担当ごとに見て、声をかける相手を決める(押しても何も起きません)</Muted>
      <Table
        label="期限が近いタスク"
        rows={tasks}
        columns={[
          { id: "title", header: "タスク", isRowHeader: true, cell: (t) => t.title },
          { id: "project", header: "プロジェクト", cell: (t) => t.project },
          { id: "assignee", header: "担当", cell: (t) => t.assignee },
          { id: "due", header: "期限", cell: (t) => <Badge tone={tone[t.due]}>{t.due}</Badge> },
        ]}
      />
      <Inline>
        <Button onPress={next}>まとめの設定へ</Button>
      </Inline>
    </Stack>
  );
}
