FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY web ./web
RUN npm run build:api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
