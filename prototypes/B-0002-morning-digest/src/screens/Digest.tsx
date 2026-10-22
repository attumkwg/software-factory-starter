import { Badge, Button, Card, Heading, Inline, List, Muted, Stack } from "@app/ui";
import { countBy, organization, tasks } from "../data.ts";

// ① 朝8時に届くメールの見た目。相手が「最初に何を見るか・何を押すか」を観る画面
export function Digest({ next }: { next: () => void }) {
  return (
    <Stack gap={4}>
      <Heading level={1}>おはようございます。今日の期限のまとめです</Heading>
      <Muted>{organization} ・ 毎朝 8:00 に届くメール(の見た目)</Muted>
      <Card>
        <Stack gap={3}>
          <Inline gap={2}>
            <Badge tone="danger">過ぎた {countBy("過ぎた")}件</Badge>
            <Badge tone="warning">今日 {countBy("今日")}件</Badge>
            <Badge tone="info">明日 {countBy("明日")}件</Badge>
          </Inline>
          <List label="期限が近いタスク">
            {tasks.map((t) => (
              <li key={t.id}>
                【{t.due}】{t.title}({t.project} ・ {t.assignee})
              </li>
            ))}
          </List>
          <Inline>
            <Button variant="primary" onPress={next}>
              一覧で開く
            </Button>
          </Inline>
        </Stack>
      </Card>
    </Stack>
  );
}
