import { z } from "zod";

// 公開の LP の事前登録と、来た所ごとの数(docs/specs/0025-public-landing-page.md・ADR 0038)。
// 公開のページ(apps/site)と API が同じ物を見る。項目は足すだけ・消さない。

/**
 * 事前登録の同意の文。**中身(何に使うか・いつ消すか・どこで消せるか)を変えたら、版を1つ上げて足す**
 * (前の版は消さない。登録の記録が「どの版に同意したか」を指す)。型は docs/guides/landing-page.md。
 * 受け付けるのは最後の版だけ(古いページから送られたら 400。読み込み直してもらう)。
 * `{サービス名}` は公開のページが名前に置き換える。
 */
export const PRE_REGISTRATION_CONSENTS = [
  {
    version: 1,
    text: "ご入力いただいた会社名とメールアドレスは、{サービス名}の提供開始のご案内と、試しの利用のご招待にだけ使います。登録から1年で消します(ご案内のメールから、いつでも消せます)。",
    checkbox: "上の使い方に同意して登録する",
  },
] as const;

export type PreRegistrationConsent = (typeof PRE_REGISTRATION_CONSENTS)[number];

/** いま出す同意の文(最後の版) */
export function currentPreRegistrationConsent(): PreRegistrationConsent {
  const last = PRE_REGISTRATION_CONSENTS.at(-1);
  if (!last) throw new Error("事前登録の同意の文がありません");
  return last;
}

/** 事前登録と日ごとの数を残す日数(設計書 0025 の U-3。@attumkwg 2026-10-25 に承認) */
export const PRE_REGISTRATION_RETENTION_DAYS = {
  /** 確認のリンクを開いていない登録(登録の日から) */
  pending: 7,
  /** 確認した登録(登録の日から) */
  confirmed: 365,
  /** 組織にした登録(組織にした日から。組織に引き継いだ) */
  converted: 30,
  /** 日ごとの数(個人に結びつかない) */
  dailyCounts: 3 * 365,
} as const;

/** 会社の規模の幅(集計だけに使う) */
export const COMPANY_SIZES = ["1-9", "10-49", "50-299", "300+"] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

const UTM_CHARS = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * UTM の値を整える。英数と `-_.` だけ・100文字まで。外れた値は空(自由な文やメールアドレスを残さない)。
 * 大文字・小文字は寄せない(配った人が決めた値のまま数える)。
 */
export function normalizeUtm(value: string | null | undefined): string {
  return value && UTM_CHARS.test(value) ? value : "";
}

/** ページの path を整える。クエリ・# を落とし、`/` で始まる 200 文字までだけ。外れたら `/` */
export function normalizeLandingPath(value: string | null | undefined): string {
  const path = (value ?? "").split(/[?#]/)[0] ?? "";
  return /^\/[A-Za-z0-9._~/-]{0,199}$/.test(path) ? path : "/";
}

// 公開の入口に来る値は、整える前の生の値を長さだけで受ける(整えるのは API の中。外れた値で 400 にしない)
const Utm = z.string().max(200).optional();
const Path = z.string().max(400).optional();

/** POST /api/public/pre-registrations の本文 */
export const PreRegistrationRequestSchema = z.object({
  email: z.email().max(254),
  organizationName: z.string().trim().min(1).max(100),
  companySize: z.enum(COMPANY_SIZES).optional(),
  /** 同意のチェック。true でなければ 400 */
  consent: z.literal(true),
  /** 画面に出していた同意の文の版(PRE_REGISTRATION_CONSENTS) */
  consentTextVersion: z.number().int().positive(),
  utmSource: Utm,
  utmMedium: Utm,
  utmCampaign: Utm,
  landingPath: Path,
  /** 罠の欄(人には見えない)。値があれば何もせずに成功と同じ答えを返す */
  website: z.string().max(200).optional(),
});
export type PreRegistrationRequest = z.infer<typeof PreRegistrationRequestSchema>;

/** POST /api/public/lp-views の本文(Cookie も端末の ID も送らない) */
export const LpViewRequestSchema = z.object({
  path: Path,
  utmSource: Utm,
  utmMedium: Utm,
  utmCampaign: Utm,
});
export type LpViewRequest = z.infer<typeof LpViewRequestSchema>;

/** 確認・取り消しのリンクの token(メールのリンクの # の後ろ。公開のページが本文で送る) */
export const PreRegistrationLinkSchema = z.object({ token: z.string().min(1).max(300) });
export type PreRegistrationLink = z.infer<typeof PreRegistrationLinkSchema>;
