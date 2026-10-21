import { LEGAL_VERSIONS, type LegalVersion, type LegalVersionRef, type Me } from "@app/shared";

// 同意の画面に並べる版(docs/specs/0008-legal-consent.md):
//   いま同意が要る版(pending)と、前もって同意できる「同意し直しの」予告中の版(まだ同意していない物)。

export type AcceptItem = LegalVersion & { required: boolean };
type Ref = LegalVersionRef & { required: boolean };

export function acceptItems(
  me: Me,
  versions: readonly LegalVersion[] = LEGAL_VERSIONS,
): AcceptItem[] {
  const legal = me.legal;
  if (!legal) return [];
  const refs: Ref[] = [
    ...legal.pending.map((p) => ({ ...p, required: true })),
    ...legal.upcoming
      .filter((u) => u.reconsent && !u.accepted)
      .map((u) => ({ document: u.document, version: u.version, required: false })),
  ];
  // 同じ文書は、いちばん後の版だけ(後の版への同意は前の版を含む)。いま要るかは引き継ぐ
  const latest = new Map<string, Ref>();
  for (const ref of refs) {
    const seen = latest.get(ref.document);
    const required = ref.required || (seen?.required ?? false);
    if (!seen || seen.version < ref.version) latest.set(ref.document, { ...ref, required });
  }
  return [...latest.values()].flatMap((ref): AcceptItem[] => {
    const v = versions.find((x) => x.document === ref.document && x.version === ref.version);
    return v ? [{ ...v, required: ref.required }] : [];
  });
}

/** 管理者が利用規約に同意するときは「組織を代表して」(API がロールで決める。設計書 U-3) */
export const agreesForOrganization = (me: Me, items: AcceptItem[]) =>
  me.role === "admin" && items.some((i) => i.document === "terms");
