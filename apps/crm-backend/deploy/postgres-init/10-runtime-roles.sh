#!/bin/sh
set -eu

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${CRM_MIGRATOR_PASSWORD:?CRM_MIGRATOR_PASSWORD is required}"
: "${CRM_API_PASSWORD:?CRM_API_PASSWORD is required}"
: "${CRM_WORKER_PASSWORD:?CRM_WORKER_PASSWORD is required}"
: "${CRM_CREDENTIAL_WORKER_PASSWORD:?CRM_CREDENTIAL_WORKER_PASSWORD is required}"

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv database_name POSTGRES_DB
\getenv migrator_password CRM_MIGRATOR_PASSWORD
\getenv api_password CRM_API_PASSWORD
\getenv worker_password CRM_WORKER_PASSWORD
\getenv credential_worker_password CRM_CREDENTIAL_WORKER_PASSWORD

SELECT 'CREATE ROLE kurs_crm_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_migrator') \gexec
SELECT 'CREATE ROLE kurs_crm_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_api') \gexec
SELECT 'CREATE ROLE kurs_crm_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_worker') \gexec
SELECT 'CREATE ROLE kurs_crm_credential_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_credential_worker') \gexec

ALTER ROLE kurs_crm_migrator PASSWORD :'migrator_password';
ALTER ROLE kurs_crm_api PASSWORD :'api_password';
ALTER ROLE kurs_crm_worker PASSWORD :'worker_password';
ALTER ROLE kurs_crm_credential_worker PASSWORD :'credential_worker_password';

REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE :"database_name" TO kurs_crm_migrator;
GRANT CONNECT ON DATABASE :"database_name" TO kurs_crm_api, kurs_crm_worker;
GRANT CONNECT ON DATABASE :"database_name" TO kurs_crm_credential_worker;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

ALTER ROLE kurs_crm_api IN DATABASE :"database_name" SET statement_timeout = '30s';
ALTER ROLE kurs_crm_api IN DATABASE :"database_name" SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE kurs_crm_worker IN DATABASE :"database_name" SET statement_timeout = '5min';
ALTER ROLE kurs_crm_worker IN DATABASE :"database_name" SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE kurs_crm_credential_worker IN DATABASE :"database_name" SET statement_timeout = '30s';
ALTER ROLE kurs_crm_credential_worker IN DATABASE :"database_name" SET idle_in_transaction_session_timeout = '15s';
SQL
