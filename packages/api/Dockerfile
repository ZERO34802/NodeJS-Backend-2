# Builder stage
FROM node:20-alpine AS builder
WORKDIR /app/packages/api

# bring in root tsconfig so "extends": "../../tsconfig.json" resolves
COPY tsconfig.json /app/tsconfig.json

COPY packages/api/package*.json ./
RUN npm install --no-audit --no-fund

COPY packages/api ./
RUN npm run build

# Runtime stage
FROM node:20-alpine
WORKDIR /app/packages/api
COPY packages/api/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=builder /app/packages/api/dist ./dist
COPY --from=builder /app/packages/api/web ./web
ENV PORT=3001
EXPOSE 3001
CMD ["node", "dist/index.js"]
