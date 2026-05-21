# syntax=docker/dockerfile:1.7
# Build context is the repo root (orchestrator builds with `.` context).
FROM node:20-alpine AS builder
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/auth-library ./packages/auth-library
COPY examples/chained/receiving-service ./examples/chained/receiving-service
# Install only this service's workspace tree (+ its @s2s/auth-library dep) so we
# don't need every workspace declared in the root package.json present on disk.
RUN npm ci --workspace @s2s/auth-library --workspace @s2s/example-receiving-service --include-workspace-root
RUN npm --workspace @s2s/auth-library run build
RUN npm --workspace @s2s/example-receiving-service run build
RUN npm prune --omit=dev --workspace @s2s/auth-library --workspace @s2s/example-receiving-service --include-workspace-root

FROM node:20-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/examples ./examples
USER app
ENV NODE_ENV=production
ENV PORT=3000
# Lattice listener is plain HTTP on the container port; the app binds PORT and
# serves /health (see src/index.ts / src/routes/health.ts).
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
WORKDIR /app/examples/chained/receiving-service
CMD ["node", "dist/index.js"]
