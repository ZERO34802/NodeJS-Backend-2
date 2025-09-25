# Crypto Alerts (API + Worker)

Monorepo with:
- API (SSE stream, cache reads, alerts CRUD)
- Worker (CoinGecko poller, Redis cache, alert evaluation)
- Infra (Redis + Postgres via docker compose)

## Prereqs
- Node 20+
- Docker Desktop running

## Start infra
docker compose -f infra/docker-compose.yml up -d

## Start API
npm --workspace packages/api run dev
# API on :3001
# Health: http://localhost:3001/health
# SSE stream: http://localhost:3001/stream
# Cache read: http://localhost:3001/prices?ids=bitcoin,ethereum,solana&vs=usd

## Start Worker
npm --workspace packages/worker run dev
# Poll interval default: 15000 ms (override POLL_INTERVAL_MS)

## Alerts
Create:
POST http://localhost:3001/alerts
{
  "user_id": "demo",
  "coin_id": "solana",
  "vs_currency": "usd",
  "type": "below",
  "value": 100000,
  "window_minutes": 5,
  "cooldown_sec": 60,
  "active": true
}

List:
GET http://localhost:3001/alerts

Alert events appear in /stream alongside price events, each as a new SSE `data:` line.
