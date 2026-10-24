// 組織ごとの機能フラグ(共通の仕組み。docs/specs/0012-feature-flags-and-usage.md)の入口。
// 機能の API は requireFeature(入っていなければ 404)、GET /api/me は findEnabledFeatures を使う。
export { type FlagChange, type FlagLine, setFeatureFlag, showFeatureFlags } from "./command.ts";
export { findEnabledFeatures, isFeatureEnabled, requireFeature } from "./repository.ts";
