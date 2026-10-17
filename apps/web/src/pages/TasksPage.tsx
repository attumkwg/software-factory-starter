import type { Me, Project, Task } from "@app/shared";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { canWrite } from "../permissions.ts";

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
  const writable = canWrite(me.role);

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
  }

  return (
    <main>
      <button type="button" className="link" onClick={onBack}>
        ← プロジェクト一覧
      </button>
      <h1>{project.name}</h1>
      {writable && (
        <form onSubmit={add} className="row">
          <input
            aria-label="新しいタスク"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="やること"
          />
          <button type="submit">足す</button>
        </form>
      )}
      <ul className="list" aria-label="タスク一覧">
        {tasks.map((t) => (
          <li key={t.id}>
            <label className={t.done ? "done" : undefined}>
              <input
                type="checkbox"
                checked={t.done}
                disabled={!writable}
                onChange={async () => {
                  await api.updateTask(t.id, { done: !t.done });
                  await reload();
                }}
              />
              {t.title}
            </label>
            {writable && (
              <button
                type="button"
                aria-label={`${t.title} を消す`}
                onClick={async () => {
                  await api.deleteTask(t.id);
                  await reload();
                }}
              >
                消す
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
