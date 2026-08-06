FROM postgres:16-alpine

COPY --chmod=0755 apps/crm-backend/deploy/postgres-init/10-runtime-roles.sh /docker-entrypoint-initdb.d/10-runtime-roles.sh
