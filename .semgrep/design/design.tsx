// .semgrep/design/design.yml のテスト。「ruleid」の注釈 = 止まるべき行 /「ok」の注釈 = 止まってはいけない行

// ruleid: no-raw-color-in-web
const red = "#ff0000";

// ruleid: no-raw-color-in-web
const shadow = "0 1px 2px rgba(0, 0, 0, 0.2)";

// ok: no-raw-color-in-web
const issue = "Issue #12 を直す";

export function Bad() {
  return (
    // ruleid: no-inline-style-in-web
    <div style={{ padding: 8, color: red, boxShadow: shadow }}>{issue}</div>
  );
}

// ruleid: no-css-file-in-web
import "./page.css";

// ok: no-css-file-in-web
import "@app/ui/styles.css";
