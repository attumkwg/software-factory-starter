// 証跡の集め先(AWS。evidence.yml の役割で、本番のアカウントの設定を読む)。データ(DB・S3 の中身)は読まない。
// ctx.aws(args) は scripts/evidence/lib.mjs の awsCli と同じ形({ ok, data } か { ok: false, message })。
const pass = (data) => ({ ok: true, data });

async function iamSummary(ctx) {
  const res = ctx.aws(["iam", "get-account-summary"]);
  return res.ok ? pass(res.data?.SummaryMap ?? {}) : res;
}

/** 資格情報のレポート(CSV)を、行ごとの物にする。鍵そのものは入っていない(有無・古さ・最後に使った日だけ) */
export function parseCredentialReport(csv) {
  const [head, ...rows] = String(csv).trim().split("\n");
  const keys = head.split(",");
  const keep = [
    "user",
    "user_creation_time",
    "password_enabled",
    "password_last_used",
    "mfa_active",
    "access_key_1_active",
    "access_key_1_last_rotated",
    "access_key_1_last_used_date",
    "access_key_2_active",
    "access_key_2_last_rotated",
    "access_key_2_last_used_date",
  ];
  return rows.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(keep.map((k) => [k, cells[keys.indexOf(k)] ?? null]));
  });
}

async function iamUsers(ctx) {
  for (let i = 0; i < 10; i++) {
    const gen = ctx.aws(["iam", "generate-credential-report"]);
    if (!gen.ok) return gen;
    if (gen.data?.State === "COMPLETE") break;
    await ctx.sleep(2000);
  }
  const res = ctx.aws(["iam", "get-credential-report"]);
  if (!res.ok) return res;
  const csv = Buffer.from(res.data?.Content ?? "", "base64").toString("utf8");
  return pass({ generated_at: res.data?.GeneratedTime, users: parseCredentialReport(csv) });
}

async function iamRoles(ctx) {
  const res = ctx.aws([
    "iam",
    "list-roles",
    "--query",
    "Roles[].{name:RoleName,path:Path,created:CreateDate,max_session:MaxSessionDuration}",
  ]);
  return res.ok ? pass(res.data ?? []) : res;
}

/** Security Hub の点数(管理策ごとに、全部の見つけ物が PASSED なら合格)。金額や中身は入れない */
export function securityScore(findings) {
  const byControl = new Map();
  for (const f of findings ?? []) {
    if (!f?.c || !["PASSED", "FAILED"].includes(f.s)) continue;
    const prev = byControl.get(f.c) ?? { failed: false, severity: "INFORMATIONAL" };
    if (f.s === "FAILED") byControl.set(f.c, { failed: true, severity: f.v ?? prev.severity });
    else if (!byControl.has(f.c)) byControl.set(f.c, prev);
  }
  const failed = [...byControl].filter(([, v]) => v.failed);
  const total = byControl.size;
  const failedBySeverity = {};
  for (const [, v] of failed)
    failedBySeverity[v.severity] = (failedBySeverity[v.severity] ?? 0) + 1;
  return {
    score_percent: total === 0 ? null : Math.round(((total - failed.length) / total) * 100),
    controls: total,
    failed_controls: failed.map(([id]) => id).sort(),
    failed_by_severity: failedBySeverity,
  };
}

async function securityHub(ctx) {
  const filters = JSON.stringify({
    RecordState: [{ Value: "ACTIVE", Comparison: "EQUALS" }],
    ProductName: [{ Value: "Security Hub", Comparison: "EQUALS" }],
  });
  const res = ctx.aws([
    "securityhub",
    "get-findings",
    "--filters",
    filters,
    "--query",
    "Findings[].{c:Compliance.SecurityControlId,s:Compliance.Status,v:Severity.Label}",
  ]);
  return res.ok ? pass(securityScore(res.data)) : res;
}

async function guardDuty(ctx) {
  const list = ctx.aws(["guardduty", "list-detectors"]);
  if (!list.ok) return list;
  const detectors = [];
  for (const id of list.data?.DetectorIds ?? []) {
    const d = ctx.aws(["guardduty", "get-detector", "--detector-id", id]);
    if (!d.ok) return d;
    detectors.push({
      status: d.data?.Status,
      publishing: d.data?.FindingPublishingFrequency,
      features: (d.data?.Features ?? []).map((f) => ({ name: f.Name, status: f.Status })),
    });
  }
  return pass(detectors);
}

async function backupVaults(ctx) {
  const res = ctx.aws(["backup", "list-backup-vaults"]);
  if (!res.ok) return res;
  return pass(
    (res.data?.BackupVaultList ?? []).map((v) => ({
      name: v.BackupVaultName,
      locked: v.Locked,
      lock_date: v.LockDate,
      min_retention_days: v.MinRetentionDays,
      max_retention_days: v.MaxRetentionDays,
      recovery_points: v.NumberOfRecoveryPoints,
    })),
  );
}

async function cloudTrail(ctx) {
  const res = ctx.aws(["cloudtrail", "describe-trails"]);
  if (!res.ok) return res;
  const trails = [];
  for (const t of res.data?.trailList ?? []) {
    const st = ctx.aws(["cloudtrail", "get-trail-status", "--name", t.TrailARN ?? t.Name]);
    trails.push({
      name: t.Name,
      multi_region: t.IsMultiRegionTrail,
      log_file_validation: t.LogFileValidationEnabled,
      logging: st.ok ? st.data?.IsLogging : null,
      latest_delivery: st.ok ? st.data?.LatestDeliveryTime : null,
    });
  }
  return pass(trails);
}

export const AWS_SOURCES = [
  {
    name: "aws-iam-summary",
    about: "IAM の要約(root の二段階認証・root の鍵の有無・利用者と役割の数)",
    collect: iamSummary,
  },
  {
    name: "aws-iam-users",
    about: "人の利用者ごとの二段階認証・パスワードと鍵の最後の利用・鍵の古さ(鍵の値は入らない)",
    collect: iamUsers,
  },
  { name: "aws-iam-roles", about: "役割の一覧(名前・作った日)", collect: iamRoles },
  {
    name: "aws-securityhub",
    about: "Security Hub の点数(管理策の合格の割合)と、落ちた管理策の番号",
    collect: securityHub,
  },
  { name: "aws-guardduty", about: "GuardDuty が有効か・見ている物", collect: guardDuty },
  {
    name: "aws-backup",
    about: "バックアップの保管庫(ロック・保存の期間・戻せる点の数)",
    collect: backupVaults,
  },
  {
    name: "aws-cloudtrail",
    about: "CloudTrail(全リージョン・改ざんの検知・記録中か)",
    collect: cloudTrail,
  },
];
