import { Button, Checkbox, Heading, Inline, Muted, Select, Stack } from "@app/ui";
import { useState } from "react";
import { projects } from "../data.ts";

const times = ["7:00", "8:00", "9:00", "届けない"].map((t) => ({ id: t, label: t }));

// ③ 届く時間と範囲。「どれを外したがるか」を観る画面(外したい物 = うるさい物)
export function Settings({ next }: { next: () => void }) {
  const [time, setTime] = useState("8:00");
  const [on, setOn] = useState<Record<string, boolean>>(
    Object.fromEntries(projects.map((p) => [p, true])),
  );
  return (
    <Stack gap={4}>
      <Heading level={1}>まとめの設定</Heading>
      <Muted>自分に届くまとめだけが変わります(試作なので保存されません)</Muted>
      <Select label="届く時間" options={times} value={time} onChange={setTime} />
      <Stack gap={2}>
        <Heading level={2}>まとめに入れるプロジェクト</Heading>
        {projects.map((p) => (
          <Checkbox key={p} isSelected={on[p] ?? false} onChange={(v) => setOn({ ...on, [p]: v })}>
            {p}
          </Checkbox>
        ))}
      </Stack>
      <Inline>
        <Button onPress={next}>次へ</Button>
      </Inline>
    </Stack>
  );
}
