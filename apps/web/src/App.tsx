import type { Me, Project } from "@app/shared";
import { Badge, Button, Inline, Muted, Page, Stack } from "@app/ui";
import { useCallback, useEffect, useState } from "react";
import { api, HttpError } from "./api.ts";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ProjectsPage } from "./pages/ProjectsPage.tsx";
import { TasksPage } from "./pages/TasksPage.tsx";
import { roleLabel } from "./permissions.ts";

// 画面は3つ: ログイン → プロジェクト → タスク。ルーターは使わず、状態で切り替える(最小)。
// 見た目は @app/ui の部品だけで作る(apps/web/CLAUDE.md)。
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

  if (me === undefined) {
    return (
      <Page>
        <Muted>読み込み中…</Muted>
      </Page>
    );
  }
  if (me === null) return <LoginPage onLoggedIn={loadMe} />;

  return (
    <Page>
      <Stack gap={6}>
        <header>
          <Inline justify="between" align="center">
            <Inline gap={2} align="center">
              <strong>{me.tenantName}</strong>
              <span>{me.name}</span>
              <Badge tone={me.role === "admin" ? "info" : "neutral"}>
                <span data-testid="role" data-role={me.role}>
                  {roleLabel(me.role)}
                </span>
              </Badge>
            </Inline>
            <Button
              variant="ghost"
              onPress={async () => {
                await api.logout();
                setProject(null);
                setMe(null);
              }}
            >
              ログアウト
            </Button>
          </Inline>
        </header>
        <main>
          {project ? (
            <TasksPage me={me} project={project} onBack={() => setProject(null)} />
          ) : (
            <ProjectsPage me={me} onOpen={setProject} />
          )}
        </main>
      </Stack>
    </Page>
  );
}
