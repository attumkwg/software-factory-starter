import type { Me, Project } from "@app/shared";
import {
  Button,
  ConfirmDialog,
  Heading,
  Inline,
  Link,
  Stack,
  Table,
  type TableColumn,
  TextField,
  useToast,
} from "@app/ui";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api } from "../api.ts";
import { formatDate } from "../format.ts";
import { canDeleteProject, canWrite } from "../permissions.ts";

// 一覧のデータは route(routes/_app/index.tsx)の loader が SSR で読む。変えたら invalidate で読み直す。
export function ProjectsPage({ me, projects }: { me: Me; projects: Project[] }) {
  const [name, setName] = useState("");
  const toast = useToast();
  const router = useRouter();
  const reload = () => router.invalidate();

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.createProject({ name });
    setName("");
    await reload();
    toast.show("プロジェクトを作りました");
  }

  const columns: TableColumn<Project>[] = [
    {
      id: "name",
      header: "名前",
      isRowHeader: true,
      cell: (p) => <Link href={`/projects/${p.id}`}>{p.name}</Link>,
    },
    {
      id: "createdAt",
      header: "作った日",
      cell: (p) => formatDate(p.createdAt),
    },
  ];
  if (canDeleteProject(me.role)) {
    columns.push({
      id: "actions",
      header: "操作",
      cell: (p) => (
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="secondary" aria-label={`${p.name} を消す`}>
              消す
            </Button>
          }
          title="プロジェクトを消しますか?"
          confirmLabel="消す"
          isDestructive
          onConfirm={async () => {
            await api.deleteProject(p.id);
            await reload();
            toast.show("プロジェクトを消しました");
          }}
        >
          「{p.name}」と、中のタスクをすべて消します。元に戻せません。
        </ConfirmDialog>
      ),
    });
  }

  return (
    <Stack gap={4}>
      <Heading level={1}>プロジェクト</Heading>
      {canWrite(me.role) && (
        <form onSubmit={create}>
          <Inline gap={2}>
            <TextField
              label="新しいプロジェクトの名前"
              value={name}
              onChange={setName}
              placeholder="例: 春の新機能"
            />
            <Button type="submit" variant="primary">
              作る
            </Button>
          </Inline>
        </form>
      )}
      <Table label="プロジェクト一覧" columns={columns} rows={projects} />
    </Stack>
  );
}
