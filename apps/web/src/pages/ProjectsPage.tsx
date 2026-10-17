import type { Me, Project } from "@app/shared";
import {
  Button,
  ConfirmDialog,
  Heading,
  Inline,
  Stack,
  Table,
  type TableColumn,
  TextField,
  useToast,
} from "@app/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { canDeleteProject, canWrite } from "../permissions.ts";

export function ProjectsPage({ me, onOpen }: { me: Me; onOpen: (p: Project) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const toast = useToast();

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
    toast.show("プロジェクトを作りました");
  }

  const columns: TableColumn<Project>[] = [
    {
      id: "name",
      header: "名前",
      isRowHeader: true,
      cell: (p) => (
        <Button variant="ghost" onPress={() => onOpen(p)}>
          {p.name}
        </Button>
      ),
    },
    {
      id: "createdAt",
      header: "作った日",
      cell: (p) => new Date(p.createdAt).toLocaleDateString("ja-JP"),
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
