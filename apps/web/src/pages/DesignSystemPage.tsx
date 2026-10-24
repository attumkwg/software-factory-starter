import {
  Alert,
  Badge,
  type BadgeTone,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Heading,
  Inline,
  Link,
  List,
  Muted,
  Page,
  QrCode,
  Select,
  Stack,
  Table,
  type TableColumn,
  Text,
  TextField,
  useToast,
} from "@app/ui";
import { type ReactNode, useState } from "react";

// 部品の一覧(docs/designs/0011-visual-regression.md)。@app/ui の部品を種類ごとに並べる見本。
// 値はすべて固定の見本(API を読まない・保存しない)。見た目の回帰テスト(e2e/vrt)もこのページを撮る。
// 部品を足したら、ここにも並べる(docs/design-system.md の「部品を足す手順」)。

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2}>{title}</Heading>
        {children}
      </Stack>
    </Card>
  );
}

function Buttons() {
  return (
    <Section title="ボタン(Button)">
      <Inline gap={2} align="center">
        <Button variant="primary">primary</Button>
        <Button variant="secondary">secondary</Button>
        <Button variant="danger">danger</Button>
        <Button variant="ghost">ghost</Button>
      </Inline>
      <Inline gap={2} align="center">
        <Button variant="primary" size="sm">
          小さい primary
        </Button>
        <Button size="sm">小さい secondary</Button>
        <Button variant="primary" isDisabled>
          押せない
        </Button>
      </Inline>
    </Section>
  );
}

function Links() {
  return (
    <Section title="リンク(Link)">
      <Inline gap={4} align="center">
        <Link href="/">文中のリンク</Link>
        <Link href="/" variant="back">
          ← 戻る
        </Link>
      </Inline>
    </Section>
  );
}

function Fields() {
  const [name, setName] = useState("見本の計画");
  const [role, setRole] = useState("member");
  return (
    <Section title="入力(TextField)と選択(Select)">
      <TextField
        label="名前"
        description="説明の文は入力欄の下に出る"
        value={name}
        onChange={setName}
      />
      <TextField
        label="メールアドレス"
        type="email"
        isInvalid
        errorMessage="形が正しくありません"
      />
      <TextField label="パスワード" type="password" autoComplete="new-password" />
      <Select
        label="ロール"
        options={[
          { id: "admin", label: "管理者" },
          { id: "member", label: "メンバー" },
          { id: "viewer", label: "閲覧者" },
        ]}
        value={role}
        onChange={setRole}
      />
    </Section>
  );
}

function Checkboxes() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(true);
  const [agreed, setAgreed] = useState(true);
  return (
    <Section title="チェック(Checkbox)">
      <Checkbox isSelected={open} onChange={setOpen}>
        まだのタスク
      </Checkbox>
      <Checkbox isSelected={done} onChange={setDone}>
        済んだタスク(文字に線)
      </Checkbox>
      <Checkbox isSelected={agreed} onChange={setAgreed} strikeWhenSelected={false}>
        同意する(線を引かない)
      </Checkbox>
      <Checkbox isSelected={false} onChange={() => {}} isDisabled>
        押せない
      </Checkbox>
    </Section>
  );
}

type SampleRow = { id: string; name: string; role: string; tone: BadgeTone; status: string };

const SAMPLE_ROWS: SampleRow[] = [
  { id: "1", name: "見本 太郎", role: "管理者", tone: "info", status: "使える" },
  { id: "2", name: "見本 花子", role: "メンバー", tone: "neutral", status: "招待中" },
  { id: "3", name: "見本 次郎", role: "閲覧者", tone: "neutral", status: "止めた" },
];

const SAMPLE_COLUMNS: TableColumn<SampleRow>[] = [
  { id: "name", header: "名前", isRowHeader: true, cell: (r) => r.name },
  { id: "role", header: "ロール", cell: (r) => <Badge tone={r.tone}>{r.role}</Badge> },
  { id: "status", header: "状態", cell: (r) => r.status },
];

function Tables() {
  return (
    <Section title="表(Table)と一覧(List)">
      <Table label="見本の表" columns={SAMPLE_COLUMNS} rows={SAMPLE_ROWS} />
      <Table
        label="見本の空の表"
        columns={SAMPLE_COLUMNS}
        rows={[]}
        emptyMessage="まだ何もありません"
      />
      <List label="見本の一覧">
        <li>1つ目の項目</li>
        <li>2つ目の項目</li>
        <li>3つ目の項目</li>
      </List>
    </Section>
  );
}

const BADGE_TONES: BadgeTone[] = ["neutral", "info", "success", "warning", "danger"];

function Notices() {
  return (
    <Section title="お知らせ(Alert)と札(Badge)">
      <Alert tone="info">画面に残すお知らせ(info)</Alert>
      <Alert tone="danger">失敗のお知らせ(danger。出たときに読み上げる)</Alert>
      <Inline gap={2} align="center">
        {BADGE_TONES.map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
      </Inline>
    </Section>
  );
}

function Feedback() {
  const toast = useToast();
  return (
    <Section title="確認のダイアログ(ConfirmDialog)とトースト(useToast)">
      <Inline gap={2} align="center">
        <ConfirmDialog
          trigger={<Button variant="danger">消す</Button>}
          title="見本を消しますか?"
          confirmLabel="消す"
          isDestructive
          onConfirm={() => toast.show("見本なので、何も消していません")}
        >
          <Text>戻せない操作の前に出す確認(見本なので、押しても何も消えません)。</Text>
        </ConfirmDialog>
        <Button onPress={() => toast.show("トーストの見本です")}>トーストを出す</Button>
      </Inline>
    </Section>
  );
}

function Others() {
  return (
    <Section title="QR コード(QrCode)と文字(Text・Muted)">
      <QrCode value="https://example.test/design-system" label="見本の QR コード" />
      <Text>本文の段落(Text)。長い文は画面の幅で折り返す。</Text>
      <Muted>補足の文字(Muted)。薄い色で出す。</Muted>
    </Section>
  );
}

export function DesignSystemPage() {
  return (
    <Page>
      <main>
        <Stack gap={6}>
          <Stack gap={2}>
            <Heading level={1}>部品の一覧</Heading>
            <Muted>
              @app/ui(packages/ui)の部品の見本です。本番では出ません。使い方の決まりは
              docs/design-system.md。
            </Muted>
          </Stack>
          <Buttons />
          <Links />
          <Fields />
          <Checkboxes />
          <Tables />
          <Notices />
          <Feedback />
          <Others />
        </Stack>
      </main>
    </Page>
  );
}
