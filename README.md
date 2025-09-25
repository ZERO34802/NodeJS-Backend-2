# Real‑time Crypto Prices & Alerts
Overview
Live prices for Bitcoin, Ethereum, and Solana fetched from CoinGecko and updated continuously.

Users can create alerts (greater than or less than) and receive real‑time alert events.

Redis caches the latest price and a short rolling window for quick reads.

# Architecture
API (Express + TypeScript): serves the static UI, exposes SSE stream at /stream, provides Alerts CRUD and /prices cache read.

Worker (TypeScript): polls CoinGecko, writes Redis cache, evaluates alerts from Postgres, publishes events to Redis channels.

Redis: cache storage and pub/sub bus for price and alert events.

Postgres: persistence for alerts.

Docker Compose: local orchestration of API, Worker, Redis, and Postgres.

# Prerequisites
Docker and Docker Compose installed.

A CoinGecko API key (free tier works).

Create a .env file at the repository root with the variables below.

Environment (.env at repo root)

# External API
```bash
COINGECKO_API_KEY=your_key_here
```

# Data & cache
```bash
REDIS_URL=redis://redis:6379
PG_URL=postgres://app:secret@db:5432/crypto
```

# Worker behavior
```bash
COIN_IDS=bitcoin,ethereum,solana
VS=usd
POLL_INTERVAL_MS=15000
```

# Quick Start
Start the stack
```bash
docker compose -f infra/docker-compose.yml up -d --build
```
Open the app

http://localhost:3001

# Create alerts

In “Create Alert,” choose Coin, VS (usd), Op (> or <), and Price, then click Add.

Matching alerts will appear in the lower “stream” table as they fire in real‑time.

# How It Works
Worker polling

Periodically requests prices from CoinGecko for the configured COIN_IDS and VS.

Caches each coin’s latest value at key pattern: price:<coin>:<vs> with { price, ts } and a TTL near the poll interval.

Publishes price ticks as JSON to Redis channel prices.global.

# Alert evaluation

Loads active alerts from Postgres and normalizes legacy fields (coin/op/price).

Compares the latest price to the alert rule; on match, publishes an alert payload to prices.global and alerts.global.

Optional cooldown respected via Redis key per alert id.

API and UI

API subscribes to prices.global and alerts.global and forwards all events to connected browsers via the /stream SSE endpoint.

The static UI listens to SSE and appends incoming price and alert rows.

# Endpoints
GET /stream
Server‑Sent Events stream with append‑only price and alert events.

GET /prices?ids=bitcoin,ethereum&vs=usd
Reads current cached prices from Redis and returns a compact object.

Alerts REST

GET /alerts

POST /alerts { coin, op, price }

PATCH /alerts/:id/toggle

DELETE /alerts/:id

# Docker Cheatsheet (for the demo)
```bash
Show running services

docker compose -f infra/docker-compose.yml ps
```
Worker logs (watch polling and alert emits)

docker logs -f infra-worker-1

Inspect cached price (example)

docker exec -it infra-redis-1 redis-cli HGETALL price:ethereum:usd

Inspect alerts in DB
```bash
docker exec -it infra-db-1 psql -U app -d crypto -c "SELECT id, coin, op, price, active FROM alerts ORDER BY id DESC LIMIT 10;"
```
Handling Rate Limits
If CoinGecko returns 429, the worker backs off using the Retry‑After header (when provided) or waits for 2× the poll interval before retrying.

Notes, Edge Cases, and Choices
Schema compatibility: worker supports alerts stored as either legacy (coin/op/price) or new (coin_id/type/value) fields by normalizing on load.

Numeric safety: price thresholds are coerced to numbers before comparison.

Resilience: publishing on both prices.global and alerts.global ensures the API receives alerts even if channel configuration changes.

Security: API keys are only read from .env; do not commit secrets.

# Project Structure (key parts)
packages/api/src/index.ts → API server, SSE, static UI, alerts routes, cache read.

packages/worker/src/index.ts → price poll, cache writes, alert evaluation, Redis publish.

infra/docker-compose.yml → api, worker, db (Postgres), redis services.

packages/api/web/ → simple frontend consuming SSE.

# Demo Links
Video: (https://drive.google.com/file/d/1PWTCa8LEphC0Yv1tWeZxMF9LbE8JWPUb/view?usp=sharing)

PDF: (https://drive.google.com/file/d/1DqiWhSccPCCnjJoVD51MLTTaalUIk5Dc/view?usp=sharing).

# Development
```bash
docker compose -f infra/docker-compose.yml build --no-cache worker

docker compose -f infra/docker-compose.yml up -d worker

Flush Redis during testing (clears cooldowns and cache)

docker exec -it infra-redis-1 redis-cli FLUSHALL
```
# Tech Stack
Node.js, TypeScript, Express

Redis (cache + pub/sub)

Postgres

Docker Compose
