FROM node:22-alpine AS crm-frontend-build

ENV CI=true
WORKDIR /workspace/apps/crm-frontend

COPY apps/crm-frontend/package.json apps/crm-frontend/package-lock.json ./
RUN npm ci

COPY apps/crm-frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine

ARG RELEASE_SHA=development
ARG CRM_API_UPSTREAM=crm-api:8080
ARG CRM_TRUSTED_EDGE_HEADERS=false
LABEL org.opencontainers.image.revision=$RELEASE_SHA

EXPOSE 80

COPY docker/nginx/default.conf /tmp/default.conf.template
COPY index.html /usr/share/nginx/html/index.html
COPY styles /usr/share/nginx/html/styles
COPY scripts /usr/share/nginx/html/scripts
COPY assets /usr/share/nginx/html/assets
COPY --from=crm-frontend-build /workspace/apps/crm-frontend/dist/client /usr/share/nginx/html/cabinet

RUN printf '%s' "$CRM_API_UPSTREAM" | grep -Eq '^[A-Za-z0-9.-]+:[0-9]{1,5}$' \
    && case "$CRM_TRUSTED_EDGE_HEADERS" in \
         false) forwarded_proto='$scheme'; forwarded_client_ip='$remote_addr' ;; \
         true) forwarded_proto='$http_x_forwarded_proto'; forwarded_client_ip='$http_x_real_ip' ;; \
         *) exit 1 ;; \
       esac \
    && sed \
         -e "s|__CRM_API_UPSTREAM__|$CRM_API_UPSTREAM|g" \
         -e "s|__CRM_FORWARDED_PROTO__|$forwarded_proto|g" \
         -e "s|__CRM_FORWARDED_CLIENT_IP__|$forwarded_client_ip|g" \
         /tmp/default.conf.template > /etc/nginx/conf.d/default.conf \
    && ! grep -Eq '__CRM_[A-Z0-9_]+__' /etc/nginx/conf.d/default.conf \
    && rm /tmp/default.conf.template \
    && nginx -t \
    && find /usr/share/nginx/html -type d -exec chmod 755 {} + \
    && find /usr/share/nginx/html -type f -exec chmod 644 {} +
