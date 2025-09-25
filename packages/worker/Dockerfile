# Builder stage
FROM node:20-alpine AS builder
WORKDIR /app/packages/worker

# bring in root tsconfig so "extends": "../../tsconfig.json" resolves
COPY tsconfig.json /app/tsconfig.json

COPY packages/worker/package*.json ./
RUN npm install --no-audit --no-fund

COPY packages/worker ./
RUN npm run build

# Runtime stage
FROM node:20-alpine
WORKDIR /app/packages/worker
COPY packages/worker/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=builder /app/packages/worker/dist ./dist
CMD ["node", "dist/index.js"]
