import type { Me, Project } from "@app/shared";
import { useCallback, useEffect, useState } from "react";
import { api, HttpError } from "./api.ts";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ProjectsPage } from "./pages/ProjectsPage.tsx";
import { TasksPage } from "./pages/TasksPage.tsx";

// 画面は3つ: ログイン → プロジェクト → タスク。ルーターは使わず、状態で切り替える(最小)。
export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [project, setProject] = useState<Project | null>(null);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) setMe(null);
      else throw e;
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  if (me === undefined) return <p className="container">読み込み中…</p>;
  if (me === null) return <LoginPage onLoggedIn={loadMe} />;

  return (
    <div className="container">
      <header className="header">
        <span>
          <strong>{me.tenantName}</strong> / {me.name}(<span data-testid="role">{me.role}</span>)
        </span>
        <button
          type="button"
          onClick={async () => {
            await api.logout();
            setProject(null);
            setMe(null);
          }}
        >
          ログアウト
        </button>
      </header>
      {project ? (
        <TasksPage me={me} project={project} onBack={() => setProject(null)} />
      ) : (
        <ProjectsPage me={me} onOpen={setProject} />
      )}
    </div>
  );
}
