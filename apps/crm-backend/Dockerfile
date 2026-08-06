FROM node:22-alpine AS build

ENV CI=true
RUN corepack enable
WORKDIR /workspace/apps/crm-backend

COPY apps/crm-backend/package.json apps/crm-backend/pnpm-lock.yaml apps/crm-backend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY apps/crm-backend/ ./
RUN pnpm build

FROM build AS production-dependencies

RUN pnpm prune --prod

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN mkdir -p /data/quarantine && chown node:node /data/quarantine

COPY --from=production-dependencies --chown=node:node /workspace/apps/crm-backend/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /workspace/apps/crm-backend/package.json ./package.json
COPY --from=build --chown=node:node /workspace/apps/crm-backend/dist ./dist
COPY --from=build --chown=node:node /workspace/apps/crm-backend/db ./db
COPY --chown=node:node assets/data ./public-data

USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
