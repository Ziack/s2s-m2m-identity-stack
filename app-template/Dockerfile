# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-alpine AS builder
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
RUN apk add --no-cache wget && \
    addgroup -g 1000 -S app && \
    adduser -u 1000 -S app -G app

WORKDIR /app
COPY --from=deps   --chown=app:app /build/node_modules ./node_modules
COPY --from=builder --chown=app:app /build/dist        ./dist
COPY --chown=app:app package.json ./

USER 1000:1000
ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O- "http://localhost:${PORT:-3000}/health" || exit 1

CMD ["node", "dist/index.js"]
