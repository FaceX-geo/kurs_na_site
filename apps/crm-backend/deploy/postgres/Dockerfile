FROM postgres:16-alpine

ARG RELEASE_SHA=development
LABEL org.opencontainers.image.revision=$RELEASE_SHA

COPY --chmod=0755 apps/crm-backend/deploy/postgres-init/10-runtime-roles.sh /docker-entrypoint-initdb.d/10-runtime-roles.sh
