-- Database roles and databases for the Freight Recovery web stack.
-- Runs once as the Postgres superuser (compose: mounted into /docker-entrypoint-initdb.d;
-- CI: psql -f; AWS: applied out-of-band by an operator, see infra/README.md).
--
--   freight_owner : owns the schema and runs migrations. BYPASSRLS so migrations, the seed script and
--                   test fixtures can inspect every tenant. Never used by the running API.
--   freight_app   : the API's runtime role. NOT owner, NOT superuser, NO BYPASSRLS: row-level
--                   security is enforced for every query it makes.
--
-- The passwords below are PUBLIC local-dev values ("local-dev-only"). Never reuse them anywhere real;
-- in AWS the roles get random passwords from Secrets Manager.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'freight_owner') THEN
    CREATE ROLE freight_owner LOGIN PASSWORD 'local-dev-only' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'freight_app') THEN
    CREATE ROLE freight_app LOGIN PASSWORD 'local-dev-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;

SELECT 'CREATE DATABASE freight_web OWNER freight_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'freight_web')\gexec
SELECT 'CREATE DATABASE freight_web_test OWNER freight_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'freight_web_test')\gexec

ALTER DATABASE freight_web OWNER TO freight_owner;
ALTER DATABASE freight_web_test OWNER TO freight_owner;
REVOKE ALL ON DATABASE freight_web FROM PUBLIC;
REVOKE ALL ON DATABASE freight_web_test FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE freight_web TO freight_app;
GRANT CONNECT, TEMPORARY ON DATABASE freight_web_test TO freight_app;

\connect freight_web
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO freight_owner;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\connect freight_web_test
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO freight_owner;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- seed --reset (dev/test only) disables append-only triggers inside its own session.
GRANT SET ON PARAMETER session_replication_role TO freight_owner;
