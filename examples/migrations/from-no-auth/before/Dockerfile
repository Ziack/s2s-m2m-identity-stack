# Production security relies on the VPC security group + ALB IP allowlist. The app itself does no auth.
FROM node:18
WORKDIR /app
COPY . .
RUN npm ci && npm run build
CMD ["node", "dist/index.js"]
