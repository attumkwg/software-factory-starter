import { ERROR_CODES } from "@app/shared";
import { describe, expect, it } from "vitest";
import { ERROR_MESSAGES, OTHER_MESSAGES } from "./messages.ts";

// messages.ts の決まり(文言は自由に変えてよいが、これは守る)。

const all = [...Object.values(ERROR_MESSAGES), ...Object.values(OTHER_MESSAGES)];

describe("利用者に出す文の決まり", () => {
  it("API のすべての code に文がある", () => {
    for (const code of ERROR_CODES) expect(ERROR_MESSAGES[code]).toBeTruthy();
  });

  it("1. 固定の文だけ(値を埋め込む穴が無い)", () => {
    for (const m of all) expect(m).not.toMatch(/\$\{|\{\w*\}|%s/);
  });

  it("2. ログインの失敗で、どこが違ったか・登録されているかを言わない", () => {
    const m = ERROR_MESSAGES.login_failed;
    // 片方の欄だけを名指ししない(両方をまとめるのはよい)
    if (/メールアドレス|パスワード/.test(m)) {
      expect(m).toMatch(/メールアドレス/);
      expect(m).toMatch(/パスワード/);
    }
    expect(m).not.toMatch(/登録|存在|いません|見つかりません|使われて/);
  });

  it("3. 「無い」の文で、権限や他社の物に触れない(「無い」と「見られない」を区別させない)", () => {
    expect(ERROR_MESSAGES.not_found).not.toMatch(/権限|他社|ほかの会社|アクセス/);
  });

  it("4. 中の仕組みを書かない", () => {
    for (const m of all) {
      expect(m).not.toMatch(/DB|SQL|データベース|サーバー|スタック|例外|Error|API|null|undefined/i);
    }
  });
});
