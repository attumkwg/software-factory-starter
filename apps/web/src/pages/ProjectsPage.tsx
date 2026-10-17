import type { Me, Project } from "@app/shared";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { canDeleteProject, canWrite } from "../permissions.ts";

export function ProjectsPage({ me, onOpen }: { me: Me; onOpen: (p: Project) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");

  const reload = useCallback(async () => setProjects((await api.listProjects()).projects), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.createProject({ name });
    setName("");
    await reload();
  }

  return (
    <main>
      <h1>プロジェクト</h1>
      {canWrite(me.role) && (
        <form onSubmit={create} className="row">
          <input
            aria-label="新しいプロジェクトの名前"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="プロジェクトの名前"
          />
          <button type="submit">作る</button>
        </form>
      )}
      <ul className="list" aria-label="プロジェクト一覧">
        {projects.map((p) => (
          <li key={p.id}>
            <button type="button" className="link" onClick={() => onOpen(p)}>
              {p.name}
            </button>
            {canDeleteProject(me.role) && (
              <button
                type="button"
                aria-label={`${p.name} を消す`}
                onClick={async () => {
                  await api.deleteProject(p.id);
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
