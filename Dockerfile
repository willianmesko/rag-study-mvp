# Compatibility entrypoint for the existing Render service. The maintained
# Dockerfile lives at apps/api/Dockerfile; keep this in sync until the service
# is managed through render.yaml.
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci

COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/src ./apps/api/src
COPY packages/contracts ./packages/contracts
RUN npm run build:api

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
