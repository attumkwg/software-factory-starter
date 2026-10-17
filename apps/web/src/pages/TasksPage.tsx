import type { Me, Project, Task } from "@app/shared";
import {
  Button,
  Checkbox,
  Heading,
  Inline,
  List,
  Muted,
  Select,
  Stack,
  TextField,
  useToast,
} from "@app/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { canWrite } from "../permissions.ts";

const FILTERS = [
  { id: "all", label: "すべて" },
  { id: "open", label: "未完了" },
  { id: "done", label: "完了" },
];

export function TasksPage({
  me,
  project,
  onBack,
}: {
  me: Me;
  project: Project;
  onBack: () => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [filter, setFilter] = useState("all");
  const writable = canWrite(me.role);
  const toast = useToast();

  const reload = useCallback(
    async () => setTasks((await api.listTasks(project.id)).tasks),
    [project.id],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await api.createTask(project.id, { title });
    setTitle("");
    await reload();
    toast.show("タスクを足しました");
  }

  const shown = tasks.filter((t) => filter === "all" || (filter === "done" ? t.done : !t.done));

  return (
    <Stack gap={4}>
      <div>
        <Button variant="ghost" onPress={onBack}>
          ← プロジェクト一覧
        </Button>
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
              />
              <Button type="submit" variant="primary">
                足す
              </Button>
            </Inline>
          </form>
        )}
        <Select label="表示" options={FILTERS} value={filter} onChange={setFilter} />
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
                  isDisabled={!writable}
                  onChange={async (done) => {
                    await api.updateTask(t.id, { done });
                    await reload();
                  }}
                >
                  {t.title}
                </Checkbox>
                {writable && (
                  <Button
                    size="sm"
                    aria-label={`${t.title} を消す`}
                    onPress={async () => {
                      await api.deleteTask(t.id);
                      await reload();
                      toast.show("タスクを消しました");
                    }}
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
