# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS builder
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/auth-library ./packages/auth-library
COPY packages/token-broker ./packages/token-broker
RUN npm ci --workspaces --include-workspace-root
RUN npm --workspace @s2s/auth-library run build
RUN npm --workspace @s2s/token-broker run build
RUN npm prune --omit=dev --workspaces

FROM node:20-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages ./packages
USER app
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
WORKDIR /app/packages/token-broker
CMD ["node", "dist/index.js"]
