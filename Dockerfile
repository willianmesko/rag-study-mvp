# Compatibility entrypoint for the existing Render service. Keep its stages
# aligned with apps/api/Dockerfile until render.yaml owns this selection.
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci

COPY scripts/build-api-runtime.mjs scripts/runtime-artifacts.mjs ./scripts/
COPY apps/api/tsconfig*.json ./apps/api/
COPY apps/api/src ./apps/api/src
COPY apps/api/db/migrations ./apps/api/db/migrations
COPY packages/contracts ./packages/contracts
RUN npm run build:api
RUN npm --workspace @rag-study/api run build:ocr-smoke

FROM node:24-alpine AS runtime-base
WORKDIR /app
ENV NODE_ENV=production PDF_OCR_ENABLED=true

RUN apk add --no-cache poppler-utils tesseract-ocr tesseract-ocr-data-eng tesseract-ocr-data-por
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/apps/api/db/migrations ./apps/api/db/migrations
USER node

# Verification uses the exact runtime implementation, dependencies and native tools.
# Only the test and synthetic PDF helper are added, then removed after two passes.
FROM runtime-base AS verified
COPY --chown=node:node --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --chown=node:node --from=build /app/apps/api/ocr-smoke-build/modules/ingestion/infrastructure/extraction/pdf-ocr.native.test.js ./apps/api/dist/modules/ingestion/infrastructure/extraction/pdf-ocr.native.test.js
COPY --chown=node:node --from=build /app/apps/api/ocr-smoke-build/modules/ingestion/infrastructure/extraction/pdf-test-fixture.js ./apps/api/dist/modules/ingestion/infrastructure/extraction/pdf-test-fixture.js
COPY scripts/run-native-ocr-smoke.mjs scripts/runtime-artifacts.mjs ./scripts/
COPY apps/api/tsconfig.runtime.json ./apps/api/tsconfig.runtime.json
RUN node scripts/run-native-ocr-smoke.mjs

# A fresh stage inherits no test-containing layers. This copy requires verification.
FROM runtime-base AS runtime
COPY --chown=root:root --from=verified /app/apps/api/dist ./apps/api/dist
COPY --chown=root:root --from=verified /app/packages/contracts/dist ./packages/contracts/dist
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
