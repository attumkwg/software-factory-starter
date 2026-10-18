import type { Me, Project, Task } from "@app/shared";
import {
  Button,
  Checkbox,
  Heading,
  Inline,
  Link,
  List,
  Muted,
  Select,
  Stack,
  TextField,
} from "@app/ui";
import { type FormEvent, useState } from "react";
import { api } from "../api.ts";
import { canWrite } from "../permissions.ts";
import { useAction } from "../use-action.ts";

export const TASK_FILTERS = [
  { id: "all", label: "すべて" },
  { id: "open", label: "未完了" },
  { id: "done", label: "完了" },
] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number]["id"];

/** URL の ?filter= を読む。知らない値は「すべて」に。 */
export function toTaskFilter(value: unknown): TaskFilter {
  return TASK_FILTERS.find((f) => f.id === value)?.id ?? "all";
}

// データは route(routes/_app/projects/$projectId.tsx)の loader が SSR で読む。
// 書き込みは useAction を通す(成功したら読み直し、失敗したら次に何をすればよいかを出す)。
export function TasksPage({
  me,
  project,
  tasks,
  filter,
  onFilterChange,
}: {
  me: Me;
  project: Project;
  tasks: Task[];
  filter: TaskFilter;
  onFilterChange: (filter: TaskFilter) => void;
}) {
  const [title, setTitle] = useState("");
  const writable = canWrite(me.role);
  const adding = useAction();
  // 完了の切り替えと削除。1つずつ送る(実行中は押せない)
  const changing = useAction();

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const ok = await adding.run(() => api.createTask(project.id, { title }), {
      success: "タスクを足しました",
      showErrorAs: "inline",
    });
    if (ok) setTitle("");
  }

  const shown = tasks.filter((t) => filter === "all" || (filter === "done" ? t.done : !t.done));

  return (
    <Stack gap={4}>
      <div>
        <Link href="/" variant="back">
          ← プロジェクト一覧
        </Link>
      </div>
      <Heading level={1}>{project.name}</Heading>
      <Inline gap={4}>
        {writable && (
          <form onSubmit={add}>
            <Inline gap={2}>
              <TextField
                label="新しいタスク"
                value={title}
                onChange={setTitle}
                placeholder="やること"
                isInvalid={adding.errorMessage !== undefined}
                errorMessage={adding.errorMessage}
              />
              <Button type="submit" variant="primary" isDisabled={adding.pending}>
                足す
              </Button>
            </Inline>
          </form>
        )}
        <Select
          label="表示"
          options={[...TASK_FILTERS]}
          value={filter}
          onChange={(value) => onFilterChange(toTaskFilter(value))}
        />
      </Inline>
      {shown.length === 0 ? (
        <Muted>タスクはありません</Muted>
      ) : (
        <List label="タスク一覧">
          {shown.map((t) => (
            <li key={t.id}>
              <Inline justify="between" align="center">
                <Checkbox
                  isSelected={t.done}
                  isDisabled={!writable || changing.pending}
                  onChange={(done) => changing.run(() => api.updateTask(t.id, { done }))}
                >
                  {t.title}
                </Checkbox>
                {writable && (
                  <Button
                    size="sm"
                    aria-label={`${t.title} を消す`}
                    isDisabled={changing.pending}
                    onPress={() =>
                      changing.run(() => api.deleteTask(t.id), { success: "タスクを消しました" })
                    }
                  >
                    消す
                  </Button>
                )}
              </Inline>
            </li>
          ))}
        </List>
      )}
    </Stack>
  );
}
