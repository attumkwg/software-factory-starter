import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Playwright の版は4か所にある(docs/designs/0011-visual-regression.md の 5.1。4か所目は devcontainer の OS の部品)。
// テストの本体(@playwright/test)と、Docker の中のブラウザ(イメージ・起動のコマンド)の版が違うと、つながらない・画像が変わる
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Playwright の版がそろっている", () => {
  it("@playwright/test・ブラウザのイメージのタグ・run-server の版が同じ", () => {
    const pkg = JSON.parse(read("../../package.json")) as {
      devDependencies: Record<string, string>;
    };
    const version = pkg.devDependencies["@playwright/test"];
    const compose = read("../../../../docker-compose.vrt.yml");
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(compose).toContain(`mcr.microsoft.com/playwright:v${version}-noble@sha256:`);
    expect(compose).toContain(`"playwright@${version}", "run-server"`);
    // devcontainer は、絞った後に外へ出られないので、ブラウザと OS の部品を作るときに入れる(docs/designs/0057-ai-egress.md)
    expect(read("../../../../.devcontainer/Dockerfile")).toContain(
      `playwright@${version} install --with-deps chromium`,
    );
  });
});
