// 費用の集め方・まとめ方・ページのテスト(AWS・GitHub・Anthropic は偽物)。node --test scripts/cost/cost.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakeCtx, ok } from "../checkup/fake-context.mjs";
import { centsToJpy, periodOf, usdToCents } from "./period.mjs";
import { renderHtml } from "./render.mjs";
import { awsCost, groupsToCents, UNTAGGED } from "./source-aws.mjs";
import { anthropicCost, estimates, githubActions, saas } from "./source-other.mjs";
import { makeSummary } from "./summary.mjs";

test("期間: 月の初め・明日・来月・3か月前・何日目(月末と年またぎ)", () => {
  assert.deepEqual(periodOf("2026-10-25"), {
    today: "2026-10-25",
    month: "2026-10",
    monthStart: "2026-10-01",
    tomorrow: "2026-10-26",
    nextMonth: "2026-11-01",
    historyStart: "2026-07-01",
    day: 25,
    daysInMonth: 31,
  });
  const jan = periodOf("2027-01-31");
  assert.equal(jan.tomorrow, "2027-02-01");
  assert.equal(jan.historyStart, "2026-10-01");
  assert.equal(periodOf("2028-02-01").daysInMonth, 29);
});

test("お金: ドルの小数はセントの整数に、セントは円の整数に", () => {
  assert.equal(usdToCents("12.3456789"), 1235);
  assert.equal(usdToCents(undefined), 0);
  assert.equal(centsToJpy(1235, 150), 1853);
});

test("Cost Explorer の Groups: タグは値だけ・空はタグなし・0円は落とす", () => {
  const g = (k, a) => ({ Keys: [k], Metrics: { UnblendedCost: { Amount: a } } });
  assert.deepEqual(
    groupsToCents([
      g("Component$api", "1.5"),
      g("Component$", "0.25"),
      g("Amazon S3", "0"),
      g("Component$api", "1"),
    ]),
    { api: 250, [UNTAGGED]: 25 },
  );
});

/** 偽物の aws: 呼ばれた引数を数え、Cost Explorer の形で答える */
function fakeAws() {
  const calls = [];
  const res = (groups) =>
    ok({ ResultsByTime: [{ TimePeriod: { Start: "2026-10-01" }, Groups: groups }] });
  const g = (k, a) => ({ Keys: [k], Metrics: { UnblendedCost: { Amount: a } } });
  const aws = (args) => {
    calls.push(args.join(" "));
    const line = args.join(" ");
    if (line.includes("get-cost-forecast")) return ok({ Total: { Amount: "40" } });
    if (line.includes("DAILY"))
      return ok({
        ResultsByTime: [
          { TimePeriod: { Start: "2026-10-01" }, Total: { UnblendedCost: { Amount: "3" } } },
        ],
      });
    if (line.includes("Key=SERVICE")) return res([g("Amazon RDS", "60"), g("Amazon ECS", "40")]);
    if (line.includes("Key=Component"))
      return res([g("Component$db", "60"), g("Component$api", "40")]);
    if (line.includes("Key=Environment")) return res([g("Environment$prod", "100")]);
    if (line.includes("Key=Bet")) return res([g("Bet$core", "100")]);
    if (line.includes("Key=PullRequest")) return res([g("PullRequest$41", "5")]);
    return { ok: false, message: "?" };
  };
  return { aws, calls };
}

test("awsCost: 1アカウント6回まで・dev は日ごとの代わりに PR ごと・見込みは残りの分", async () => {
  const prod = fakeAws();
  const res = await awsCost({ today: "2026-10-25", aws: prod.aws }, "prod");
  assert.equal(prod.calls.length, 6);
  assert.equal(res.data.months[0].total_cents, 10000);
  assert.deepEqual(res.data.this_month.by_component, { db: 6000, api: 4000 });
  assert.equal(res.data.this_month.daily[0].cents, 300);
  assert.equal(res.data.forecast_rest_cents, 4000);
  assert.ok(prod.calls.every((c) => !c.includes("PullRequest")));
  const dev = fakeAws();
  const d = await awsCost({ today: "2026-10-25", aws: dev.aws }, "dev");
  assert.equal(dev.calls.length, 6);
  assert.deepEqual(d.data.this_month.by_pull_request, { 41: 500 });
  assert.match(dev.calls[0], /Start=2026-07-01,End=2026-10-26/);
  const no = await awsCost(
    { today: "2026-10-25", aws: () => ({ ok: false, message: "権限" }) },
    "stg",
  );
  assert.equal(no.ok, false);
});

test("githubActions: ワークフローごとの分数・公開なら枠の金額は無し", async () => {
  const run = (name, min) => ({
    name,
    run_started_at: "2026-10-02T00:00:00Z",
    updated_at: new Date(Date.parse("2026-10-02T00:00:00Z") + min * 60_000 - 1).toISOString(),
  });
  const ctx = fakeCtx({
    today: "2026-10-25",
    api: {
      "": ok({ private: false }),
      "actions/runs": ok({ workflow_runs: [run("CI", 10), run("CI", 5), run("VRT", 8)] }),
    },
  });
  const res = await githubActions(ctx);
  assert.deepEqual(res.data.workflows, [
    { name: "CI", runs: 2, minutes: 15 },
    { name: "VRT", runs: 1, minutes: 8 },
  ]);
  assert.equal(res.data.billing, null);
  const priv = fakeCtx({
    api: {
      "": ok({ private: true, owner: { type: "User" } }),
      "actions/runs": ok({ workflow_runs: [] }),
    },
    gh: {
      "users/o/settings/billing/actions": ok({ total_minutes_used: 2500, included_minutes: 2000 }),
    },
  });
  assert.equal((await githubActions(priv)).data.billing.paid_cents, 300);
});

test("anthropicCost: 鍵が無ければ呼ばない・セントの文字列を足す・ページをたどる・鍵は文に出さない", async () => {
  assert.match((await anthropicCost({ today: "2026-10-25", env: {} })).message, /U-4/);
  const urls = [];
  const pages = [
    {
      data: [
        {
          starting_at: "2026-10-01T00:00:00Z",
          results: [{ amount: "150.4", description: "Opus" }],
        },
      ],
      has_more: true,
      next_page: "p2",
    },
    {
      data: [
        { starting_at: "2026-10-02T00:00:00Z", results: [{ amount: "49.6", description: "Opus" }] },
      ],
      has_more: false,
    },
  ];
  const ctx = {
    today: "2026-10-25",
    env: { ANTHROPIC_ADMIN_KEY: "sk-ant-admin-secret" },
    fetch: async (url, init) => {
      urls.push(url);
      assert.equal(init.headers["x-api-key"], "sk-ant-admin-secret");
      return { ok: true, json: async () => pages[urls.length - 1] };
    },
  };
  const res = await anthropicCost(ctx);
  assert.equal(res.data.total_cents, 200);
  assert.deepEqual(res.data.by_description, { Opus: 200 });
  assert.match(urls[0], /group_by%5B%5D=description/);
  assert.match(urls[1], /page=p2/);
  const denied = await anthropicCost({ ...ctx, fetch: async () => ({ ok: false, status: 401 }) });
  assert.doesNotMatch(denied.message, /secret/);
});

const SAAS = `items:
  - { name: A, monthly_jpy: 1000, category: ai, since: 2026-01 }
  - { name: B, monthly_jpy: null, category: other, since: 2026-01 }
  - { name: C, monthly_jpy: 500, since: 2026-11 }
  - { name: D, monthly_jpy: 700, since: 2026-01, until: 2026-09 }
`;

test("saas: 今月にかかる物だけ・金額の無い物は名前だけ・見積もりは今の段階", async () => {
  const ctx = fakeCtx({ today: "2026-10-25", files: { "docs/cost/saas.yaml": SAAS } });
  const res = await saas(ctx);
  assert.deepEqual(
    res.data.items.map((i) => i.name),
    ["A"],
  );
  assert.deepEqual(res.data.without_amount, ["B"]);
  const real = await estimates(
    fakeCtx({
      files: { "docs/cost/estimates.yaml": readFileSync("docs/cost/estimates.yaml", "utf8") },
    }),
  );
  assert.equal(real.data.stage, "pre-pmf");
  assert.equal(real.data.lines.length, 4);
});

const entry = (data) => ({ ok: true, data });
const awsData = (account, cents) => ({
  account,
  months: [{ month: "2026-10", total_cents: cents, by_service: { RDS: cents } }],
  this_month: {
    by_component: { db: cents },
    by_environment: { [account]: cents },
    by_bet: { core: cents },
    daily: [],
  },
  forecast_rest_cents: cents,
});

test("まとめ: 区分ごとの実績と見積もり・動いている物ごと・読めなかった物を隠さない", () => {
  const s = makeSummary(
    {
      "aws-prod": entry(awsData("prod", 40000)), // $400 = 6万円
      "github-actions": entry({
        private: true,
        minutes_total: 10,
        workflows: [],
        billing: { paid_cents: 100 },
      }),
      anthropic: { ok: false, reason: "管理用の鍵が無い" },
      saas: entry({
        items: [{ name: "席", monthly_jpy: 30000, category: "ai", bet: "core" }],
        without_amount: ["Sentry"],
      }),
      estimates: entry({
        usd_jpy: 150,
        name: "① PMF の前",
        lines: [
          { id: "infra", name: "本番+stg", min: 40000, max: 40000 },
          { id: "ai", name: "AI", min: 30000, max: 60000 },
        ],
      }),
    },
    { today: "2026-10-25", generatedAt: "t" },
  );
  assert.equal(s.total_jpy, 60000 + 150 + 30000);
  assert.deepEqual(
    s.categories.map((c) => [c.id, c.jpy, c.status]),
    [
      ["infra", 60000, "over"],
      ["ai", 30000, "ok"],
    ],
  );
  assert.deepEqual(
    s.components.map((c) => c.name),
    ["db", "席", "GitHub Actions"],
  );
  assert.ok(s.notes.some((n) => n.includes("AWS(stg)")));
  assert.ok(s.notes.some((n) => n.includes("管理用の鍵が無い")));
  assert.deepEqual(s.saas_without_amount, ["Sentry"]);
  assert.equal(s.estimate.max, 100000);
  const html = renderHtml(s);
  assert.match(html, /⚠ 見積もりを超えた/);
  assert.match(html, /noindex/);
  assert.doesNotMatch(html, /<script|https?:\/\//, "外の読み込みもスクリプトも無い");
});

test("ページは名前をエスケープする", () => {
  const s = makeSummary(
    {
      saas: entry({
        items: [{ name: "<b>x</b>", monthly_jpy: 1, category: "other", bet: "core" }],
        without_amount: [],
      }),
    },
    { today: "2026-10-25", generatedAt: "t" },
  );
  const html = renderHtml(s);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});

test("CLI: --render は JSON から summary・index.html・目録を作り、ログに金額を出さない", () => {
  const dir = mkdtempSync(join(tmpdir(), "cost-"));
  writeFileSync(join(dir, "aws-prod.json"), JSON.stringify(entry(awsData("prod", 123456))));
  const log = execFileSync("node", [join("scripts", "cost", "run.mjs"), "--render", dir], {
    encoding: "utf8",
  });
  assert.doesNotMatch(log, /円|123456|185,184/);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.files.map((f) => f.file).sort(), [
    "aws-prod.json",
    "index.html",
    "summary.json",
  ]);
  assert.match(readFileSync(join(dir, "index.html"), "utf8"), /費用 20\d\d-\d\d/);
});
