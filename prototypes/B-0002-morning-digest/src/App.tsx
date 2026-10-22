import { Alert, Button, Inline, Muted, Page, Stack } from "@app/ui";
import { useState } from "react";
import { Digest } from "./screens/Digest.tsx";
import { Settings } from "./screens/Settings.tsx";
import { SignUp } from "./screens/SignUp.tsx";
import { TaskList } from "./screens/TaskList.tsx";

// 画面の流れ(3〜5枚)。URL は変えずに、ここで切り替える(置き場所の深いパスを作らない)
const screens = [
  { name: "朝のまとめ(メール)", Screen: Digest },
  { name: "まとめから開いた一覧", Screen: TaskList },
  { name: "まとめの設定", Screen: Settings },
  { name: "申し込み", Screen: SignUp },
];

export function App() {
  const [at, setAt] = useState(0);
  const current = screens[at] ?? screens[0];
  if (!current) return null;
  const { Screen } = current;
  return (
    <Page>
      <Stack gap={6}>
        <Alert tone="info">
          これは試作です。会社・人・タスクは架空で、押しても何も保存・送信されません。
        </Alert>
        <Screen next={() => setAt(Math.min(at + 1, screens.length - 1))} />
        <Inline justify="between" align="center">
          <Button variant="ghost" isDisabled={at === 0} onPress={() => setAt(at - 1)}>
            ← 前の画面
          </Button>
          <Muted>
            {at + 1} / {screens.length}: {current.name}
          </Muted>
          <Button
            variant="ghost"
            isDisabled={at === screens.length - 1}
            onPress={() => setAt(at + 1)}
          >
            次の画面 →
          </Button>
        </Inline>
      </Stack>
    </Page>
  );
}
