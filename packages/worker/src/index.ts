import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Axios from 'axios';
import RedisPkg from 'ioredis';
import pgPkg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from repo root deterministically
const repoRoot = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });
console.log('env loaded from:', path.join(repoRoot, '.env'), 'key?', Boolean(process.env.COINGECKO_API_KEY));

// Load again from root as fallback
const rootEnv = path.resolve(__dirname, '../../..', '.env');
dotenv.config({ path: rootEnv });
console.log('loaded .env from:', rootEnv, 'has key?', Boolean(process.env.COINGECKO_API_KEY));

const Redis = (RedisPkg as any).default || (RedisPkg as any);
const { Pool } = pgPkg as any;

// Env
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const COIN_IDS = (process.env.COIN_IDS || 'bitcoin,ethereum,solana').split(',');
const VS = process.env.VS || 'usd';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '15000', 10);

// Clients
const redis = new Redis(REDIS_URL);
const pg = new Pool({ connectionString: process.env.PG_URL || 'postgres://app:secret@localhost:5432/crypto' });
console.log('WORKER_PG', process.env.PG_URL || 'postgres://app:secret@localhost:5432/crypto');

// HTTP
const http = Axios.create({
  timeout: 8000,
  headers: {
    'User-Agent': 'crypto-worker/1.0 (+local-dev)',
    'x-cg-pro-api-key': process.env.COINGECKO_API_KEY || ''
  }
});

// Types
type Prices = Record<string, Record<string, number>>;
type DBAlert = {
  id: number;
  coin: string | null;
  op: '>' | '<' | null;
  price: number | null;
  active: boolean;
  coin_id?: string | null;
  type?: string | null;
  value?: number | null;
  vs_currency?: string | null;
  cooldown_sec?: number | null;
};

// Fetch prices
async function fetchPrices(ids: string[], vs: string): Promise<Prices> {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=${vs}`;
  console.log('fetching from CoinGecko:', `ids=${ids.join(',')}&vs=${vs}`, 'key?', Boolean(process.env.COINGECKO_API_KEY));
  const { data } = await http.get(url);
  return data as Prices;
}

// Cache and publish price ticks
async function cacheAndPublish(prices: Prices, vs: string) {
  const pipe = redis.pipeline();
  const ts = Date.now();
  const jitter = Math.floor(Math.random() * 1000);
  const ttlSec = Math.ceil((POLL_INTERVAL_MS + jitter) / 1000);

  for (const [id, obj] of Object.entries(prices)) {
    const price = obj[vs];
    if (typeof price !== 'number') continue;

    const key = `price:${id}:${vs}`;
    pipe.hset(key, { price: String(price), ts: String(ts) });
    pipe.expire(key, ttlSec);

    const listKey = `window:${id}:${vs}`;
    pipe.lpush(listKey, JSON.stringify({ price, ts }));
    pipe.ltrim(listKey, 0, 120);

    pipe.publish('prices.global', JSON.stringify({ type: 'price', id, vs, price, ts }));
  }

  await pipe.exec();
}

// Load and normalize alerts
async function loadActiveAlerts(): Promise<DBAlert[]> {
  const { rows } = await pg.query('select * from alerts where active = true');
  const alerts = rows as DBAlert[];
  for (const a of alerts) {
    if (!a.coin && a.coin_id) a.coin = a.coin_id;
    if (!a.op && a.type) {
      a.op = a.type === 'above' || a.type === '>' ? '>' :
            a.type === 'below' || a.type === '<' ? '<' : null;
    }
    if ((a.price === null || a.price === undefined) && (a.value !== null && a.value !== undefined)) {
      a.price = a.value as number;
    }
  }
  return alerts;
}

function shouldTrigger(op: '>' | '<', threshold: number, price: number): boolean {
  if (op === '>') return price > threshold;
  if (op === '<') return price < threshold;
  return false;
}

// Evaluate and publish alerts
async function evaluateAlerts(prices: Prices, vs: string) {
  const alerts = await loadActiveAlerts();
  console.log('ALERTS_LOADED', alerts.map(a => ({ id: a.id, coin: a.coin, op: a.op, price: a.price, active: (a as any).active })));
  const now = Date.now();
  const pipe = redis.pipeline();

  for (const a of alerts) {
    const coin = a.coin as string;
    const op = a.op as '>' | '<';
    const threshold = Number(a.price);
    const p = prices[coin]?.[vs];

    console.log('EVAL', a.id, coin, 'price=', p, 'op=', op, 'th=', threshold);
    if (typeof p !== 'number' || !op || Number.isNaN(threshold)) continue;

    const cd = (a.cooldown_sec ?? 0) | 0;
    const payload = {
      type: 'alert',
      id: a.id,
      coin_id: coin,
      vs_currency: vs,
      rule: op,
      value: threshold,
      price: p,
      ts: now
    };

    if (cd > 0) {
      const cdKey = `alert:cooldown:${a.id}`;
      const exists = await redis.exists(cdKey);
      if (exists) continue;
      if (shouldTrigger(op, threshold, p)) {
        console.log('ALERT', a.id, coin, op, threshold, 'price=', p);
        pipe.publish('prices.global', JSON.stringify(payload));
        pipe.publish('alerts.global', JSON.stringify(payload));
        pipe.setex(cdKey, cd, '1');
      }
    } else {
      if (shouldTrigger(op, threshold, p)) {
        console.log('ALERT', a.id, coin, op, threshold, 'price=', p);
        pipe.publish('prices.global', JSON.stringify(payload));
        pipe.publish('alerts.global', JSON.stringify(payload));
      }
    }
  }

  await pipe.exec();
}

// Main loop
async function tick() {
  try {
    const data = await fetchPrices(COIN_IDS, VS);
    await evaluateAlerts(data, VS);
    await cacheAndPublish(data, VS);
  } catch (e: any) {
    const status = e?.response?.status;
    if (status === 429) await new Promise(r => setTimeout(r, POLL_INTERVAL_MS * 2));
  }
}

async function main() {
  console.log('Worker polling', COIN_IDS.join(','), 'vs', VS, 'every', POLL_INTERVAL_MS, 'ms');
  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

main().catch(err => { console.error(err); process.exit(1); });
process.on('SIGINT', async () => { await redis.quit(); await pg.end().catch(()=>{}); process.exit(0); });
