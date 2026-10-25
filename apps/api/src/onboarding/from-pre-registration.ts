// 事前登録(公開の LP。docs/specs/0025-public-landing-page.md)から組織を作るときの、申込書との合わせ方
// (docs/designs/0025-public-landing-page.md の 5)。
// 組織の名前と最初の管理者のメールアドレスは、本人が確認した事前登録の値で埋める。ほかの項目(管理者の名前・
// 時間帯・二段階認証・プラン)は申込書から。申込書にも名前やメールがあって事前登録と違えば止める(取り違えを防ぐ)。
// どの項目が違ったかだけを言い、値は出さない(ログと画面に会社名・メールを残さない)。

export type PreRegistrationValues = { organizationName: string; adminEmail: string };

/** 申込書(JSON を読んだ値)に、事前登録の名前とメールを入れる。違う値があれば、項目の名前だけを言って投げる */
export function withPreRegistration(raw: unknown, pre: PreRegistrationValues): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("申し込みの JSON の形が違います(オブジェクトではない)");
  }
  const application = raw as Record<string, unknown>;
  const admin = application.admin;
  if (
    admin !== undefined &&
    (typeof admin !== "object" || admin === null || Array.isArray(admin))
  ) {
    throw new Error("申し込みの JSON の形が違います(admin)");
  }
  const adminFields = (admin ?? {}) as Record<string, unknown>;
  const differs: string[] = [];
  if (application.name !== undefined && !sameText(application.name, pre.organizationName)) {
    differs.push("name");
  }
  if (adminFields.email !== undefined && !sameEmail(adminFields.email, pre.adminEmail)) {
    differs.push("admin.email");
  }
  if (differs.length > 0) {
    throw new Error(
      `申込書と事前登録で値が違います: ${differs.join(", ")}(同じ会社・同じ人の申し込みかを確かめてください。何も作っていません)`,
    );
  }
  return {
    ...application,
    name: pre.organizationName,
    admin: { ...adminFields, email: pre.adminEmail },
  };
}

const sameText = (value: unknown, expected: string) =>
  typeof value === "string" && value.trim() === expected.trim();

const sameEmail = (value: unknown, expected: string) =>
  typeof value === "string" && value.trim().toLowerCase() === expected.trim().toLowerCase();
