FROM node:22-alpine AS crm-frontend-build

ENV CI=true
WORKDIR /workspace/apps/crm-frontend

COPY apps/crm-frontend/package.json apps/crm-frontend/package-lock.json ./
RUN npm ci

COPY apps/crm-frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine

ARG RELEASE_SHA=development
LABEL org.opencontainers.image.revision=$RELEASE_SHA

EXPOSE 80

COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY styles /usr/share/nginx/html/styles
COPY scripts /usr/share/nginx/html/scripts
COPY assets /usr/share/nginx/html/assets
COPY --from=crm-frontend-build /workspace/apps/crm-frontend/dist/client /usr/share/nginx/html/cabinet

RUN find /usr/share/nginx/html -type d -exec chmod 755 {} + \
    && find /usr/share/nginx/html -type f -exec chmod 644 {} +
