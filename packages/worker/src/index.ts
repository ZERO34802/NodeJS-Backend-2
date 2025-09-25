// Load env from repo root deterministically (works under ts-node/ESM)
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// repoRoot = packages/worker/../../..
const repoRoot = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });
console.log('env loaded from:', path.join(repoRoot, '.env'), 'key?', Boolean(process.env.COINGECKO_API_KEY));


import Axios from 'axios';
import RedisPkg from 'ioredis';
import pgPkg from 'pg';


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
type Alert = {
  id: number;
  user_id: string | null;
  coin_id: string;
  vs_currency: string;
  type: 'above' | 'below' | 'percent_change';
  value: number;
  window_minutes: number;
  cooldown_sec: number;
  active: boolean;
  last_triggered_at: string | null;
};

// Fetch prices from CoinGecko with rate-limit backoff
async function fetchPrices(ids: string[], vs: string): Promise<Prices> {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=${vs}`;
  try {
    console.log('fetching from CoinGecko:', `ids=${ids.join(',')}&vs=${vs}`, 'key?', Boolean(process.env.COINGECKO_API_KEY));
    const { data } = await http.get(url);
    return data as Prices;
  } catch (e: any) {
    const status = e?.response?.status;
    if (status === 429) {
      const retryAfter = Number(e?.response?.headers?.['retry-after'] || 0);
      const waitMs = Math.max(retryAfter * 1000, POLL_INTERVAL_MS * 2);
      console.warn('rate-limited, backing off ms =', waitMs);
      await new Promise(r => setTimeout(r, waitMs));
    } else {
      console.error('fetch error', status || e.message);
    }
    throw e;
  }
}

// Cache to Redis and publish price events
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

// Alerts
async function loadActiveAlerts(): Promise<Alert[]> {
  const { rows } = await pg.query('select * from alerts where active = true');
  return rows as Alert[];
}

function shouldTrigger(a: Alert, price: number): boolean {
  if (a.type === 'above') return price > a.value;
  if (a.type === 'below') return price < a.value;
  // percent_change can be added later
  return false;
}

async function evaluateAlerts(prices: Prices, vs: string) {
  const alerts = await loadActiveAlerts();
  const now = Date.now();
  const pipe = redis.pipeline();

  for (const a of alerts) {
    const p = prices[a.coin_id]?.[vs];
    if (typeof p !== 'number') continue;

    const last = a.last_triggered_at ? new Date(a.last_triggered_at).getTime() : 0;
    if (last && now - last < a.cooldown_sec * 1000) continue;

    if (shouldTrigger(a, p)) {
      pipe.publish('prices.global', JSON.stringify({
        type: 'alert',
        id: a.id,
        coin_id: a.coin_id,
        vs_currency: a.vs_currency,
        rule: a.type,
        value: a.value,
        price: p,
        ts: now
      }));
      await pg.query('update alerts set last_triggered_at = now() where id = $1', [a.id]);
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
    if (status === 429) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS * 2));
    }
  }
}

async function main() {
  console.log('Worker polling', COIN_IDS.join(','), 'vs', VS, 'every', POLL_INTERVAL_MS, 'ms');
  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

main().catch(err => { console.error(err); process.exit(1); });
process.on('SIGINT', async () => { await redis.quit(); await pg.end().catch(()=>{}); process.exit(0); });
