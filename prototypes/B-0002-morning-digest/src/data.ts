// 偽のデータだけ(架空)。本物の API・DB には触らない(pnpm prototypes が止める)。
// 会社・人・タスクの名前は全部つくりもの。実在の人や会社の名前を入れない。

export type DueTask = {
  id: string;
  title: string;
  project: string;
  assignee: string;
  due: "過ぎた" | "今日" | "明日";
};

export const organization = "サンプル商事(架空)";

export const tasks: DueTask[] = [
  { id: "t1", title: "見積書を送る", project: "春の展示会", assignee: "担当A", due: "過ぎた" },
  {
    id: "t2",
    title: "会場の下見の日を決める",
    project: "春の展示会",
    assignee: "担当B",
    due: "今日",
  },
  { id: "t3", title: "チラシの文を直す", project: "春の展示会", assignee: "担当A", due: "今日" },
  {
    id: "t4",
    title: "請求書の宛名を確かめる",
    project: "月末の締め",
    assignee: "担当C",
    due: "今日",
  },
  {
    id: "t5",
    title: "経費の領収書を集める",
    project: "月末の締め",
    assignee: "担当B",
    due: "明日",
  },
  {
    id: "t6",
    title: "新しい人の席を用意する",
    project: "4月の受け入れ",
    assignee: "担当C",
    due: "明日",
  },
];

export const projects = [...new Set(tasks.map((t) => t.project))];

export const countBy = (due: DueTask["due"]) => tasks.filter((t) => t.due === due).length;
