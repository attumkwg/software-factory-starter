-- 長いロック待ちで本番を止めない(squawk: require-lock-timeout / require-statement-timeout)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- 「無くなったら困るか」を聞く(docs/specs/0046-pmf-survey.md・docs/designs/0046-pmf-survey.md の 2・ADR 0057)。
-- 危険度「高」(RLS と権限)。段: ① 拡張(新しい表を足すだけ。前の版のアプリは読まないので、そのまま動く)。縮小は無い。
-- 0015(契約のプラン)の上に作り直した(drizzle-kit generate を流し直し)。
--
-- 1. 表は drizzle-kit が作った形(src/pmf-survey/schema.ts)。だれが何と答えたかを結びつけないよう、2つに分ける:
--    pmf_survey_asked(この人はこの回を答え終えた。答えは持たない)と pmf_survey_counts(組織・回・答えごとの数。人を持たない)。
--    新しい表なので、制約(索引)はこの移行の中でよい(空)。
-- 2. アプリ(app_rw)は asked を読む・足すだけ、counts を読む・足す・数を増やすだけ。消すのは運営のコマンド
--    pmf-survey-purge(保存期間)と解約のコマンド(表の持ち主)。
-- 戻し方: DROP TABLE platform.pmf_survey_counts; DROP TABLE platform.pmf_survey_asked;
--         (前の版のアプリはこれらを読まないので、戻さなくても動く。DROP TABLE は答えの数を消す)
CREATE TABLE "platform"."pmf_survey_asked" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"round" text NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "pmf_survey_asked_once_key" UNIQUE("tenant_id","user_id","round")
);
--> statement-breakpoint
CREATE TABLE "platform"."pmf_survey_counts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"round" text NOT NULL,
	"answer" text NOT NULL,
	"count" bigint NOT NULL,
	CONSTRAINT "pmf_survey_counts_answer_key" UNIQUE("tenant_id","round","answer")
);
--> statement-breakpoint
ALTER TABLE "platform"."pmf_survey_asked" ADD CONSTRAINT "pmf_survey_asked_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."pmf_survey_asked" ADD CONSTRAINT "pmf_survey_asked_user_fkey" FOREIGN KEY ("tenant_id","user_id") REFERENCES "organizations"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."pmf_survey_counts" ADD CONSTRAINT "pmf_survey_counts_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organizations"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
GRANT SELECT, INSERT ON platform.pmf_survey_asked TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (count) ON platform.pmf_survey_counts TO app_rw;
--> statement-breakpoint
ALTER TABLE platform.pmf_survey_asked ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform.pmf_survey_asked FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON platform.pmf_survey_asked
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE platform.pmf_survey_counts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform.pmf_survey_counts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON platform.pmf_survey_counts
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
