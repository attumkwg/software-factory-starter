import pg from "pg";
import { v7 as uuidv7 } from "uuid";

/** 移行を済ませた DB の写し(global-setup が作る)。だれもつながないので、ここから別の DB を作れる */
export const TEMPLATE_DB = "app_template";

/**
 * そのテストのファイルだけが使う DB を作る(移行は済んでいる。表は空)。
 *
 * ふつうは全部のファイルが同じ DB を同時に使う(2社のデータを毎回新しく作るので困らない)。
 * ただ、全社分をまとめて扱う処理(アウトボックスの送り出し `relayOnce` など)を回すファイルは、
 * ほかのファイルの行まで取って印を付けてしまい、互いに落とし合う。そういうファイルだけこれを使う。
 */
export async function createIsolatedDatabase(
  adminUrl: string,
  label: string,
): Promise<{ ownerUrl: string; appUrl: string }> {
  const name = `app_${label}_${uuidv7().slice(-12)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB} OWNER app_owner`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  const base = `${url.host}/${name}`;
  return {
    ownerUrl: `postgres://app_owner:app_owner@${base}`,
    appUrl: `postgres://app:app@${base}`,
  };
}
