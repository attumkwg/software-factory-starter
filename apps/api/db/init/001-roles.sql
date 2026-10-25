-- 手元(docker compose)と結合テストだけで使う、ログインできるユーザーの作成。
-- 本番・stg では使わない: パスワードは Secrets Manager に置き、docs/runbooks の手順で作る。
--
--   app_owner … 移行を流すユーザー。表の持ち主。
--   app       … アプリの接続ユーザー。持ち主ではない・superuser ではない・RLS をすり抜けない。
--   app_sensitive_login … 要配慮個人情報(スキーマ sensitive)だけの接続ユーザー(ADR 0029)。app_rw には入れない。
CREATE ROLE app_owner LOGIN PASSWORD 'app_owner' CREATEROLE;
CREATE ROLE app_rw NOLOGIN;
CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB IN ROLE app_rw;
CREATE ROLE app_sensitive NOLOGIN;
CREATE ROLE app_sensitive_login LOGIN PASSWORD 'app_sensitive_login' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB IN ROLE app_sensitive;

ALTER SCHEMA public OWNER TO app_owner;
DO $$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO app_owner', current_database());
END
$$;
