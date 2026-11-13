import type { Me, Project, Task } from "@app/shared";
import {
  ActionMenu,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
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
  // 「…」から「消す」を選んだタスク(確かめるダイアログを開いている間だけ)
  const [deleting, setDeleting] = useState<Task | null>(null);

  // 完了は戻せるので、確かめずに「元に戻す」を付ける。消すは戻せないので確かめる(手引き docs/guides/ux-review.md の 7)
  function setDone(t: Task, done: boolean) {
    return changing.run(() => api.updateTask(t.id, { done }), {
      success: done ? `「${t.title}」を完了にしました` : `「${t.title}」を未完了に戻しました`,
      undo: {
        label: "元に戻す",
        onPress: () => void changing.run(() => api.updateTask(t.id, { done: !done })),
      },
    });
  }

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
  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <Stack gap={4}>
      <div>
        <Link href="/" variant="back">
          ← プロジェクト一覧
        </Link>
      </div>
      <Stack gap={1}>
        <Heading level={1}>{project.name}</Heading>
        {tasks.length > 0 && (
          <Muted>
            タスク {tasks.length}件のうち {doneCount}件 完了
          </Muted>
        )}
      </Stack>
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
        <TasksEmpty filter={filter} writable={writable} />
      ) : (
        <List label="タスク一覧">
          {shown.map((t) => (
            <li key={t.id}>
              <Inline justify="between" align="center">
                <Checkbox
                  isSelected={t.done}
                  isDisabled={!writable || changing.pending}
                  onChange={(done) => setDone(t, done)}
                >
                  {t.title}
                </Checkbox>
                {writable && (
                  <ActionMenu
                    label={`${t.title} の操作`}
                    isDisabled={changing.pending}
                    items={[{ id: "delete", label: "消す", isDestructive: true }]}
                    onAction={() => setDeleting(t)}
                  />
                )}
              </Inline>
            </li>
          ))}
        </List>
      )}
      <ConfirmDialog
        isOpen={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="タスクを消しますか?"
        confirmLabel="消す"
        isDestructive
        onConfirm={async () => {
          const t = deleting;
          if (!t) return;
          await changing.run(() => api.deleteTask(t.id), {
            success: `「${t.title}」を消しました`,
          });
        }}
      >
        「{deleting?.title}
        」を消します。元に戻せません。終わったときは、消さずに完了にしてください。
      </ConfirmDialog>
    </Stack>
  );
}

/** タスクが無いとき。絞り込みに合わせた文と、何をすれば増えるか(🎨 の棚卸しの所見 8) */
function TasksEmpty({ filter, writable }: { filter: TaskFilter; writable: boolean }) {
  return (
    <EmptyState
      title={
        filter === "done"
          ? "完了したタスクはまだありません"
          : filter === "open"
            ? "未完了のタスクはありません"
            : "まだタスクはありません"
      }
      description={
        filter !== "all"
          ? "「表示」を「すべて」にすると、ほかのタスクも見られます。"
          : writable
            ? "上の「新しいタスク」に、やることを入れて足せます。"
            : "タスクを足せるのは、メンバー以上の人です。"
      }
    />
  );
}
