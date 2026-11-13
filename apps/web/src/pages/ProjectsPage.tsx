import type { Me, Project } from "@app/shared";
import {
  ActionMenu,
  Button,
  ConfirmDialog,
  EmptyState,
  Heading,
  Inline,
  Link,
  Stack,
  Table,
  type TableColumn,
  TextField,
} from "@app/ui";
import { type FormEvent, useState } from "react";
import { api } from "../api.ts";
import { formatDate } from "../format.ts";
import { canDeleteProject, canWrite } from "../permissions.ts";
import { useAction } from "../use-action.ts";
import { PmfSurvey } from "./PmfSurvey.tsx";

// 一覧のデータは route(routes/_app/index.tsx)の loader が SSR で読む。
// 書き込みは useAction を通す(成功したら読み直し、失敗したら次に何をすればよいかを出す)。
export function ProjectsPage({
  me,
  projects,
  askSurvey = false,
}: {
  me: Me;
  projects: Project[];
  /** 「無くなったら困るか」を聞くか(GET /api/pmf-survey の ask) */
  askSurvey?: boolean;
}) {
  const [name, setName] = useState("");
  const creating = useAction();
  const deleting = useAction();
  // 「…」から「消す」を選んだプロジェクト(確かめるダイアログを開いている間だけ)
  const [toDelete, setToDelete] = useState<Project | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const ok = await creating.run(() => api.createProject({ name }), {
      success: "プロジェクトを作りました",
      showErrorAs: "inline",
    });
    if (ok) setName("");
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
      cell: (p) => formatDate(p.createdAt, me.timeZone),
    },
  ];
  if (canDeleteProject(me.role)) {
    columns.push({
      id: "actions",
      header: "操作",
      cell: (p) => (
        <ActionMenu
          label={`${p.name} の操作`}
          items={[{ id: "delete", label: "消す", isDestructive: true }]}
          onAction={() => setToDelete(p)}
        />
      ),
    });
  }

  return (
    <Stack gap={4}>
      <Heading level={1}>プロジェクト</Heading>
      {askSurvey && <PmfSurvey />}
      {canWrite(me.role) && (
        <form onSubmit={create}>
          <Inline gap={2}>
            <TextField
              label="新しいプロジェクトの名前"
              value={name}
              onChange={setName}
              placeholder="例: 春の新機能"
              isInvalid={creating.errorMessage !== undefined}
              errorMessage={creating.errorMessage}
            />
            <Button type="submit" variant="primary" isDisabled={creating.pending}>
              作る
            </Button>
          </Inline>
        </form>
      )}
      <Table
        label="プロジェクト一覧"
        columns={columns}
        rows={projects}
        emptyState={
          <EmptyState
            title="まだプロジェクトはありません"
            description={
              canWrite(me.role)
                ? "上の欄に名前を入れて作ると、その中にタスクを足せます。"
                : "プロジェクトを作れるのは、メンバー以上の人です。"
            }
          />
        }
      />
      <ConfirmDialog
        isOpen={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title="プロジェクトを消しますか?"
        confirmLabel="消す"
        isDestructive
        onConfirm={async () => {
          const p = toDelete;
          if (!p) return;
          await deleting.run(() => api.deleteProject(p.id), {
            success: "プロジェクトを消しました",
          });
        }}
      >
        「{toDelete?.name}」と、中のタスクをすべて消します。元に戻せません。
      </ConfirmDialog>
    </Stack>
  );
}
